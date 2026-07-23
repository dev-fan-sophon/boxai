package controller

import (
	"encoding/json"
	"net/http"
	"net/http/httptest"
	"strings"
	"testing"

	"github.com/QuantumNous/new-api/model"
	"github.com/gin-gonic/gin"
	"github.com/stretchr/testify/assert"
	"github.com/stretchr/testify/require"
)

func setupPlaygroundSessionTestDB(t *testing.T) {
	t.Helper()
	db := setupVideoProxyTestDB(t)
	require.NoError(t, db.AutoMigrate(
		&model.PlaygroundConversation{},
		&model.PlaygroundMessage{},
		&model.PlaygroundProject{},
		&model.PlaygroundRun{},
		&model.PlaygroundAsset{},
	))
}

func TestCreateConversationAcceptsDuoKindAndMeta(t *testing.T) {
	setupPlaygroundSessionTestDB(t)
	gin.SetMode(gin.TestMode)

	recorder := httptest.NewRecorder()
	ctx, _ := gin.CreateTestContext(recorder)
	ctx.Request = httptest.NewRequest(
		http.MethodPost,
		"/api/playground/conversations",
		strings.NewReader(`{"title":"Duo thread","model":"gpt-4o","group":"default","kind":"duo","meta_json":{"answerModels":["a","b"],"summaryModel":"c"}}`),
	)
	ctx.Request.Header.Set("Content-Type", "application/json")
	ctx.Set("id", 7)

	CreatePlaygroundConversation(ctx)

	require.Contains(t, recorder.Body.String(), `"success":true`)
	var payload struct {
		Data model.PlaygroundConversation `json:"data"`
	}
	require.NoError(t, json.Unmarshal(recorder.Body.Bytes(), &payload))
	assert.Equal(t, "duo", payload.Data.Kind)
	assert.Contains(t, payload.Data.MetaJson, "answerModels")
	assert.Equal(t, 7, payload.Data.UserId)
}

func TestPutConversationMessagesStoresPerTurnMetadata(t *testing.T) {
	setupPlaygroundSessionTestDB(t)
	gin.SetMode(gin.TestMode)

	conv := &model.PlaygroundConversation{
		UserId: 3,
		Title:  "New chat",
		Model:  "gpt-4o",
		Group:  "default",
		Kind:   "chat",
	}
	require.NoError(t, model.CreatePlaygroundConversation(conv))

	body := `{"messages":[{"role":"user","content":"hi","model":"gpt-4o","client_key":"u1"},{"role":"assistant","content":"hello","model":"claude-x","client_key":"a1","tool_json":{"modelChangeFrom":"gpt-4o","modelChangeTo":"claude-x"}}]}`
	recorder := httptest.NewRecorder()
	ctx, _ := gin.CreateTestContext(recorder)
	ctx.Request = httptest.NewRequest(
		http.MethodPut,
		"/api/playground/conversations/1/messages",
		strings.NewReader(body),
	)
	ctx.Request.Header.Set("Content-Type", "application/json")
	ctx.Params = gin.Params{{Key: "id", Value: "1"}}
	ctx.Set("id", 3)

	PutPlaygroundConversationMessages(ctx)
	require.Contains(t, recorder.Body.String(), `"success":true`)

	msgs, err := model.ListPlaygroundMessages(conv.Id, 3)
	require.NoError(t, err)
	require.Len(t, msgs, 2)
	assert.Equal(t, "gpt-4o", msgs[0].Model)
	assert.Equal(t, "u1", msgs[0].ClientKey)
	assert.Equal(t, "claude-x", msgs[1].Model)
	assert.Equal(t, "a1", msgs[1].ClientKey)
	assert.Contains(t, msgs[1].ToolJson, "modelChangeTo")

	// Auto-title from first user message.
	updated, err := model.GetPlaygroundConversation(conv.Id, 3)
	require.NoError(t, err)
	assert.Equal(t, "hi", updated.Title)
}

