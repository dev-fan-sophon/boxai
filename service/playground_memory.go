package service

import (
	"bytes"
	"context"
	"errors"
	"fmt"
	"io"
	"net/http"
	"strings"
	"sync"
	"sync/atomic"
	"time"

	"github.com/dev-fan-sophon/boxai/common"
	"github.com/dev-fan-sophon/boxai/model"
	"github.com/dev-fan-sophon/boxai/setting/system_setting"
)

// Playground chat memory maintenance: a rolling per-conversation summary and
// cross-conversation user memories, both produced against the platform-paid
// endpoint configured in system_setting.PlaygroundMemorySettings. Runs in the
// background after the cloud-sync append of finalized turns; failures only
// delay the next attempt, they never surface to the user.

const (
	maxPlaygroundMemoryContentRunes = 400
	maxPlaygroundSummaryRunes       = 4000
	// Transcript excerpts sent to the extraction model are bounded so a single
	// maintenance run stays cheap no matter how long the thread is.
	maxPlaygroundMemoryTurnRunes       = 1200
	maxPlaygroundMemoryTranscriptRunes = 24000
)

var playgroundMemoryCategories = map[string]bool{
	"profile": true, "preference": true, "project": true, "other": true,
}

// playgroundMemoryInflight serializes maintenance per conversation so a burst
// of appends cannot fan out into duplicate extraction calls.
var playgroundMemoryInflight sync.Map

// A dead endpoint must not cost a doomed HTTP call (and its timeout) on every
// append. After an endpoint failure, maintenance is skipped platform-wide for
// a cooldown window; cursors stay put, so the skipped work is retried later.
var playgroundMemoryFailureUntil atomic.Int64

const playgroundMemoryFailureCooldown = 2 * time.Minute

func notePlaygroundMemoryFailure() {
	playgroundMemoryFailureUntil.Store(time.Now().Add(playgroundMemoryFailureCooldown).UnixNano())
}

func playgroundMemoryCoolingDown() bool {
	return time.Now().UnixNano() < playgroundMemoryFailureUntil.Load()
}

const playgroundMemoryExtractionPrompt = `You maintain long-term memory about a user of an AI chat product.
From the conversation excerpt, extract only durable facts worth remembering across future conversations: stable profile facts (name, role, location, language), lasting preferences (tone, format, tools), and ongoing projects or goals. Ignore one-off requests, small talk, and anything about the current answer only.

You receive the existing memories as a numbered list. Reply with a single JSON object and nothing else:
{"add":[{"content":"...","category":"profile|preference|project|other"}],"update":[{"id":1,"content":"..."}],"delete":[2]}

Rules:
- Each memory is one short, self-contained sentence in the user's own language.
- Update or delete an existing memory when the excerpt contradicts or refines it; never store duplicates.
- When nothing durable appears, reply {"add":[],"update":[],"delete":[]}.`

const playgroundSummaryPrompt = `You compress chat history for an AI assistant. Merge the previous summary (if any) with the new conversation excerpt into one updated summary.
Keep: user goals and constraints, decisions made, key facts and numbers, unresolved questions, and the current state of any task. Drop pleasantries and repetition. Write compact prose or bullets in the conversation's main language, at most 300 words. Reply with the summary text only.`

type playgroundMemoryOps struct {
	Add []struct {
		Content  string `json:"content"`
		Category string `json:"category"`
	} `json:"add"`
	Update []struct {
		Id      int    `json:"id"`
		Content string `json:"content"`
	} `json:"update"`
	Delete []int `json:"delete"`
}

// RunPlaygroundMemoryMaintenance updates the rolling summary and, when the user
// has long memory enabled, extracts user memories from turns appended since the
// previous run. Intended to be called from a background goroutine.
func RunPlaygroundMemoryMaintenance(userId, conversationId int, longMemory bool) {
	settings := system_setting.GetPlaygroundMemorySettings()
	if !settings.Ready() || playgroundMemoryCoolingDown() {
		return
	}
	if _, running := playgroundMemoryInflight.LoadOrStore(conversationId, true); running {
		return
	}
	defer playgroundMemoryInflight.Delete(conversationId)

	conv, err := model.GetPlaygroundConversation(conversationId, userId)
	if err != nil || conv.Kind == "duo" {
		return
	}
	messages, err := model.ListPlaygroundMessages(conversationId, userId)
	if err != nil || len(messages) == 0 {
		return
	}

	ctx, cancel := context.WithTimeout(context.Background(), time.Duration(settings.TimeoutSeconds)*time.Second)
	defer cancel()

	if settings.SummaryEnabled {
		if err := maintainPlaygroundSummary(ctx, settings, conv, messages); err != nil {
			common.SysError(fmt.Sprintf("playground summary maintenance failed (conversation %d): %s", conversationId, err.Error()))
		}
	}
	if longMemory {
		if err := maintainPlaygroundUserMemories(ctx, settings, conv, messages); err != nil {
			common.SysError(fmt.Sprintf("playground memory extraction failed (user %d, conversation %d): %s", userId, conversationId, err.Error()))
		}
	}
}

