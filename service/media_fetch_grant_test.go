package service

import (
	"crypto/hmac"
	"crypto/sha256"
	"encoding/base64"
	"strings"
	"testing"

	"github.com/dev-fan-sophon/boxai/model"
	"github.com/glebarez/sqlite"
	"github.com/stretchr/testify/assert"
	"github.com/stretchr/testify/require"
	"gorm.io/gorm"
)

func TestMediaFetchGrantSecurity(t *testing.T) {
	t.Setenv("CRYPTO_SECRET", "shared-test-secret")
	db, err := gorm.Open(sqlite.Open(":memory:"), &gorm.Config{})
	require.NoError(t, err)
	old := model.DB
	model.DB = db
	t.Cleanup(func() { model.DB = old })
	require.NoError(t, db.AutoMigrate(&model.PlaygroundAsset{}))
	require.NoError(t, db.Create(&model.PlaygroundAsset{Id: 1, UserId: 7, Kind: "video", StorageKey: "video"}).Error)
	path, err := IssueMediaFetchGrant(7, 1)
	require.NoError(t, err)
	token := strings.TrimPrefix(path, "/api/playground/media-fetch/")
	for range 2 {
		u, a, ok := ConsumeMediaFetchGrant(token)
		require.True(t, ok)
		assert.Equal(t, 7, u)
		assert.Equal(t, 1, a)
	}
	_, err = IssueMediaFetchGrant(8, 1)
	require.Error(t, err)
	_, _, ok := ConsumeMediaFetchGrant(token + "x")
	assert.False(t, ok)
	// The valid independently signed token was never issued by this process.
	for _, claims := range []string{"media-fetch-v1:7:1:9999999999", "media-fetch-v1:7:1:1", "other-scope:7:1:9999999999", "media-fetch-v1:0:1:9999999999"} {
		mac := hmac.New(sha256.New, []byte("shared-test-secret"))
		mac.Write([]byte(claims))
		forged := base64.RawURLEncoding.EncodeToString([]byte(claims)) + "." + base64.RawURLEncoding.EncodeToString(mac.Sum(nil))
		_, _, ok := ConsumeMediaFetchGrant(forged)
		assert.Equal(t, claims == "media-fetch-v1:7:1:9999999999", ok, claims)
	}
	for _, state := range []string{"pending", "failed"} {
		require.NoError(t, db.Model(&model.PlaygroundAsset{}).Where("id = 1").Update("upload_state", state).Error)
		_, err = IssueMediaFetchGrant(7, 1)
		require.Error(t, err)
		_, err = GetMediaFetchAsset(7, 1)
		require.Error(t, err)
	}
	require.NoError(t, db.Model(&model.PlaygroundAsset{}).Where("id = 1").Updates(map[string]any{"upload_state": "ready", "kind": "document"}).Error)
	_, err = IssueMediaFetchGrant(7, 1)
	require.Error(t, err)
	t.Setenv("CRYPTO_SECRET", "rotated-secret")
	_, _, ok = ConsumeMediaFetchGrant(token)
	assert.False(t, ok)
	t.Setenv("CRYPTO_SECRET", "")
	t.Setenv("SESSION_SECRET", "")
	_, err = IssueMediaFetchGrant(7, 1)
	require.Error(t, err)
	_, _, ok = ConsumeMediaFetchGrant(token)
	assert.False(t, ok)
}

func TestPrivateReferenceMediaURLValidation(t *testing.T) {
	for _, raw := range []string{"https://cdn.example/ref.mp4", "https://other.example/api/playground/assets/1/content", "asset://provider-id"} {
		got, err := PrivateReferenceMediaURL(raw, "", 0)
		require.NoError(t, err)
		assert.Equal(t, raw, got)
	}
	for _, raw := range []string{"/api/playground/assets/1", "/api/playground/assets/1/content/extra", "/api/playground/assets/0/content", "/api/playground/assets/1/content?x=y"} {
		_, err := PrivateReferenceMediaURL(raw, "https://you-box.com", 7)
		require.Error(t, err)
	}
	_, err := PrivateReferenceMediaURL("/api/playground/assets/1/content", "", 7)
	require.Error(t, err)
}
