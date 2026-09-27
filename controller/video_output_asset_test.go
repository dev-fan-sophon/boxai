package controller

import (
	"net/http"
	"net/http/httptest"
	"testing"

	"github.com/dev-fan-sophon/boxai/model"
	"github.com/gin-gonic/gin"
	"github.com/stretchr/testify/assert"
	"github.com/stretchr/testify/require"
)

func TestVideoProxyOrdinaryOutputWithoutProviderOrPlaygroundRun(t *testing.T) {
	db := setupVideoProxyTestDB(t)
	require.NoError(t, db.AutoMigrate(&model.PlaygroundAsset{}))
	root := t.TempDir()
	t.Setenv("STORAGE_BACKEND", "local")
	t.Setenv("PLAYGROUND_ASSETS_DIR", root)
	serviceStorageReset()
	t.Cleanup(serviceStorageReset)
	key := "outputs/42/video.mp4"
	require.NoError(t, writeLocalPlaygroundObject(t, root, key, []byte("video-payload")))
	asset := &model.PlaygroundAsset{UserId: 42, Kind: "video", Name: "video.mp4", StorageKey: key, Backend: "local", Mime: "video/mp4", Size: 13}
	require.NoError(t, db.Create(asset).Error)
	require.NoError(t, db.Create(&model.Task{TaskID: "durable", UserId: 42, Status: model.TaskStatusSuccess, OutputAssetID: asset.Id}).Error)
	router := gin.New()
	router.GET("/v1/videos/:task_id/content", func(c *gin.Context) {
		c.Set("id", 42)
		VideoProxy(c)
	})
	for _, tc := range []struct {
		query, byteRange, wantBody string
		status                     int
	}{
		{"", "", "video-payload", http.StatusOK},
		{"?redirect=1", "", "video-payload", http.StatusOK},
		{"", "bytes=0-4", "video", http.StatusPartialContent},
	} {
		recorder := httptest.NewRecorder()
		req := httptest.NewRequest(http.MethodGet, "/v1/videos/durable/content"+tc.query, nil)
		req.Header.Set("Range", tc.byteRange)
		router.ServeHTTP(recorder, req)
		assert.Equal(t, tc.status, recorder.Code)
		assert.Equal(t, tc.wantBody, recorder.Body.String())
		assert.Empty(t, recorder.Header().Get("Location"))
	}
}
