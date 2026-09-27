package controller

import (
	"context"
	"net/http"
	"net/http/httptest"
	"net/url"
	"strings"
	"testing"

	"github.com/dev-fan-sophon/boxai/model"
	"github.com/dev-fan-sophon/boxai/service"
	"github.com/dev-fan-sophon/boxai/service/storage"
	"github.com/gin-gonic/gin"
	"github.com/glebarez/sqlite"
	"github.com/stretchr/testify/assert"
	"github.com/stretchr/testify/require"
	"gorm.io/gorm"
)

func TestMediaFetchDelivery(t *testing.T) {
	t.Setenv("CRYPTO_SECRET", "fetch-test-secret")
	t.Setenv("PLAYGROUND_ASSETS_DIR", t.TempDir())
	t.Setenv("R2_ENDPOINT", "https://objects.example")
	t.Setenv("R2_BUCKET", "private")
	t.Setenv("R2_ACCESS_KEY_ID", "test-key")
	t.Setenv("R2_SECRET_ACCESS_KEY", "test-secret")
	db, err := gorm.Open(sqlite.Open(":memory:"), &gorm.Config{})
	require.NoError(t, err)
	old := model.DB
	model.DB = db
	t.Cleanup(func() { model.DB = old })
	require.NoError(t, db.AutoMigrate(&model.PlaygroundAsset{}))
	store, err := storage.ForBackend("")
	require.NoError(t, err)
	require.NoError(t, store.Put(context.Background(), "ref.mp4", strings.NewReader("video"), 5, "video/mp4"))
	asset := model.PlaygroundAsset{UserId: 7, Kind: "video", StorageKey: "ref.mp4", Mime: "video/mp4"}
	require.NoError(t, db.Create(&asset).Error)
	path, err := service.IssueMediaFetchGrant(7, asset.Id)
	require.NoError(t, err)
	router := gin.New()
	router.GET("/api/playground/media-fetch/:token", GetPlaygroundMediaFetch)
	for _, backend := range []string{"", "r2"} {
		require.NoError(t, db.Model(&asset).Update("backend", backend).Error)
		rec := httptest.NewRecorder()
		router.ServeHTTP(rec, httptest.NewRequest(http.MethodGet, path, nil))
		assert.Equal(t, "private, no-store", rec.Header().Get("Cache-Control"))
		if backend == "" {
			assert.Equal(t, http.StatusOK, rec.Code)
			assert.Equal(t, "video", rec.Body.String())
		} else {
			assert.Equal(t, http.StatusTemporaryRedirect, rec.Code)
			u, err := url.Parse(rec.Header().Get("Location"))
			require.NoError(t, err)
			assert.Equal(t, "objects.example", u.Host)
			assert.Equal(t, "/private/ref.mp4", u.Path)
			assert.NotEmpty(t, u.Query().Get("X-Amz-Signature"))
		}
	}
	for _, update := range []map[string]any{{"upload_state": "pending"}, {"upload_state": "ready", "user_id": 8}} {
		require.NoError(t, db.Model(&asset).Updates(update).Error)
		rec := httptest.NewRecorder()
		router.ServeHTTP(rec, httptest.NewRequest(http.MethodGet, path, nil))
		assert.Equal(t, http.StatusNotFound, rec.Code)
	}
}
