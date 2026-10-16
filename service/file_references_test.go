package service

import (
	"strconv"
	"testing"

	"github.com/dev-fan-sophon/boxai/model"
	"github.com/dev-fan-sophon/boxai/service/storage"
	"github.com/dev-fan-sophon/boxai/setting/system_setting"
	"github.com/glebarez/sqlite"
	"github.com/stretchr/testify/assert"
	"github.com/stretchr/testify/require"
	"gorm.io/gorm"
)

// setupFileReferenceTest wires an asset row store and a local object store so
// handles resolve without R2 credentials.
func setupFileReferenceTest(t *testing.T) {
	t.Helper()
	oldDB, oldAddress := model.DB, system_setting.ServerAddress
	db, err := gorm.Open(sqlite.Open(":memory:"), &gorm.Config{})
	require.NoError(t, err)
	require.NoError(t, db.AutoMigrate(&model.PlaygroundAsset{}))
	model.DB = db
	system_setting.ServerAddress = "https://example.test"
	t.Setenv("STORAGE_BACKEND", "local")
	t.Setenv("PLAYGROUND_ASSETS_DIR", t.TempDir())
	t.Setenv("CRYPTO_SECRET", "file-reference-test-secret")
	storage.Reset()
	t.Cleanup(func() {
		model.DB = oldDB
		system_setting.ServerAddress = oldAddress
		storage.Reset()
		sqlDB, dbErr := db.DB()
		require.NoError(t, dbErr)
		require.NoError(t, sqlDB.Close())
	})
}

func createFileReferenceAsset(t *testing.T, userID int, kind string) *model.PlaygroundAsset {
	t.Helper()
	asset := &model.PlaygroundAsset{
		UserId:     userID,
		Kind:       kind,
		Source:     model.PlaygroundAssetSourceAttachment,
		Name:       "clip.png",
		StorageKey: "uploads/1/clip.png",
		Backend:    "local",
		Mime:       "image/png",
		Size:       8,
	}
	require.NoError(t, model.CreatePlaygroundAsset(asset))
	return asset
}

func TestResolveFileReferencePassesThroughForeignValues(t *testing.T) {
	setupFileReferenceTest(t)
	for _, value := range []string{"", "https://example.com/a.png", "data:image/png;base64,AAAA", "asset://ast-1"} {
		resolved, err := ResolveFileReference(1, value)
		require.NoError(t, err, value)
		assert.Equal(t, value, resolved)
	}
}

func TestResolveFileReferenceRejectsUnknownHandle(t *testing.T) {
	setupFileReferenceTest(t)
	_, err := ResolveFileReference(1, "file-4242")
	require.Error(t, err)
	assert.Contains(t, err.Error(), "not found")

	_, err = ResolveFileReference(1, "file-not-a-number")
	require.Error(t, err)
	assert.Contains(t, err.Error(), "invalid file reference")
}

func TestResolveFileReferenceIsOwnerScoped(t *testing.T) {
	setupFileReferenceTest(t)
	asset := createFileReferenceAsset(t, 7, "image")

	resolved, err := ResolveFileReference(7, "file-"+itoa(asset.Id))
	require.NoError(t, err)
	assert.Contains(t, resolved, "https://example.test")
	assert.Contains(t, resolved, "media-fetch")

	// Another account's handle must not resolve.
	_, err = ResolveFileReference(8, "file-"+itoa(asset.Id))
	require.Error(t, err)
	assert.Contains(t, err.Error(), "not found")
}

func TestResolveFileReferencesInJSONRewritesMediaFieldsOnly(t *testing.T) {
	setupFileReferenceTest(t)
	asset := createFileReferenceAsset(t, 3, "image")
	handle := "file-" + itoa(asset.Id)

	for _, test := range []struct{ name, raw string }{
		{"string", `"` + handle + `"`},
		{"array", `["` + handle + `","https://example.com/b.png"]`},
		{"object", `{"url":"` + handle + `"}`},
	} {
		t.Run(test.name, func(t *testing.T) {
			resolved, err := ResolveFileReferencesInJSON(3, []byte(test.raw))
			require.NoError(t, err)
			assert.NotContains(t, string(resolved), handle)
			assert.Contains(t, string(resolved), "media-fetch")
		})
	}

	// Requests without handles keep their exact bytes.
	untouched := []byte(`{"prompt":"a file-1 shaped prompt","url":"https://example.com/c.png"}`)
	resolved, err := ResolveFileReferencesInJSON(3, untouched)
	require.NoError(t, err)
	assert.Equal(t, string(untouched), string(resolved))

	_, err = ResolveFileReferencesInJSON(3, []byte(`{"url":"file-4242"}`))
	require.Error(t, err)
}

func TestResolveFileReferencesKeepsNonHandlesInPlace(t *testing.T) {
	setupFileReferenceTest(t)
	asset := createFileReferenceAsset(t, 5, "video")
	values := []string{"https://example.com/a.mp4", "file-" + itoa(asset.Id)}

	resolved, err := ResolveFileReferences(5, values)
	require.NoError(t, err)
	assert.Equal(t, "https://example.com/a.mp4", resolved[0])
	assert.Contains(t, resolved[1], "media-fetch")
	assert.Equal(t, "file-"+itoa(asset.Id), values[1], "the source slice stays untouched")
}

func itoa(value int) string {
	return strconv.Itoa(value)
}