func TestCreateProjectAndLinkRun(t *testing.T) {
	setupPlaygroundSessionTestDB(t)
	gin.SetMode(gin.TestMode)

	// Create project
	recorder := httptest.NewRecorder()
	ctx, _ := gin.CreateTestContext(recorder)
	ctx.Request = httptest.NewRequest(
		http.MethodPost,
		"/api/playground/projects",
		strings.NewReader(`{"modality":"image","title":"Cat shots","model":"gpt-image-1","group":"default","client_key":"s_local1","last_prompt":"a cat"}`),
	)
	ctx.Request.Header.Set("Content-Type", "application/json")
	ctx.Set("id", 11)
	CreatePlaygroundProject(ctx)
	require.Contains(t, recorder.Body.String(), `"success":true`)

	var created struct {
		Data model.PlaygroundProject `json:"data"`
	}
	require.NoError(t, json.Unmarshal(recorder.Body.Bytes(), &created))
	require.NotZero(t, created.Data.Id)
	assert.Equal(t, "image", created.Data.Modality)
	assert.Equal(t, "s_local1", created.Data.ClientKey)

	// Idempotent re-create by client_key
	recorder2 := httptest.NewRecorder()
	ctx2, _ := gin.CreateTestContext(recorder2)
	ctx2.Request = httptest.NewRequest(
		http.MethodPost,
		"/api/playground/projects",
		strings.NewReader(`{"modality":"image","title":"Other","client_key":"s_local1"}`),
	)
	ctx2.Request.Header.Set("Content-Type", "application/json")
	ctx2.Set("id", 11)
	CreatePlaygroundProject(ctx2)
	var again struct {
		Data model.PlaygroundProject `json:"data"`
	}
	require.NoError(t, json.Unmarshal(recorder2.Body.Bytes(), &again))
	assert.Equal(t, created.Data.Id, again.Data.Id)

	// Owned asset + run linked to project
	require.NoError(t, model.DB.Create(&model.PlaygroundAsset{
		UserId: 11,
		Kind:   "image",
		Name:   "out.png",
		URL:    "/api/playground/assets/1/content",
	}).Error)

	runRecorder := httptest.NewRecorder()
	runCtx, _ := gin.CreateTestContext(runRecorder)
	runBody, err := json.Marshal(map[string]any{
		"modality":   "image",
		"model":      "gpt-image-1",
		"prompt":     "a cat",
		"asset_id":   1,
		"project_id": created.Data.Id,
	})
	require.NoError(t, err)
	runCtx.Request = httptest.NewRequest(http.MethodPost, "/api/playground/runs", strings.NewReader(string(runBody)))
	runCtx.Request.Header.Set("Content-Type", "application/json")
	runCtx.Set("id", 11)
	CreatePlaygroundRun(runCtx)
	require.Contains(t, runRecorder.Body.String(), `"success":true`)

	var runPayload struct {
		Data model.PlaygroundRun `json:"data"`
	}
	require.NoError(t, json.Unmarshal(runRecorder.Body.Bytes(), &runPayload))
	assert.Equal(t, created.Data.Id, runPayload.Data.ProjectId)

	// Project last_prompt touched
	project, err := model.GetPlaygroundProject(created.Data.Id, 11)
	require.NoError(t, err)
	assert.Equal(t, "a cat", project.LastPrompt)
}

func TestCreateProjectRejectsInvalidModality(t *testing.T) {
	setupPlaygroundSessionTestDB(t)
	gin.SetMode(gin.TestMode)
	recorder := httptest.NewRecorder()
	ctx, _ := gin.CreateTestContext(recorder)
	ctx.Request = httptest.NewRequest(
		http.MethodPost,
		"/api/playground/projects",
		strings.NewReader(`{"modality":"chat","title":"nope"}`),
	)
	ctx.Request.Header.Set("Content-Type", "application/json")
	ctx.Set("id", 1)
	CreatePlaygroundProject(ctx)
	assert.Contains(t, recorder.Body.String(), `"success":false`)
	assert.Contains(t, recorder.Body.String(), "invalid modality")
}
