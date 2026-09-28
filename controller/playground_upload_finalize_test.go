package controller

import (
	"bytes"
	"context"
	"io"
	"net/http"
	"net/http/httptest"
	"os"
	"strconv"
	"strings"
	"testing"
	"time"

	"github.com/dev-fan-sophon/boxai/model"
	"github.com/dev-fan-sophon/boxai/service"
	"github.com/dev-fan-sophon/boxai/service/storage"
	"github.com/gin-gonic/gin"
	"github.com/stretchr/testify/assert"
	"github.com/stretchr/testify/require"
)

func TestPlaygroundUploadIntentRemainsPending(t *testing.T) {
	db := setupVideoProxyTestDB(t)
	require.NoError(t, db.AutoMigrate(&model.PlaygroundAsset{}))
	t.Setenv("STORAGE_BACKEND", "r2")
	t.Setenv("R2_ENDPOINT", "https://storage.example.test")
	t.Setenv("R2_BUCKET", "test-bucket")
	t.Setenv("R2_ACCESS_KEY_ID", "test-key")
	t.Setenv("R2_SECRET_ACCESS_KEY", "test-secret")
	storage.Reset()
	t.Cleanup(storage.Reset)
	recorder := httptest.NewRecorder()
	c, _ := gin.CreateTestContext(recorder)
	c.Request = httptest.NewRequest(http.MethodPost, "/upload-intent", strings.NewReader(`{"name":"image.png","kind":"image","content_type":"image/png","size":8,"source":"attachment"}`))
	c.Request.Header.Set("Content-Type", "application/json")
	c.Set("id", 42)
	CreatePlaygroundUploadIntent(c)
	assert.Contains(t, recorder.Body.String(), `"success":true`)
	var asset model.PlaygroundAsset
	require.NoError(t, db.First(&asset).Error)
	assert.Equal(t, "pending", asset.UploadState)
	assert.Equal(t, "attachment", asset.Source)
	assert.Empty(t, asset.URL)
	assert.Greater(t, asset.UploadExpiresAt, time.Now().Unix())
	assert.True(t, strings.HasPrefix(asset.StorageKey, "upload-intents/42/"))
	items, total, err := model.ListPlaygroundAssets(42, "", "", 0, 10)
	require.NoError(t, err)
	assert.Empty(t, items)
	assert.Zero(t, total)
}

func TestFinalize200MiBReferenceVideo(t *testing.T) {
	db := setupVideoProxyTestDB(t)
	require.NoError(t, db.AutoMigrate(&model.PlaygroundAsset{}))
	t.Setenv("PLAYGROUND_ASSETS_DIR", t.TempDir())
	store, err := storage.ForBackend("local")
	require.NoError(t, err)
	f, err := os.CreateTemp(t.TempDir(), "video")
	require.NoError(t, err)
	defer f.Close()
	require.NoError(t, f.Truncate((200<<20)+1))
	_, err = f.WriteAt([]byte{0, 0, 0, 24, 'f', 't', 'y', 'p', 'i', 's', 'o', 'm'}, 0)
	require.NoError(t, err)
	a := &model.PlaygroundAsset{UserId: 42, Kind: "video", Mime: "video/mp4", Size: 200 << 20, Backend: "local", StorageKey: "upload-intents/42/large", UploadState: "pending", UploadExpiresAt: time.Now().Add(time.Hour).Unix()}
	require.NoError(t, model.CreatePlaygroundAsset(a))
	require.NoError(t, store.Put(context.Background(), a.StorageKey, io.NewSectionReader(f, 0, (200<<20)+1), (200<<20)+1, a.Mime))
	_, err = finalizePlaygroundUpload(context.Background(), a.Id, 42)
	require.Error(t, err, "oversize actual object must not become ready")
	require.NoError(t, store.Put(context.Background(), a.StorageKey, io.NewSectionReader(f, 0, 200<<20), 200<<20, a.Mime))
	ready, err := finalizePlaygroundUpload(context.Background(), a.Id, 42)
	require.NoError(t, err)
	assert.Equal(t, "ready", ready.UploadState)
	assert.EqualValues(t, 200<<20, ready.Size)
}

