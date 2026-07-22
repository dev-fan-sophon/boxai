package service

import (
	"bytes"
	"context"
	"io"
	"testing"

	"github.com/QuantumNous/new-api/model"
	"github.com/QuantumNous/new-api/service/storage"
	"github.com/stretchr/testify/assert"
	"github.com/stretchr/testify/require"
)

func TestMigratePlaygroundAssetsCopiesObjectAndUpdatesBackend(t *testing.T) {
	require.NoError(t, model.DB.AutoMigrate(&model.PlaygroundAsset{}))
	t.Cleanup(func() { model.DB.Exec("DELETE FROM playground_assets") })

	ctx := context.Background()
	src := storage.NewLocalStore(t.TempDir())
	dst := storage.NewLocalStore(t.TempDir())

	payload := []byte("hello-object")
	key := "outputs/7/file.png"
	require.NoError(t, src.Put(ctx, key, bytes.NewReader(payload), int64(len(payload)), "image/png"))

	asset := &model.PlaygroundAsset{
		UserId: 7, Kind: "image", StorageKey: key, Backend: "local",
		Mime: "image/png", Size: int64(len(payload)), Visibility: "private",
	}
	require.NoError(t, model.CreatePlaygroundAsset(asset))

	candidates, err := model.ListPlaygroundAssetsForBackfill(0)
	require.NoError(t, err)
	require.Len(t, candidates, 1)

	migrated, failed := migratePlaygroundAssets(ctx, src, dst, candidates)
	assert.Equal(t, 1, migrated)
	assert.Equal(t, 0, failed)

	rc, err := dst.Open(ctx, key)
	require.NoError(t, err)
	got, err := io.ReadAll(rc)
	require.NoError(t, rc.Close())
	require.NoError(t, err)
	assert.Equal(t, payload, got)

	updated, err := model.GetPlaygroundAssetById(asset.Id)
	require.NoError(t, err)
	assert.Equal(t, dst.Backend(), updated.Backend)
}

func TestMigratePlaygroundAssetsCountsMissingObjectAsFailed(t *testing.T) {
	require.NoError(t, model.DB.AutoMigrate(&model.PlaygroundAsset{}))
	t.Cleanup(func() { model.DB.Exec("DELETE FROM playground_assets") })

	ctx := context.Background()
	src := storage.NewLocalStore(t.TempDir())
	dst := storage.NewLocalStore(t.TempDir())

	asset := &model.PlaygroundAsset{
		UserId: 1, Kind: "image", StorageKey: "outputs/1/missing.png",
		Backend: "local", Mime: "image/png", Size: 10,
	}
	require.NoError(t, model.CreatePlaygroundAsset(asset))

	migrated, failed := migratePlaygroundAssets(ctx, src, dst, []model.PlaygroundAsset{*asset})
	assert.Equal(t, 0, migrated)
	assert.Equal(t, 1, failed)
}

func TestListPlaygroundAssetsForBackfillFiltersByBackend(t *testing.T) {
	require.NoError(t, model.DB.AutoMigrate(&model.PlaygroundAsset{}))
	t.Cleanup(func() { model.DB.Exec("DELETE FROM playground_assets") })

	local := &model.PlaygroundAsset{UserId: 1, Kind: "image", StorageKey: "a.png", Backend: "local"}
	legacy := &model.PlaygroundAsset{UserId: 1, Kind: "image", StorageKey: "b.png", Backend: ""}
	remote := &model.PlaygroundAsset{UserId: 1, Kind: "image", StorageKey: "c.png", Backend: "r2"}
	noKey := &model.PlaygroundAsset{UserId: 1, Kind: "image", StorageKey: "", Backend: "local"}
	require.NoError(t, model.CreatePlaygroundAsset(local))
	require.NoError(t, model.CreatePlaygroundAsset(legacy))
	require.NoError(t, model.CreatePlaygroundAsset(remote))
	require.NoError(t, model.CreatePlaygroundAsset(noKey))

	got, err := model.ListPlaygroundAssetsForBackfill(0)
	require.NoError(t, err)
	keys := make([]string, 0, len(got))
	for _, a := range got {
		keys = append(keys, a.StorageKey)
	}
	assert.ElementsMatch(t, []string{"a.png", "b.png"}, keys)
}
