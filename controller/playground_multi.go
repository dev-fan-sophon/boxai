package controller

import (
	"bytes"
	"context"
	"fmt"
	"io"
	"net/http"
	"strings"
	"sync"
	"time"

	"github.com/QuantumNous/new-api/common"
	"github.com/gin-gonic/gin"
)

const playgroundMultiMaxModels = 5
const playgroundMultiMaxMessages = 40
const playgroundMultiMaxMessageRunes = 32_000

type playgroundMultiRequest struct {
	AnswerModels    []string         `json:"answer_models"`
	SummarizerModel string           `json:"summarizer_model"`
	Messages        []map[string]any `json:"messages"`
	Group           string           `json:"group"`
	TimeoutSeconds  int              `json:"timeout"`
	Temperature     *float64         `json:"temperature"`
	MaxTokens       *int             `json:"max_tokens"`
}

type playgroundMultiLegResult struct {
	Model   string `json:"model"`
	Content string `json:"content,omitempty"`
	Error   string `json:"error,omitempty"`
}

// PlaygroundMultiChat fans out chat completions to multiple models then summarizes.
// Each leg is billed through the existing /pg/chat/completions path (session auth).
// Partial failure: failed legs are reported; summary still runs if at least one leg succeeded.
func PlaygroundMultiChat(c *gin.Context) {
	var req playgroundMultiRequest
	if err := common.UnmarshalBodyReusable(c, &req); err != nil {
		common.ApiError(c, err)
		return
	}
	models := uniqueNonEmpty(req.AnswerModels)
	if len(models) == 0 {
		common.ApiErrorMsg(c, "answer_models is required")
		return
	}
	if len(models) > playgroundMultiMaxModels {
		common.ApiErrorMsg(c, fmt.Sprintf("answer_models max is %d", playgroundMultiMaxModels))
		return
	}
	summarizer := strings.TrimSpace(req.SummarizerModel)
	if summarizer == "" {
		common.ApiErrorMsg(c, "summarizer_model is required")
		return
	}
	if len(req.Messages) == 0 {
		common.ApiErrorMsg(c, "messages is required")
		return
	}
	if len(req.Messages) > playgroundMultiMaxMessages {
		common.ApiErrorMsg(c, fmt.Sprintf("messages max is %d", playgroundMultiMaxMessages))
		return
	}
	// Soft bound on total message text size
	if total := multiMessageRuneCount(req.Messages); total > playgroundMultiMaxMessageRunes {
		common.ApiErrorMsg(c, "messages payload too large")
		return
	}
	timeout := req.TimeoutSeconds
	if timeout <= 0 {
		timeout = 120
	}
	if timeout > 300 {
		timeout = 300
	}

	// Shared deadline for all legs + summary so total wall clock stays near timeout.
	ctx, cancel := context.WithTimeout(c.Request.Context(), time.Duration(timeout)*time.Second)
	defer cancel()

	baseURL := playgroundInternalBase(c)
	client := &http.Client{Timeout: time.Duration(timeout) * time.Second}
	auth := playgroundAuthHeaders(c)

	legs := make([]playgroundMultiLegResult, len(models))
	var wg sync.WaitGroup
	for i, m := range models {
		wg.Add(1)
		go func(idx int, modelName string) {
			defer wg.Done()
			if ctx.Err() != nil {
				legs[idx] = playgroundMultiLegResult{Model: modelName, Error: "timeout"}
				return
			}
			content, err := callPlaygroundChat(ctx, client, auth, baseURL, modelName, req.Group, req.Messages, req.Temperature, req.MaxTokens)
			if err != nil {
				legs[idx] = playgroundMultiLegResult{Model: modelName, Error: err.Error()}
				return
			}
			legs[idx] = playgroundMultiLegResult{Model: modelName, Content: content}
		}(i, m)
	}
	wg.Wait()

	var successParts []string
	for _, leg := range legs {
		if leg.Error == "" && strings.TrimSpace(leg.Content) != "" {
			successParts = append(successParts, fmt.Sprintf("### Model: %s\n\n%s", leg.Model, leg.Content))
		}
	}

	var summary string
	var summaryErr string
	if len(successParts) == 0 {
		summaryErr = "all answer models failed"
	} else if ctx.Err() != nil {
		summaryErr = "timeout before summary"
	} else {
		summaryMessages := append([]map[string]any{}, req.Messages...)
		summaryMessages = append(summaryMessages, map[string]any{
			"role": "user",
			"content": "Synthesize a clear final answer from the following model responses. " +
				"Resolve contradictions, keep useful detail, and write for the end user.\n\n" +
				strings.Join(successParts, "\n\n---\n\n"),
		})
		content, err := callPlaygroundChat(ctx, client, auth, baseURL, summarizer, req.Group, summaryMessages, req.Temperature, req.MaxTokens)
		if err != nil {
			summaryErr = err.Error()
		} else {
			summary = content
		}
	}

	common.ApiSuccess(c, gin.H{
		"legs":             legs,
		"summary":          summary,
		"summary_error":    summaryErr,
		"summarizer_model": summarizer,
		"partial":          len(successParts) > 0 && (summaryErr != "" || len(successParts) < len(models)),
	})
}