func TestFinalizePlaygroundUploadLifecycle(t *testing.T) {
	db := setupVideoProxyTestDB(t)
	require.NoError(t, db.AutoMigrate(&model.PlaygroundAsset{}))
	t.Setenv("PLAYGROUND_ASSETS_DIR", t.TempDir())
	store, err := storage.ForBackend("local")
	require.NoError(t, err)
	ctx := context.Background()
	png := []byte("\x89PNG\r\n\x1a\nverified-image")
	asset := &model.PlaygroundAsset{UserId: 42, Kind: "image", Mime: "image/png", Size: int64(len(png)), Backend: "local", StorageKey: "upload-intents/42/image", UploadState: "pending", UploadExpiresAt: time.Now().Add(time.Hour).Unix()}
	require.NoError(t, model.CreatePlaygroundAsset(asset))
	_, err = finalizePlaygroundUpload(ctx, asset.Id, 42)
	require.Error(t, err, "missing upload must not finalize")
	require.NoError(t, store.Put(ctx, asset.StorageKey, bytes.NewReader(png), int64(len(png)), "image/png"))
	_, err = finalizePlaygroundUpload(ctx, asset.Id, 43)
	require.Error(t, err, "other owner must not finalize")
	_, err = model.GetPlaygroundAsset(asset.Id, 42)
	require.Error(t, err, "pending must not be usable")

	recorder := httptest.NewRecorder()
	c, _ := gin.CreateTestContext(recorder)
	c.Request = httptest.NewRequest(http.MethodPost, "/finalize", nil)
	c.Params = gin.Params{{Key: "id", Value: strconv.Itoa(asset.Id)}}
	c.Set("id", 42)
	FinalizePlaygroundUpload(c)
	assert.Contains(t, recorder.Body.String(), `"success":true`)
	assert.NotContains(t, recorder.Body.String(), "storage_key")
	ready, err := model.GetPlaygroundAsset(asset.Id, 42)
	require.NoError(t, err)
	assert.Equal(t, "ready", ready.UploadState)
	assert.NotEqual(t, asset.StorageKey, ready.StorageKey)
	assert.Equal(t, playgroundAssetContentURL(asset.Id), ready.URL)

	// Replay of a still-valid PUT must not change the verified snapshot.
	require.NoError(t, store.Put(ctx, asset.StorageKey, bytes.NewBufferString("replayed"), 8, "text/html"))
	again, err := finalizePlaygroundUpload(ctx, asset.Id, 42)
	require.NoError(t, err)
	assert.Equal(t, ready.StorageKey, again.StorageKey)
	body, err := store.Open(ctx, ready.StorageKey)
	require.NoError(t, err)
	defer body.Close()
	data, err := io.ReadAll(body)
	require.NoError(t, err)
	assert.Equal(t, png, data)
}

func TestFinalizePlaygroundUploadRejectsInvalidObjects(t *testing.T) {
	for _, tc := range []struct {
		name         string
		data         []byte
		mime         string
		declaredSize int64
		expired      bool
	}{
		{"size mismatch", []byte("\x89PNG\r\n\x1a\n"), "image/png", 9, false},
		{"spoofed mime", []byte("<html>not an image</html>"), "image/png", 25, false},
		{"different image type", []byte("GIF89a1234"), "image/png", 10, false},
		{"expired", []byte("\x89PNG\r\n\x1a\n"), "image/png", 8, true},
		{"oversize", bytes.Repeat([]byte("x"), service.PlaygroundAssetMaxImageBytes+1), "image/png", 8, false},
	} {
		t.Run(tc.name, func(t *testing.T) {
			db := setupVideoProxyTestDB(t)
			require.NoError(t, db.AutoMigrate(&model.PlaygroundAsset{}))
			t.Setenv("PLAYGROUND_ASSETS_DIR", t.TempDir())
			store, err := storage.ForBackend("local")
			require.NoError(t, err)
			expires := time.Now().Add(time.Hour).Unix()
			if tc.expired {
				expires = 1
			}
			asset := &model.PlaygroundAsset{UserId: 42, Kind: "image", Mime: tc.mime, Size: tc.declaredSize, StorageKey: "upload-intents/42/bad", UploadState: "pending", UploadExpiresAt: expires}
			require.NoError(t, model.CreatePlaygroundAsset(asset))
			require.NoError(t, store.Put(context.Background(), asset.StorageKey, bytes.NewReader(tc.data), int64(len(tc.data)), tc.mime))
			_, err = finalizePlaygroundUpload(context.Background(), asset.Id, 42)
			require.Error(t, err)
			pending, err := model.GetPlaygroundUploadIntent(asset.Id, 42)
			require.NoError(t, err)
			assert.Equal(t, "pending", pending.UploadState)
			assert.Empty(t, pending.URL)
		})
	}
}

func TestCleanupExpiredPlaygroundUploadsPreservesReadyAssets(t *testing.T) {
	db := setupVideoProxyTestDB(t)
	require.NoError(t, db.AutoMigrate(&model.PlaygroundAsset{}))
	t.Setenv("PLAYGROUND_ASSETS_DIR", t.TempDir())
	store, err := storage.ForBackend("local")
	require.NoError(t, err)
	now := time.Now()
	for _, state := range []string{"pending", "ready", ""} {
		a := &model.PlaygroundAsset{UserId: 42, Kind: "image", StorageKey: "upload-intents/42/" + state + "object", UploadState: state, UploadExpiresAt: now.Add(-2 * time.Hour).Unix()}
		require.NoError(t, model.CreatePlaygroundAsset(a))
		require.NoError(t, store.Put(context.Background(), a.StorageKey, bytes.NewBufferString("data"), 4, "image/png"))
	}
	require.NoError(t, CleanupExpiredPlaygroundUploads(context.Background(), now, 100))
	var assets []model.PlaygroundAsset
	require.NoError(t, db.Find(&assets).Error)
	require.Len(t, assets, 2)
	for _, a := range assets {
		assert.NotEqual(t, "pending", a.UploadState)
		body, err := store.Open(context.Background(), a.StorageKey)
		require.NoError(t, err)
		require.NoError(t, body.Close())
	}
	_, err = store.Open(context.Background(), "upload-intents/42/pendingobject")
	require.Error(t, err)
}
