package controller

import (
	"bytes"
	"net/http"
	"net/http/httptest"
	"strings"
	"testing"

	"github.com/dev-fan-sophon/boxai/common"
	"github.com/dev-fan-sophon/boxai/model"
	"github.com/gin-gonic/gin"
	"github.com/stretchr/testify/assert"
	"github.com/stretchr/testify/require"
)

func connectorCatalogRequest(t *testing.T, method, target string, body any, params ...gin.Param) (*gin.Context, *httptest.ResponseRecorder) {
	t.Helper()
	encoded, err := common.Marshal(body)
	require.NoError(t, err)
	recorder := httptest.NewRecorder()
	ctx, _ := gin.CreateTestContext(recorder)
	ctx.Request = httptest.NewRequest(method, target, bytes.NewReader(encoded))
	ctx.Request.Header.Set("Content-Type", "application/json")
	ctx.Params = params
	return ctx, recorder
}

func TestConnectorCatalogAdminCRUD(t *testing.T) {
	gin.SetMode(gin.TestMode)
	db := setupModelListControllerTestDB(t)
	require.NoError(t, db.AutoMigrate(&model.ConnectorCatalogState{}, &model.ConnectorMCPServer{}, &model.ConnectorSkillRelease{}))
	require.NoError(t, db.Create(&model.ConnectorCatalogState{ID: 1}).Error)

	mcp := model.ConnectorMCPServer{
		ID: "boxai-tools", Name: "BoxAI Tools", URL: "http://localhost:3000/mcp",
		Authorization: "connection_bearer", Description: "BoxAI-managed tools", Enabled: true,
	}
	ctx, recorder := connectorCatalogRequest(t, http.MethodPost, "/api/admin/connector/mcp-servers", mcp)
	AdminCreateConnectorMCPServer(ctx)
	require.Equal(t, http.StatusOK, recorder.Code)
	var storedMCP model.ConnectorMCPServer
	require.NoError(t, db.First(&storedMCP, "id = ?", mcp.ID).Error)
	assert.True(t, storedMCP.Enabled)

	mcp.Enabled = false
	ctx, recorder = connectorCatalogRequest(t, http.MethodPut, "/api/admin/connector/mcp-servers/boxai-tools", mcp, gin.Param{Key: "id", Value: mcp.ID})
	AdminUpdateConnectorMCPServer(ctx)
	require.Equal(t, http.StatusOK, recorder.Code)
	require.NoError(t, db.First(&storedMCP, "id = ?", mcp.ID).Error)
	assert.False(t, storedMCP.Enabled)

	release := model.ConnectorSkillRelease{
		ID: "boxai-coding", Version: "1.2.3", Name: "BoxAI Coding",
		ArchiveURL:    "https://downloads.you-box.com/skills/boxai-coding-1.2.3.zip",
		ArchiveSHA256: strings.Repeat("a", 64), ArchiveSizeBytes: 4096,
		ArchiveFormat: "zip", ArchiveAuthorization: "none", Enabled: true,
	}
	ctx, recorder = connectorCatalogRequest(t, http.MethodPost, "/api/admin/connector/skill-releases", release)
	AdminCreateConnectorSkillRelease(ctx)
	require.Equal(t, http.StatusOK, recorder.Code)
	var storedRelease model.ConnectorSkillRelease
	require.NoError(t, db.First(&storedRelease, "id = ? AND version = ?", release.ID, release.Version).Error)
	assert.Equal(t, release.ArchiveSHA256, storedRelease.ArchiveSHA256)

	secondRelease := release
	secondRelease.Version = "2.0.0"
	ctx, recorder = connectorCatalogRequest(t, http.MethodPost, "/api/admin/connector/skill-releases", secondRelease)
	AdminCreateConnectorSkillRelease(ctx)
	require.Equal(t, http.StatusOK, recorder.Code)
	assert.Contains(t, recorder.Body.String(), "only one release per Skill may be enabled")
	var secondCount int64
	require.NoError(t, db.Model(&model.ConnectorSkillRelease{}).Where("id = ? AND version = ?", secondRelease.ID, secondRelease.Version).Count(&secondCount).Error)
	assert.Zero(t, secondCount)

	ctx, recorder = connectorCatalogRequest(t, http.MethodDelete, "/api/admin/connector/skill-releases/boxai-coding/1.2.3", nil,
		gin.Param{Key: "id", Value: release.ID}, gin.Param{Key: "version", Value: release.Version})
	AdminDeleteConnectorSkillRelease(ctx)
	require.Equal(t, http.StatusOK, recorder.Code)
	var count int64
	require.NoError(t, db.Model(&model.ConnectorSkillRelease{}).Where("id = ? AND version = ?", release.ID, release.Version).Count(&count).Error)
	assert.Zero(t, count)

	ctx, recorder = connectorCatalogRequest(t, http.MethodDelete, "/api/admin/connector/mcp-servers/boxai-tools", nil,
		gin.Param{Key: "id", Value: mcp.ID})
	AdminDeleteConnectorMCPServer(ctx)
	require.Equal(t, http.StatusOK, recorder.Code)
	require.NoError(t, db.Model(&model.ConnectorMCPServer{}).Where("id = ?", mcp.ID).Count(&count).Error)
	assert.Zero(t, count)
}