func maintainPlaygroundSummary(ctx context.Context, settings *system_setting.PlaygroundMemorySettings, conv *model.PlaygroundConversation, messages []model.PlaygroundMessage) error {
	if len(messages) < settings.SummaryTriggerMessages {
		return nil
	}
	boundary := len(messages) - settings.SummaryKeepRecent
	if boundary <= 0 {
		return nil
	}
	tail := messages[boundary-1]
	if tail.Seq <= conv.SummarySeq {
		return nil
	}
	var fresh []model.PlaygroundMessage
	for _, m := range messages[:boundary] {
		if m.Seq > conv.SummarySeq {
			fresh = append(fresh, m)
		}
	}
	transcript := playgroundMemoryTranscript(fresh)
	if transcript == "" {
		return nil
	}
	input := transcript
	if strings.TrimSpace(conv.Summary) != "" {
		input = "Previous summary:\n" + conv.Summary + "\n\nNew conversation excerpt:\n" + transcript
	}
	summary, err := callPlaygroundMemoryModel(ctx, settings, playgroundSummaryPrompt, input)
	if err != nil {
		return err
	}
	summary = truncatePlaygroundRunes(strings.TrimSpace(summary), maxPlaygroundSummaryRunes)
	if summary == "" {
		return errors.New("summary model returned empty text")
	}
	return model.UpdatePlaygroundConversationSummary(conv.Id, conv.UserId, summary, playgroundMessageClientKey(tail), tail.Seq)
}

func maintainPlaygroundUserMemories(ctx context.Context, settings *system_setting.PlaygroundMemorySettings, conv *model.PlaygroundConversation, messages []model.PlaygroundMessage) error {
	maxSeq := messages[len(messages)-1].Seq
	if maxSeq-conv.MemorySeq < settings.ExtractEveryMessages {
		return nil
	}
	var fresh []model.PlaygroundMessage
	for _, m := range messages {
		if m.Seq > conv.MemorySeq {
			fresh = append(fresh, m)
		}
	}
	transcript := playgroundMemoryTranscript(fresh)
	if transcript == "" {
		return model.UpdatePlaygroundConversationMemoryCursor(conv.Id, conv.UserId, maxSeq)
	}
	existing, err := model.ListPlaygroundUserMemories(conv.UserId)
	if err != nil {
		return err
	}
	var b strings.Builder
	b.WriteString("Existing memories:\n")
	if len(existing) == 0 {
		b.WriteString("(none)\n")
	}
	for _, m := range existing {
		b.WriteString(fmt.Sprintf("%d. [%s] %s\n", m.Id, m.Category, m.Content))
	}
	b.WriteString("\nConversation excerpt:\n")
	b.WriteString(transcript)
	raw, err := callPlaygroundMemoryModel(ctx, settings, playgroundMemoryExtractionPrompt, b.String())
	if err != nil {
		return err
	}
	ops, err := parsePlaygroundMemoryOps(raw)
	if err != nil {
		return err
	}
	if err := applyPlaygroundMemoryOps(conv.UserId, conv.Id, existing, ops, settings.MaxMemories); err != nil {
		return err
	}
	return model.UpdatePlaygroundConversationMemoryCursor(conv.Id, conv.UserId, maxSeq)
}

// parsePlaygroundMemoryOps tolerates markdown fences and surrounding prose, but
// requires one JSON object with the add/update/delete contract.
func parsePlaygroundMemoryOps(raw string) (*playgroundMemoryOps, error) {
	start := strings.Index(raw, "{")
	end := strings.LastIndex(raw, "}")
	if start < 0 || end <= start {
		return nil, errors.New("memory model returned no JSON object")
	}
	var ops playgroundMemoryOps
	if err := common.UnmarshalJsonStr(raw[start:end+1], &ops); err != nil {
		return nil, err
	}
	return &ops, nil
}

