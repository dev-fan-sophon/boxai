package model

import (
	"testing"

	"github.com/glebarez/sqlite"
	"github.com/stretchr/testify/assert"
	"github.com/stretchr/testify/require"
	"gorm.io/gorm"
)

func TestPlaygroundUploadVisibilityAndCAS(t *testing.T) {
	old := DB
	db, err := gorm.Open(sqlite.Open("file:"+t.Name()+"?mode=memory&cache=shared"), &gorm.Config{})
	require.NoError(t, err)
	require.NoError(t, db.AutoMigrate(&PlaygroundAsset{}))
	DB = db
	t.Cleanup(func() { DB = old })
	for _, state := range []string{"pending", "ready", ""} {
		a := &PlaygroundAsset{UserId: 42, Kind: "document", StorageKey: "key", UploadState: state, UploadExpiresAt: 100}
		require.NoError(t, CreatePlaygroundAsset(a))
		_, err = GetPlaygroundAsset(a.Id, 42)
		_, byIDErr := GetPlaygroundAssetById(a.Id)
		if state == "pending" {
			require.ErrorIs(t, err, gorm.ErrRecordNotFound)
			require.ErrorIs(t, byIDErr, gorm.ErrRecordNotFound)
		} else {
			require.NoError(t, err)
			require.NoError(t, byIDErr)
		}
	}
	items, total, err := ListPlaygroundAssets(42, "document", PlaygroundAssetSourceLibrary, 0, 10)
	require.NoError(t, err)
	assert.EqualValues(t, 2, total)
	assert.Len(t, items, 2)
	backfill, err := ListPlaygroundAssetsForBackfill(10)
	require.NoError(t, err)
	assert.Len(t, backfill, 2)
	for _, tc := range []struct {
		user int
		now  int64
		want bool
	}{
		{43, 99, false}, {42, 100, false}, {42, 99, true}, {42, 99, false},
	} {
		ok, err := FinalizePlaygroundUploadCAS(1, tc.user, "verified", "image/png", "/content", 8, tc.now)
		require.NoError(t, err)
		assert.Equal(t, tc.want, ok)
	}
	require.NoError(t, DeleteExpiredPlaygroundUpload(1, 200))
	ready, err := GetPlaygroundAsset(1, 42)
	require.NoError(t, err)
	assert.Equal(t, "verified", ready.StorageKey)
}
