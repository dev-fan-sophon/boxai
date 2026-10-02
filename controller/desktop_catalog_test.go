package controller

import (
	"crypto/sha256"
	"encoding/base64"
	"net/http"
	"net/http/httptest"
	"strings"
	"testing"
	"time"

	"github.com/dev-fan-sophon/boxai/common"
	"github.com/dev-fan-sophon/boxai/model"
	"github.com/dev-fan-sophon/boxai/service"
	"github.com/gin-gonic/gin"
	"github.com/stretchr/testify/assert"
	"github.com/stretchr/testify/require"
)

func TestDesktopCatalogSessionAndValidatedSharedData(t *testing.T) {
	db := setupModelListControllerTestDB(t)
	require.NoError(t, db.AutoMigrate(&model.Token{}, &model.Option{}, &model.DesktopAuthorization{}, &model.DesktopSession{}, &model.ConnectorMCPServer{}, &model.ConnectorSkillRelease{}))
	user := model.User{Username: "catalog-user", Status: common.UserStatusEnabled}
	require.NoError(t, db.Create(&user).Error)
	verifier := strings.Repeat("v", 43)
	digest := sha256.Sum256([]byte(verifier))
	request, err := service.CreateDesktopAuthorization(service.DesktopClientID, "http://127.0.0.1:49152/auth/callback", base64.RawURLEncoding.EncodeToString(digest[:]), "S256", strings.Repeat("s", 24), "Catalog test")
	require.NoError(t, err)
	code, _, err := service.DecideDesktopAuthorization(request.ID, user.Id, true)
	require.NoError(t, err)
	access, _, key, _, err := service.ExchangeDesktopCode(code, verifier, service.DesktopClientID, request.RedirectURI)
	require.NoError(t, err)
	var session model.DesktopSession
	require.NoError(t, db.First(&session).Error)
	require.NoError(t, db.Create(&model.ConnectorMCPServer{ID: "boxai-media", Name: "BoxAI Media", URL: "http://localhost:3000/mcp", Authorization: "connection_bearer", Enabled: true}).Error)
	release := model.ConnectorSkillRelease{ID: "media-skill", Version: "1.0.0", Name: "Media skill", ArchiveURL: "https://dl.you-box.com/connect/catalog/media.zip", ArchiveSHA256: strings.Repeat("a", 64), ArchiveSizeBytes: 1024, ArchiveFormat: "zip", ArchiveAuthorization: "none", Enabled: true}
	require.NoError(t, db.Create(&release).Error)

	read := func(token string) *httptest.ResponseRecorder {
		recorder := httptest.NewRecorder()
		ctx, _ := gin.CreateTestContext(recorder)
		ctx.Request = httptest.NewRequest(http.MethodGet, "/api/desktop/catalog", nil)
		if token != "" {
			ctx.Request.Header.Set("Authorization", "Bearer "+token)
		}
		GetDesktopCatalog(ctx)
		assert.Contains(t, recorder.Header().Get("Cache-Control"), "no-store")
		return recorder
	}
	for _, token := range []string{"", "invalid", key} {
		assert.Equal(t, http.StatusUnauthorized, read(token).Code)
	}
	result := read(access)
	require.Equal(t, http.StatusOK, result.Code)
	var body struct {
		Success bool `json:"success"`
		Data    struct {
			Skills []connectorSkill     `json:"skills"`
			MCP    []connectorMCPServer `json:"mcp_servers"`
		} `json:"data"`
	}
	require.NoError(t, common.Unmarshal(result.Body.Bytes(), &body))
	assert.True(t, body.Success)
	require.Len(t, body.Data.Skills, 1)
	require.Len(t, body.Data.MCP, 1)
	assert.Equal(t, release.ArchiveSHA256, body.Data.Skills[0].Archive.SHA256)
	assert.Equal(t, int64(1024), body.Data.Skills[0].Archive.SizeBytes)
	assert.NotContains(t, result.Body.String(), key)

	require.NoError(t, db.Model(&model.ConnectorSkillRelease{}).Where("id = ?", release.ID).Update("enabled", false).Error)
	result = read(access)
	require.NoError(t, common.Unmarshal(result.Body.Bytes(), &body))
	assert.Empty(t, body.Data.Skills)
	require.NoError(t, db.Model(&model.ConnectorSkillRelease{}).Where("id = ?", release.ID).Updates(map[string]any{"enabled": true, "archive_sha256": "bad"}).Error)
	assert.Equal(t, http.StatusServiceUnavailable, read(access).Code)

	for _, mutation := range []map[string]any{
		{"client_id": service.ConnectClientID},
		{"client_id": service.DesktopClientID, "revoked_at": 1},
		{"revoked_at": 0, "expires_at": time.Now().Unix() - 1},
	} {
		require.NoError(t, db.Model(&model.DesktopSession{}).Where("id = ?", session.ID).Updates(mutation).Error)
		assert.Equal(t, http.StatusUnauthorized, read(access).Code)
	}
}