func TestConnectorCatalogValidationRejectsUnsafeRemoteDescriptors(t *testing.T) {
	gin.SetMode(gin.TestMode)
	valid := model.ConnectorSkillRelease{
		ID: "boxai-skill", Version: "1.0.0", Name: "BoxAI Skill",
		ArchiveURL:    "https://you-box.com/skill.zip",
		ArchiveSHA256: strings.Repeat("a", 64), ArchiveSizeBytes: 1024,
		ArchiveFormat: "zip", ArchiveAuthorization: "connection_bearer", Enabled: true,
	}
	allowedOrigins := []string{"https://you-box.com"}
	assert.Empty(t, validateConnectorSkillRelease(&valid, allowedOrigins))

	tests := []struct {
		name   string
		mutate func(*model.ConnectorSkillRelease)
	}{
		{name: "public HTTP", mutate: func(r *model.ConnectorSkillRelease) { r.ArchiveURL = "http://example.com/skill.zip" }},
		{name: "uppercase digest", mutate: func(r *model.ConnectorSkillRelease) { r.ArchiveSHA256 = strings.Repeat("A", 64) }},
		{name: "zero size", mutate: func(r *model.ConnectorSkillRelease) { r.ArchiveSizeBytes = 0 }},
		{name: "oversized", mutate: func(r *model.ConnectorSkillRelease) { r.ArchiveSizeBytes = MaxConnectorSkillArchiveSizeBytes + 1 }},
		{name: "non-zip", mutate: func(r *model.ConnectorSkillRelease) { r.ArchiveFormat = "tar" }},
		{name: "unknown authorization", mutate: func(r *model.ConnectorSkillRelease) { r.ArchiveAuthorization = "basic" }},
		{name: "terminal version punctuation", mutate: func(r *model.ConnectorSkillRelease) { r.Version = "1.0." }},
		{name: "control character in name", mutate: func(r *model.ConnectorSkillRelease) { r.Name = "bad\nname" }},
		{name: "Windows reserved ID", mutate: func(r *model.ConnectorSkillRelease) { r.ID = "con" }},
		{name: "Windows reserved ID extension", mutate: func(r *model.ConnectorSkillRelease) { r.ID = "lpt1.tools" }},
	}
	for _, test := range tests {
		t.Run(test.name, func(t *testing.T) {
			input := valid
			test.mutate(&input)
			assert.NotEmpty(t, validateConnectorSkillRelease(&input, allowedOrigins))
		})
	}

	mcp := model.ConnectorMCPServer{
		ID: "boxai-mcp", Name: "BoxAI MCP", URL: "https://you-box.com/mcp",
		Authorization: "connection_bearer", Enabled: true,
	}
	assert.Empty(t, validateConnectorMCPServer(&mcp, allowedOrigins))
	mcp.Description = "bad\tdescription"
	assert.NotEmpty(t, validateConnectorMCPServer(&mcp, allowedOrigins))
	mcp.Description = ""
	mcp.Authorization = "none"
	assert.NotEmpty(t, validateConnectorMCPServer(&mcp, allowedOrigins))
}