func multiMessageRuneCount(messages []map[string]any) int {
	total := 0
	for _, m := range messages {
		if c, ok := m["content"].(string); ok {
			total += len([]rune(c))
		}
	}
	return total
}

func uniqueNonEmpty(in []string) []string {
	seen := map[string]bool{}
	var out []string
	for _, s := range in {
		s = strings.TrimSpace(s)
		if s == "" || seen[s] {
			continue
		}
		seen[s] = true
		out = append(out, s)
	}
	return out
}

func playgroundInternalBase(c *gin.Context) string {
	base := strings.TrimRight(common.GetEnvOrDefaultString("PLAYGROUND_INTERNAL_BASE", ""), "/")
	if base != "" {
		return base
	}
	port := common.GetEnvOrDefaultString("PORT", "")
	if port == "" {
		port = "3000"
	}
	return "http://127.0.0.1:" + port
}

// playgroundAuthHeaders copies auth once (Cookie XOR individual cookies).
func playgroundAuthHeaders(src *gin.Context) http.Header {
	h := make(http.Header)
	if cookie := src.GetHeader("Cookie"); cookie != "" {
		h.Set("Cookie", cookie)
	} else {
		// Rebuild Cookie header from request cookies without double-set
		var parts []string
		for _, cookie := range src.Request.Cookies() {
			parts = append(parts, cookie.Name+"="+cookie.Value)
		}
		if len(parts) > 0 {
			h.Set("Cookie", strings.Join(parts, "; "))
		}
	}
	if auth := src.GetHeader("Authorization"); auth != "" {
		h.Set("Authorization", auth)
	}
	if rid := src.GetHeader("New-Api-User"); rid != "" {
		h.Set("New-Api-User", rid)
	}
	return h
}

func callPlaygroundChat(
	ctx context.Context,
	client *http.Client,
	auth http.Header,
	baseURL, model, group string,
	messages []map[string]any,
	temperature *float64,
	maxTokens *int,
) (string, error) {
	payload := map[string]any{
		"model":    model,
		"messages": messages,
		"stream":   false,
	}
	if group != "" {
		payload["group"] = group
	}
	if temperature != nil {
		payload["temperature"] = *temperature
	}
	if maxTokens != nil {
		payload["max_tokens"] = *maxTokens
	}
	body, err := common.Marshal(payload)
	if err != nil {
		return "", err
	}
	req, err := http.NewRequestWithContext(ctx, http.MethodPost, baseURL+"/pg/chat/completions", bytes.NewReader(body))
	if err != nil {
		return "", err
	}
	req.Header.Set("Content-Type", "application/json")
	for k, vals := range auth {
		for _, v := range vals {
			req.Header.Set(k, v) // Set once per key
		}
	}

	resp, err := client.Do(req)
	if err != nil {
		return "", err
	}
	defer resp.Body.Close()
	raw, err := io.ReadAll(io.LimitReader(resp.Body, 4*1024*1024))
	if err != nil {
		return "", err
	}
	if resp.StatusCode < 200 || resp.StatusCode >= 300 {
		return "", fmt.Errorf("status %d: %s", resp.StatusCode, truncateForErr(string(raw), 300))
	}
	var parsed map[string]any
	if err := common.Unmarshal(raw, &parsed); err != nil {
		return "", err
	}
	if choices, ok := parsed["choices"].([]any); ok && len(choices) > 0 {
		if ch, ok := choices[0].(map[string]any); ok {
			if msg, ok := ch["message"].(map[string]any); ok {
				if content, ok := msg["content"].(string); ok {
					return content, nil
				}
			}
			if content, ok := ch["text"].(string); ok {
				return content, nil
			}
		}
	}
	if errObj, ok := parsed["error"].(map[string]any); ok {
		if msg, ok := errObj["message"].(string); ok {
			return "", fmt.Errorf("%s", msg)
		}
	}
	return "", fmt.Errorf("unexpected chat response")
}

func truncateForErr(s string, n int) string {
	if len(s) <= n {
		return s
	}
	return s[:n] + "…"
}
