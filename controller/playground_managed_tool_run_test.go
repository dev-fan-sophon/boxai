package controller

import (
	"bytes"
	"net/http/httptest"
	"strconv"
	"testing"

	"github.com/QuantumNous/new-api/common"
	"github.com/QuantumNous/new-api/model"
	"github.com/gin-gonic/gin"
	"github.com/glebarez/sqlite"
	"github.com/stretchr/testify/assert"
	"github.com/stretchr/testify/require"
	"gorm.io/gorm"
)

func TestPlaygroundManagedToolRunInjectsPersistedSourcesAndStripsControls(t *testing.T) {
	db, err := gorm.Open(sqlite.Open("file:"+t.Name()+"?mode=memory&cache=shared"), &gorm.Config{})
	require.NoError(t, err)
	require.NoError(t, db.AutoMigrate(&model.PlaygroundChatToolRun{}))
	oldDB := model.DB
	model.DB = db
	t.Cleanup(func() { model.DB = oldDB })

	sources := `{"query":"persisted query","provider":"test","results":[{"title":"Source","url":"https://example.com/a","snippet":"fact","domain":"example.com","provider":"test"}]}`
	run := &model.PlaygroundChatToolRun{UserId: 7, ClientRequestId: "request-1", Action: "web_search", Status: "completed", SourcesJson: sources, ExecutionToken: "token"}
	require.NoError(t, model.CreatePlaygroundChatToolRun(run))

	body := []byte(`{"model":"test","managed_tool_run_id":` + strconv.Itoa(run.Id) + `,"web_search":true,"messages":[{"role":"user","content":"new query"}]}`)
	c, _ := gin.CreateTestContext(httptest.NewRecorder())
	c.Request = httptest.NewRequest("POST", "/pg/chat/completions", bytes.NewReader(body))
	c.Request.Header.Set("Content-Type", "application/json")
	c.Set("id", 7)
	require.NoError(t, playgroundMaybeInjectWebSearch(c))
	storage, err := common.GetBodyStorage(c)
	require.NoError(t, err)
	rewritten, err := storage.Bytes()
	require.NoError(t, err)
	assert.NotContains(t, string(rewritten), `"managed_tool_run_id":`)
	assert.NotContains(t, string(rewritten), `"web_search":`)
	assert.Contains(t, string(rewritten), "persisted query")
	assert.Contains(t, string(rewritten), "https://example.com/a")
}

func TestPlaygroundManagedToolRunRejectsOtherOwnerAndWrongStatus(t *testing.T) {
	db, err := gorm.Open(sqlite.Open("file:"+t.Name()+"?mode=memory&cache=shared"), &gorm.Config{})
	require.NoError(t, err)
	require.NoError(t, db.AutoMigrate(&model.PlaygroundChatToolRun{}))
	oldDB := model.DB
	model.DB = db
	t.Cleanup(func() { model.DB = oldDB })
	run := &model.PlaygroundChatToolRun{UserId: 8, ClientRequestId: "request-2", Action: "web_search", Status: "running", ExecutionToken: "token-2"}
	require.NoError(t, model.CreatePlaygroundChatToolRun(run))

	request := func(userID int) error {
		body, marshalErr := common.Marshal(map[string]any{"managed_tool_run_id": run.Id, "messages": []any{}})
		require.NoError(t, marshalErr)
		c, _ := gin.CreateTestContext(httptest.NewRecorder())
		c.Request = httptest.NewRequest("POST", "/pg/chat/completions", bytes.NewReader(body))
		c.Request.Header.Set("Content-Type", "application/json")
		c.Set("id", userID)
		return playgroundMaybeInjectWebSearch(c)
	}
	assert.ErrorIs(t, request(7), gorm.ErrRecordNotFound)
	assert.EqualError(t, request(8), "managed tool run is not a completed web_search run")
}

