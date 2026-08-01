package service

import (
	"context"
	"net/http"
	"net/http/httptest"
	"strconv"
	"testing"

	"github.com/dev-fan-sophon/boxai/common"
	"github.com/dev-fan-sophon/boxai/model"
	"github.com/dev-fan-sophon/boxai/setting/system_setting"

	"github.com/glebarez/sqlite"
	"github.com/stretchr/testify/assert"
	"github.com/stretchr/testify/require"
	"gorm.io/gorm"
)

func setupPlaygroundMemoryTestDB(t *testing.T) {
	t.Helper()
	old := model.DB
	db, err := gorm.Open(sqlite.Open("file:"+t.Name()+"?mode=memory&cache=shared"), &gorm.Config{})
	require.NoError(t, err)
	require.NoError(t, db.AutoMigrate(&model.PlaygroundConversation{}, &model.PlaygroundMessage{}, &model.PlaygroundUserMemory{}))
	model.DB = db
	t.Cleanup(func() { model.DB = old })
}

func TestParsePlaygroundMemoryOpsToleratesFencesAndProse(t *testing.T) {
	ops, err := parsePlaygroundMemoryOps("Here you go:\n```json\n{\"add\":[{\"content\":\"Prefers concise answers\",\"category\":\"preference\"}],\"update\":[],\"delete\":[3]}\n```")
	require.NoError(t, err)
	require.Len(t, ops.Add, 1)
	assert.Equal(t, "Prefers concise answers", ops.Add[0].Content)
	assert.Equal(t, []int{3}, ops.Delete)

	_, err = parsePlaygroundMemoryOps("no json here")
	require.Error(t, err)
}

func TestApplyPlaygroundMemoryOpsEnforcesOwnershipDedupAndCap(t *testing.T) {
	setupPlaygroundMemoryTestDB(t)
	mine := &model.PlaygroundUserMemory{UserId: 1, Content: "Lives in Hanoi", Category: "profile"}
	require.NoError(t, model.CreatePlaygroundUserMemory(mine))
	theirs := &model.PlaygroundUserMemory{UserId: 2, Content: "Other user fact", Category: "profile"}
	require.NoError(t, model.CreatePlaygroundUserMemory(theirs))

	existing, err := model.ListPlaygroundUserMemories(1)
	require.NoError(t, err)

	ops := &playgroundMemoryOps{}
	ops.Add = append(ops.Add,
		struct {
			Content  string `json:"content"`
			Category string `json:"category"`
		}{Content: "Lives in Hanoi", Category: "profile"}, // exact duplicate → skipped
		struct {
			Content  string `json:"content"`
			Category string `json:"category"`
		}{Content: "Prefers Vietnamese replies", Category: "nonsense"}, // bad category → other
		struct {
			Content  string `json:"content"`
			Category string `json:"category"`
		}{Content: "Over the cap", Category: "other"},
	)
	// Foreign id must be ignored, not deleted.
	ops.Delete = []int{theirs.Id}

	require.NoError(t, applyPlaygroundMemoryOps(1, 9, existing, ops, 2))

	mineAfter, err := model.ListPlaygroundUserMemories(1)
	require.NoError(t, err)
	require.Len(t, mineAfter, 2) // cap of 2: original + one addition
	assert.Equal(t, "Lives in Hanoi", mineAfter[0].Content)
	assert.Equal(t, "Prefers Vietnamese replies", mineAfter[1].Content)
	assert.Equal(t, "other", mineAfter[1].Category)
	assert.Equal(t, 9, mineAfter[1].SourceConversationId)

	theirsAfter, err := model.ListPlaygroundUserMemories(2)
	require.NoError(t, err)
	require.Len(t, theirsAfter, 1)
}

