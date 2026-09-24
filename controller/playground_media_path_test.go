package controller

import (
	"bytes"
	"net/http"
	"net/http/httptest"
	"testing"

	"github.com/dev-fan-sophon/boxai/model"
	"github.com/dev-fan-sophon/boxai/service/storage"
	"github.com/gin-gonic/gin"
	"github.com/glebarez/sqlite"
	"github.com/stretchr/testify/assert"
	"github.com/stretchr/testify/require"
	"gorm.io/gorm"
)

func TestUploadIntentDoesNotReadFileBytes(t *testing.T) {
	gin.SetMode(gin.TestMode)
	root := t.TempDir()
	t.Setenv("STORAGE_BACKEND", "local")
	t.Setenv("PLAYGROUND_ASSETS_DIR", root)
	storage.Reset()
	t.Cleanup(storage.Reset)

	recorder := httptest.NewRecorder()
	ctx, _ := gin.CreateTestContext(recorder)
	ctx.Request = httptest.NewRequest(http.MethodPost, "/api/playground/assets/upload-intent", bytes.NewBufferString(`{"name":"ref.mp4","content_type":"video/mp4","size":12,"kind":"video"}`))
	ctx.Request.Header.Set("Content-Type", "application/json")
	ctx.Set("id", 7)

	CreatePlaygroundUploadIntent(ctx)

	assert.Equal(t, http.StatusOK, recorder.Code)
	assert.NotContains(t, recorder.Body.String(), "ref-bytes")
	assert.Contains(t, recorder.Body.String(), "direct upload is not available")
}

func TestVolcengineCallbackUpdatesTaskWithoutPolling(t *testing.T) {
	gin.SetMode(gin.TestMode)
	db, err := gorm.Open(sqlite.Open("file:"+t.Name()+"?mode=memory&cache=shared"), &gorm.Config{})
	require.NoError(t, err)
	require.NoError(t, db.AutoMigrate(&model.Task{}))
	old := model.DB
	model.DB = db
	t.Cleanup(func() { model.DB = old })

	task := &model.Task{
		TaskID: "cgt-callback",
		UserId: 7,
		Status: model.TaskStatusInProgress,
	}
	task.PrivateData.UpstreamTaskID = "cgt-callback"
	require.NoError(t, task.Insert())

	body := `{"id":"cgt-callback","status":"succeeded","content":{"video_url":"https://tos.example/video.mp4"}}`
	recorder := httptest.NewRecorder()
	ctx, _ := gin.CreateTestContext(recorder)
	ctx.Request = httptest.NewRequest(http.MethodPost, "/api/playground/task/volcengine/callback", bytes.NewBufferString(body))

	VolcengineTaskCallback(ctx)

	assert.Equal(t, http.StatusOK, recorder.Code)
	stored, exists, err := model.GetByUpstreamTaskID("cgt-callback")
	require.NoError(t, err)
	require.True(t, exists)
	assert.Equal(t, model.TaskStatus(model.TaskStatusSuccess), stored.Status)
	assert.Equal(t, "https://tos.example/video.mp4", stored.GetResultURL())
	assert.NotContains(t, string(stored.Data), "base64")
}

func TestRedirectPresignedVideoFallsBackWithoutPresign(t *testing.T) {
	gin.SetMode(gin.TestMode)
	root := t.TempDir()
	t.Setenv("STORAGE_BACKEND", "local")
	t.Setenv("PLAYGROUND_ASSETS_DIR", root)
	storage.Reset()
	t.Cleanup(storage.Reset)

	recorder := httptest.NewRecorder()
	ctx, _ := gin.CreateTestContext(recorder)
	ctx.Request = httptest.NewRequest(http.MethodGet, "/v1/videos/task/content?redirect=1", nil)

	redirected := redirectPresignedVideo(ctx, &model.PlaygroundAsset{
		Backend:    "local",
		StorageKey: "outputs/1/video.mp4",
	})
	require.False(t, redirected)
	assert.Equal(t, http.StatusOK, recorder.Code)
}
