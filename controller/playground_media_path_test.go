package controller

import (
	"bytes"
	"context"
	"encoding/base64"
	"net/http"
	"net/http/httptest"
	"testing"
	"time"

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

func TestVolcengineCallbackRequestsAuthenticatedPolling(t *testing.T) {
	gin.SetMode(gin.TestMode)
	db, err := gorm.Open(sqlite.Open("file:"+t.Name()+"?mode=memory&cache=shared"), &gorm.Config{})
	require.NoError(t, err)
	require.NoError(t, db.AutoMigrate(&model.Task{}))
	old := model.DB
	model.DB = db
	t.Cleanup(func() { model.DB = old })

	task := &model.Task{
		TaskID:     "cgt-callback",
		UserId:     7,
		Status:     model.TaskStatusInProgress,
		NextPollAt: time.Now().Add(time.Minute).Unix(),
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
	assert.Equal(t, model.TaskStatus(model.TaskStatusInProgress), stored.Status)
	assert.Empty(t, stored.GetResultURL())
	assert.Empty(t, stored.Data)
	assert.LessOrEqual(t, stored.NextPollAt, time.Now().Unix())
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

func TestVideoArchiveJobStoresSuccessfulVideoOutput(t *testing.T) {
	db := setupVideoProxyTestDB(t)
	require.NoError(t, db.AutoMigrate(&model.SystemTask{}, &model.SystemTaskLock{}, &model.PlaygroundRun{}, &model.PlaygroundAsset{}))
	t.Setenv("STORAGE_BACKEND", "local")
	t.Setenv("PLAYGROUND_ASSETS_DIR", t.TempDir())
	storage.Reset()
	t.Cleanup(storage.Reset)
	job := &model.SystemTask{TaskID: "archive-job", Type: model.SystemTaskTypeVideoOutput, Status: model.SystemTaskStatusRunning, LockedBy: "runner"}
	require.NoError(t, db.Create(job).Error)
	require.NoError(t, db.Create(&model.SystemTaskLock{Type: job.Type, TaskID: job.TaskID, LockedBy: "runner", LockedUntil: time.Now().Add(time.Minute).Unix()}).Error)
	mp4 := []byte{0, 0, 0, 24, 'f', 't', 'y', 'p', 'i', 's', 'o', 'm'}
	video := &model.Task{TaskID: "fresh-video", UserId: 42, Status: model.TaskStatusSuccess, Platform: "2", FinishTime: time.Now().Unix()}
	video.PrivateData.ResultURL = "data:video/mp4;base64," + base64.StdEncoding.EncodeToString(mp4)
	require.NoError(t, db.Create(video).Error)

	handler := videoOutputHandler{}
	assert.True(t, handler.Enabled())
	handler.Run(context.Background(), job, "runner")

	require.NoError(t, db.First(job, job.ID).Error)
	assert.Equal(t, model.SystemTaskStatusSucceeded, job.Status)
	require.NoError(t, db.First(video, video.ID).Error)
	require.NotZero(t, video.OutputAssetID)
	assert.Equal(t, "/v1/videos/fresh-video/content", video.GetResultURL())

	// The content endpoint now serves the stored copy, independent of the upstream URL.
	router := gin.New()
	router.GET("/v1/videos/:task_id/content", func(c *gin.Context) {
		c.Set("id", 42)
		VideoProxy(c)
	})
	recorder := httptest.NewRecorder()
	router.ServeHTTP(recorder, httptest.NewRequest(http.MethodGet, "/v1/videos/fresh-video/content", nil))
	assert.Equal(t, http.StatusOK, recorder.Code)
	assert.Equal(t, mp4, recorder.Body.Bytes())
}