func applyPlaygroundMemoryOps(userId, conversationId int, existing []model.PlaygroundUserMemory, ops *playgroundMemoryOps, maxMemories int) error {
	owned := make(map[int]model.PlaygroundUserMemory, len(existing))
	contents := make(map[string]bool, len(existing))
	for _, m := range existing {
		owned[m.Id] = m
		contents[m.Content] = true
	}
	for _, id := range ops.Delete {
		if _, ok := owned[id]; !ok {
			continue
		}
		if err := model.DeletePlaygroundUserMemory(id, userId); err != nil {
			return err
		}
		delete(contents, owned[id].Content)
		delete(owned, id)
	}
	for _, update := range ops.Update {
		current, ok := owned[update.Id]
		content := normalizePlaygroundMemoryContent(update.Content)
		if !ok || content == "" || content == current.Content {
			continue
		}
		if err := model.UpdatePlaygroundUserMemory(update.Id, userId, content, current.Category); err != nil {
			return err
		}
		delete(contents, current.Content)
		contents[content] = true
	}
	remaining := len(owned)
	for _, add := range ops.Add {
		content := normalizePlaygroundMemoryContent(add.Content)
		if content == "" || contents[content] || remaining >= maxMemories {
			continue
		}
		category := strings.ToLower(strings.TrimSpace(add.Category))
		if !playgroundMemoryCategories[category] {
			category = "other"
		}
		if err := model.CreatePlaygroundUserMemory(&model.PlaygroundUserMemory{
			UserId:               userId,
			Content:              content,
			Category:             category,
			SourceConversationId: conversationId,
		}); err != nil {
			return err
		}
		contents[content] = true
		remaining++
	}
	return nil
}

func normalizePlaygroundMemoryContent(content string) string {
	return truncatePlaygroundRunes(strings.TrimSpace(content), maxPlaygroundMemoryContentRunes)
}

func playgroundMemoryTranscript(messages []model.PlaygroundMessage) string {
	var b strings.Builder
	for _, m := range messages {
		if m.Role != "user" && m.Role != "assistant" {
			continue
		}
		content := strings.TrimSpace(m.Content)
		if content == "" {
			continue
		}
		line := fmt.Sprintf("%s: %s\n", m.Role, truncatePlaygroundRunes(content, maxPlaygroundMemoryTurnRunes))
		if len([]rune(b.String()))+len([]rune(line)) > maxPlaygroundMemoryTranscriptRunes {
			break
		}
		b.WriteString(line)
	}
	return strings.TrimSpace(b.String())
}

// playgroundMessageClientKey mirrors the frontend key fallback for rows synced
// without a client key, so the summary tail key always matches a client key.
func playgroundMessageClientKey(m model.PlaygroundMessage) string {
	if m.ClientKey != "" {
		return m.ClientKey
	}
	return fmt.Sprintf("srv-%d", m.Id)
}

func truncatePlaygroundRunes(s string, max int) string {
	runes := []rune(s)
	if len(runes) <= max {
		return s
	}
	return string(runes[:max])
}

func callPlaygroundMemoryModel(ctx context.Context, settings *system_setting.PlaygroundMemorySettings, systemPrompt, userPrompt string) (text string, err error) {
	defer func() {
		if err != nil {
			notePlaygroundMemoryFailure()
		}
	}()
	payload := map[string]any{
		"model": settings.Model,
		"messages": []map[string]string{
			{"role": "system", "content": systemPrompt},
			{"role": "user", "content": userPrompt},
		},
		"stream":      false,
		"temperature": 0,
		"max_tokens":  1500,
	}
	body, err := common.Marshal(payload)
	if err != nil {
		return "", err
	}
	endpoint := strings.TrimRight(strings.TrimSpace(settings.BaseURL), "/") + "/chat/completions"
	req, err := http.NewRequestWithContext(ctx, http.MethodPost, endpoint, bytes.NewReader(body))
	if err != nil {
		return "", err
	}
	req.Header.Set("Content-Type", "application/json")
	req.Header.Set("Authorization", "Bearer "+strings.TrimSpace(settings.APIKey))
	resp, err := http.DefaultClient.Do(req)
	if err != nil {
		return "", err
	}
	defer resp.Body.Close()
	data, err := io.ReadAll(io.LimitReader(resp.Body, 1<<20))
	if err != nil {
		return "", err
	}
	if resp.StatusCode != http.StatusOK {
		return "", fmt.Errorf("memory model returned status %d", resp.StatusCode)
	}
	var parsed struct {
		Choices []struct {
			Message struct {
				Content string `json:"content"`
			} `json:"message"`
		} `json:"choices"`
	}
	if err := common.Unmarshal(data, &parsed); err != nil {
		return "", err
	}
	if len(parsed.Choices) == 0 {
		return "", errors.New("memory model returned no choices")
	}
	return parsed.Choices[0].Message.Content, nil
}
