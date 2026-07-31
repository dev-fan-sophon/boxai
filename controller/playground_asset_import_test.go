package controller

import (
	"net/http"
	"net/http/httptest"
	"strings"
	"testing"

	"github.com/dev-fan-sophon/boxai/constant"
	"github.com/dev-fan-sophon/boxai/model"
	"github.com/gin-gonic/gin"
	"github.com/stretchr/testify/assert"
	"github.com/stretchr/testify/require"
)

func TestImportPlaygroundAssetRejectsUnsafeSources(t *testing.T) {
	gin.SetMode(gin.TestMode)
	tests := []struct {
		name string
		body string
	}{
		{name: "unsupported kind", body: `{"source_url":"https://cdn.example/image.png","kind":"document"}`},
		{name: "data URL", body: `{"source_url":"data:image/png;base64,aW1hZ2U=","kind":"image"}`},
		{name: "relative URL", body: `{"source_url":"/api/private","kind":"image"}`},
		{name: "unsupported scheme", body: `{"source_url":"file:///etc/passwd","kind":"image"}`},
	}

	for _, test := range tests {
		t.Run(test.name, func(t *testing.T) {
			recorder := httptest.NewRecorder()
			ctx, _ := gin.CreateTestContext(recorder)
			ctx.Request = httptest.NewRequest(http.MethodPost, "/api/playground/assets/import", strings.NewReader(test.body))
			ctx.Request.Header.Set("Content-Type", "application/json")
			ctx.Set("id", 1)

			ImportPlaygroundAsset(ctx)

			assert.Contains(t, recorder.Body.String(), `"success":false`)
		})
	}
}

func TestCreatePlaygroundRunRejectsAnotherUsersTask(t *testing.T) {
	db := setupVideoProxyTestDB(t)
	require.NoError(t, db.Create(&model.Task{
		TaskID:   "task_private_video",
		UserId:   42,
		Platform: "48",
		Status:   model.TaskStatusSubmitted,
	}).Error)

	recorder := httptest.NewRecorder()
	ctx, _ := gin.CreateTestContext(recorder)
	ctx.Request = httptest.NewRequest(
		http.MethodPost,
		"/api/playground/runs",
		strings.NewReader(`{"modality":"video","model":"grok-imagine-video","prompt":"test","task_id":"task_private_video"}`),
	)
	ctx.Request.Header.Set("Content-Type", "application/json")
	ctx.Set("id", 99)

	CreatePlaygroundRun(ctx)

	assert.Contains(t, recorder.Body.String(), `"success":false`)
	assert.Contains(t, recorder.Body.String(), "task not found")
}

func TestCreatePlaygroundRunRequiresOwnedMediaReference(t *testing.T) {
	recorder := httptest.NewRecorder()
	ctx, _ := gin.CreateTestContext(recorder)
	ctx.Request = httptest.NewRequest(
		http.MethodPost,
		"/api/playground/runs",
		strings.NewReader(`{"modality":"image","model":"gpt-image-2","prompt":"test","result_url":"https://unowned.example/image.png"}`),
	)
	ctx.Request.Header.Set("Content-Type", "application/json")
	ctx.Set("id", 1)

	CreatePlaygroundRun(ctx)

	assert.Contains(t, recorder.Body.String(), `"success":false`)
	assert.Contains(t, recorder.Body.String(), "asset")
}

func TestCreatePlaygroundRunRejectsCrossModalityReferences(t *testing.T) {
	db := setupVideoProxyTestDB(t)
	require.NoError(t, db.AutoMigrate(&model.PlaygroundAsset{}))
	require.NoError(t, db.Create(&model.PlaygroundAsset{
		UserId: 1,
		Kind:   "image",
		Name:   "image.png",
	}).Error)
	require.NoError(t, db.Create(&model.Task{
		TaskID:   "audio-task",
		UserId:   1,
		Platform: constant.TaskPlatformSuno,
		Status:   model.TaskStatusSubmitted,
	}).Error)

	tests := []struct {
		name string
		body string
	}{
		{name: "image with task", body: `{"modality":"image","asset_id":1,"task_id":"audio-task"}`},
		{name: "video with asset", body: `{"modality":"video","asset_id":1,"task_id":"audio-task"}`},
		{name: "video with audio task", body: `{"modality":"video","task_id":"audio-task"}`},
		{name: "chat with asset", body: `{"modality":"chat","asset_id":1}`},
	}
	for _, test := range tests {
		t.Run(test.name, func(t *testing.T) {
			recorder := httptest.NewRecorder()
			ctx, _ := gin.CreateTestContext(recorder)
			ctx.Request = httptest.NewRequest(http.MethodPost, "/api/playground/runs", strings.NewReader(test.body))
			ctx.Request.Header.Set("Content-Type", "application/json")
			ctx.Set("id", 1)

			CreatePlaygroundRun(ctx)

			assert.Contains(t, recorder.Body.String(), `"success":false`)
		})
	}
}
