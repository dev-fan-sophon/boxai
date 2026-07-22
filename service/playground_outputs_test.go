package service

import (
	"context"
	"encoding/base64"
	"io"
	"strings"
	"testing"

	"github.com/QuantumNous/new-api/model"
	"github.com/QuantumNous/new-api/service/storage"
	"github.com/stretchr/testify/assert"
	"github.com/stretchr/testify/require"
)

func TestPersistPlaygroundOutputDataURL(t *testing.T) {
	require.NoError(t, model.DB.AutoMigrate(&model.PlaygroundAsset{}))
	t.Cleanup(func() { model.DB.Exec("DELETE FROM playground_assets") })

	root := t.TempDir()
	t.Setenv("STORAGE_BACKEND", "local")
	t.Setenv("PLAYGROUND_ASSETS_DIR", root)
	storage.Reset()
	t.Cleanup(storage.Reset)

	png := []byte{
		0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a,
		0x00, 0x00, 0x00, 0x0d, 0x49, 0x48, 0x44, 0x52,
		0x00, 0x00, 0x00, 0x01, 0x00, 0x00, 0x00, 0x01,
	}
	dataURL := "data:image/png;base64," + base64.StdEncoding.EncodeToString(png)

	asset, err := PersistPlaygroundOutput(context.Background(), 99, "image", dataURL)
	require.NoError(t, err)
	require.NotNil(t, asset)
	assert.Equal(t, "image", asset.Kind)
	assert.Equal(t, "image/png", asset.Mime)
	assert.Equal(t, "local", asset.Backend)
	assert.True(t, strings.HasPrefix(asset.StorageKey, "outputs/99/"), "key: %s", asset.StorageKey)
	assert.NotZero(t, asset.Id)

	_, body, err := OpenPlaygroundAssetContent(context.Background(), asset.StorageKey, 0)
	require.NoError(t, err)
	got, err := io.ReadAll(body)
	require.NoError(t, body.Close())
	require.NoError(t, err)
	assert.Equal(t, png, got)
}

func TestPersistPlaygroundVideoDataURL(t *testing.T) {
	require.NoError(t, model.DB.AutoMigrate(&model.PlaygroundAsset{}))
	t.Cleanup(func() { model.DB.Exec("DELETE FROM playground_assets") })

	root := t.TempDir()
	t.Setenv("STORAGE_BACKEND", "local")
	t.Setenv("PLAYGROUND_ASSETS_DIR", root)
	storage.Reset()
	t.Cleanup(storage.Reset)

	// Minimal mp4 ftyp box header + payload; declared mime drives the kind.
	mp4 := append([]byte{0x00, 0x00, 0x00, 0x18, 0x66, 0x74, 0x79, 0x70}, []byte("isom video bytes")...)
	dataURL := "data:video/mp4;base64," + base64.StdEncoding.EncodeToString(mp4)

	asset, err := PersistPlaygroundOutput(context.Background(), 5, "video", dataURL)
	require.NoError(t, err)
	require.NotNil(t, asset)
	assert.Equal(t, "video", asset.Kind)
	assert.Equal(t, "video/mp4", asset.Mime)
	assert.True(t, strings.HasPrefix(asset.StorageKey, "outputs/5/"), "key: %s", asset.StorageKey)
}

func TestPlaygroundRunTaskLinkage(t *testing.T) {
	require.NoError(t, model.DB.AutoMigrate(&model.PlaygroundRun{}))
	t.Cleanup(func() { model.DB.Exec("DELETE FROM playground_runs") })

	_, err := model.GetPlaygroundRunByTaskId("missing")
	assert.Error(t, err)

	run := &model.PlaygroundRun{UserId: 3, Modality: "video", TaskId: "task-abc"}
	require.NoError(t, model.CreatePlaygroundRun(run))

	got, err := model.GetPlaygroundRunByTaskId("task-abc")
	require.NoError(t, err)
	assert.Equal(t, run.Id, got.Id)
	assert.Equal(t, 0, got.AssetId)

	require.NoError(t, model.UpdatePlaygroundRunResult(run.Id, 77, "/api/playground/assets/77/content"))
	got, err = model.GetPlaygroundRunByTaskId("task-abc")
	require.NoError(t, err)
	assert.Equal(t, 77, got.AssetId)
	assert.Equal(t, "/api/playground/assets/77/content", got.ResultURL)
}

func TestSeedAndListPlaygroundAgents(t *testing.T) {
	require.NoError(t, model.DB.AutoMigrate(&model.PlaygroundAgent{}))
	t.Cleanup(func() { model.DB.Exec("DELETE FROM playground_agents") })

	require.NoError(t, model.SeedPlaygroundAgentsIfEmpty())
	// Seeding is idempotent: a second call is a no-op.
	require.NoError(t, model.SeedPlaygroundAgentsIfEmpty())

	agents, err := model.ListPlaygroundAgents()
	require.NoError(t, err)
	assert.Equal(t, 8, len(agents))
	assert.Equal(t, "api-docs", agents[0].Slug) // ordered by sort_order

	require.NoError(t, model.DB.Model(&model.PlaygroundAgent{}).
		Where("slug = ?", "pricing").Update("enabled", false).Error)
	agents, err = model.ListPlaygroundAgents()
	require.NoError(t, err)
	assert.Equal(t, 7, len(agents)) // disabled agents are excluded
}

func TestPersistPlaygroundOutputNotPersistable(t *testing.T) {
	root := t.TempDir()
	t.Setenv("STORAGE_BACKEND", "local")
	t.Setenv("PLAYGROUND_ASSETS_DIR", root)
	storage.Reset()
	t.Cleanup(storage.Reset)

	for _, ref := range []string{"", "   ", "/api/playground/assets/1/content", "ftp://example.com/x.png"} {
		asset, err := PersistPlaygroundOutput(context.Background(), 1, "image", ref)
		require.NoError(t, err, "ref=%q", ref)
		assert.Nil(t, asset, "ref=%q", ref)
	}
}