func TestReconcileSubmittedPlaygroundVideoRunFromOwnedTask(t *testing.T) {
	db, err := gorm.Open(sqlite.Open("file:"+t.Name()+"?mode=memory&cache=shared"), &gorm.Config{})
	require.NoError(t, err)
	require.NoError(t, db.AutoMigrate(&model.PlaygroundChatToolRun{}, &model.Task{}))
	oldDB := model.DB
	model.DB = db
	t.Cleanup(func() { model.DB = oldDB })

	run := &model.PlaygroundChatToolRun{UserId: 7, ClientRequestId: "video-request", Action: "generate_video", Status: "submitted", TaskId: "video-task", ExecutionToken: "video-token"}
	require.NoError(t, model.CreatePlaygroundChatToolRun(run))
	require.NoError(t, db.Create(&model.Task{UserId: 7, TaskID: "video-task", Status: model.TaskStatusSuccess}).Error)

	reconcileSubmittedPlaygroundToolRun(run)
	got, err := model.GetPlaygroundChatToolRun(run.Id, 7)
	require.NoError(t, err)
	assert.Equal(t, "completed", got.Status)
	assert.Contains(t, got.ResultJson, "/v1/videos/video-task/content")
}

func TestPlaygroundManagedMediaExecutionClaim(t *testing.T) {
	db, err := gorm.Open(sqlite.Open("file:"+t.Name()+"?mode=memory&cache=shared"), &gorm.Config{})
	require.NoError(t, err)
	require.NoError(t, db.AutoMigrate(&model.PlaygroundChatToolRun{}))
	oldDB := model.DB
	model.DB = db
	t.Cleanup(func() { model.DB = oldDB })
	run := &model.PlaygroundChatToolRun{UserId: 7, ClientRequestId: "claim", Action: "generate_image", Status: "ready", ToolModel: "gpt-image-2", UsingGroup: "auto", Prompt: "draw", ExecutionToken: "secret"}
	require.NoError(t, model.CreatePlaygroundChatToolRun(run))

	claim := func(userID int, action, token, modelName, group, prompt string) (bool, int) {
		body, marshalErr := common.Marshal(map[string]any{"model": modelName, "group": group, "prompt": prompt})
		require.NoError(t, marshalErr)
		recorder := httptest.NewRecorder()
		ctx, _ := gin.CreateTestContext(recorder)
		ctx.Request = httptest.NewRequest("POST", "/pg/images/generations", bytes.NewReader(body))
		ctx.Request.Header.Set("Content-Type", "application/json")
		ctx.Request.Header.Set("X-Playground-Run-Id", strconv.Itoa(run.Id))
		ctx.Request.Header.Set("X-Playground-Execution-Token", token)
		ctx.Set("id", userID)
		return playgroundClaimMediaExecution(ctx, action), recorder.Code
	}

	for name, values := range map[string][]string{
		"cross owner":  {"8", "generate_image", "secret", "gpt-image-2", "auto", "draw"},
		"wrong action": {"7", "generate_video", "secret", "gpt-image-2", "auto", "draw"},
		"wrong token":  {"7", "generate_image", "bad", "gpt-image-2", "auto", "draw"},
		"wrong model":  {"7", "generate_image", "secret", "other", "auto", "draw"},
		"wrong group":  {"7", "generate_image", "secret", "gpt-image-2", "default", "draw"},
		"wrong prompt": {"7", "generate_image", "secret", "gpt-image-2", "auto", "different"},
	} {
		t.Run(name, func(t *testing.T) {
			userID, parseErr := strconv.Atoi(values[0])
			require.NoError(t, parseErr)
			ok, _ := claim(userID, values[1], values[2], values[3], values[4], values[5])
			assert.False(t, ok)
		})
	}
	ok, _ := claim(7, "generate_image", "secret", "gpt-image-2", "auto", "draw")
	assert.True(t, ok)
	ok, status := claim(7, "generate_image", "secret", "gpt-image-2", "auto", "draw")
	assert.False(t, ok)
	assert.Equal(t, 409, status)
}