func TestMaintainPlaygroundSummaryRollingWindow(t *testing.T) {
	setupPlaygroundMemoryTestDB(t)
	server := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		var req struct {
			Messages []struct {
				Role    string `json:"role"`
				Content string `json:"content"`
			} `json:"messages"`
		}
		require.NoError(t, common.DecodeJson(r.Body, &req))
		require.Len(t, req.Messages, 2)
		// The keep-recent window must never be summarized.
		assert.NotContains(t, req.Messages[1].Content, "turn-19")
		w.Header().Set("Content-Type", "application/json")
		_, _ = w.Write([]byte(`{"choices":[{"message":{"content":"rolling summary text"}}]}`))
	}))
	defer server.Close()

	settings := &system_setting.PlaygroundMemorySettings{
		Enabled: true, BaseURL: server.URL, APIKey: "k", Model: "cheap",
		SummaryEnabled: true, SummaryTriggerMessages: 10, SummaryKeepRecent: 4,
		TimeoutSeconds: 10,
	}
	conv := &model.PlaygroundConversation{UserId: 1, Title: "t"}
	require.NoError(t, model.CreatePlaygroundConversation(conv))
	var batch []model.PlaygroundMessage
	for i := 0; i < 20; i++ {
		role := "user"
		if i%2 == 1 {
			role = "assistant"
		}
		batch = append(batch, model.PlaygroundMessage{Role: role, Content: "turn-" + strconv.Itoa(i), ClientKey: "k" + strconv.Itoa(i)})
	}
	_, err := model.AppendPlaygroundMessages(conv.Id, 1, batch)
	require.NoError(t, err)
	messages, err := model.ListPlaygroundMessages(conv.Id, 1)
	require.NoError(t, err)

	require.NoError(t, maintainPlaygroundSummary(context.Background(), settings, conv, messages))

	updated, err := model.GetPlaygroundConversation(conv.Id, 1)
	require.NoError(t, err)
	assert.Equal(t, "rolling summary text", updated.Summary)
	// 20 messages, keep 4 → summary covers through seq 15, tail key k15.
	assert.Equal(t, 15, updated.SummarySeq)
	assert.Equal(t, "k15", updated.SummaryTailKey)

	// Re-running with no new turns past the boundary is a no-op (no HTTP call
	// would change the stored state; the seq guard also protects the row).
	require.NoError(t, maintainPlaygroundSummary(context.Background(), settings, updated, messages))
	again, err := model.GetPlaygroundConversation(conv.Id, 1)
	require.NoError(t, err)
	assert.Equal(t, 15, again.SummarySeq)
}

func TestPlaygroundMemoryEndpointFailureDegradesGracefully(t *testing.T) {
	setupPlaygroundMemoryTestDB(t)
	playgroundMemoryFailureUntil.Store(0)
	t.Cleanup(func() { playgroundMemoryFailureUntil.Store(0) })

	server := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		w.WriteHeader(http.StatusBadGateway)
	}))
	defer server.Close()

	settings := &system_setting.PlaygroundMemorySettings{
		Enabled: true, BaseURL: server.URL, APIKey: "k", Model: "cheap",
		SummaryEnabled: true, SummaryTriggerMessages: 4, SummaryKeepRecent: 2,
		ExtractEveryMessages: 2, MaxMemories: 50, TimeoutSeconds: 10,
	}
	conv := &model.PlaygroundConversation{UserId: 1, Title: "t"}
	require.NoError(t, model.CreatePlaygroundConversation(conv))
	var batch []model.PlaygroundMessage
	for i := 0; i < 6; i++ {
		batch = append(batch, model.PlaygroundMessage{Role: "user", Content: "turn-" + strconv.Itoa(i), ClientKey: "k" + strconv.Itoa(i)})
	}
	_, err := model.AppendPlaygroundMessages(conv.Id, 1, batch)
	require.NoError(t, err)
	messages, err := model.ListPlaygroundMessages(conv.Id, 1)
	require.NoError(t, err)
	memory := &model.PlaygroundUserMemory{UserId: 1, Content: "Lives in Hanoi", Category: "profile"}
	require.NoError(t, model.CreatePlaygroundUserMemory(memory))

	// Both maintenance paths fail against the dead endpoint...
	require.Error(t, maintainPlaygroundSummary(context.Background(), settings, conv, messages))
	require.Error(t, maintainPlaygroundUserMemories(context.Background(), settings, conv, messages))

	// ...but stored state is untouched and cursors stay put for a later retry.
	after, err := model.GetPlaygroundConversation(conv.Id, 1)
	require.NoError(t, err)
	assert.Empty(t, after.Summary)
	assert.Zero(t, after.SummarySeq)
	assert.Zero(t, after.MemorySeq)
	memories, err := model.ListPlaygroundUserMemories(1)
	require.NoError(t, err)
	require.Len(t, memories, 1)
	assert.Equal(t, "Lives in Hanoi", memories[0].Content)

	// The failure trips the platform-wide cooldown that skips maintenance.
	assert.True(t, playgroundMemoryCoolingDown())
}
