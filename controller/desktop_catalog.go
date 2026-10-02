package controller

import (
	"errors"
	"net/http"
	"strings"

	"github.com/dev-fan-sophon/boxai/model"
	"github.com/dev-fan-sophon/boxai/service"
	"github.com/gin-gonic/gin"
)

// readConnectorCatalog is shared by Connect provisioning and Desktop. Neither
// client may bypass the publishing constraints when reading persisted data.
func readConnectorCatalog(origin string) ([]connectorMCPServer, []connectorSkill, error) {
	mcpRows, err := model.ListConnectorMCPServers(true)
	if err != nil {
		return nil, nil, err
	}
	skillRows, err := model.ListConnectorSkillReleases(true)
	if err != nil {
		return nil, nil, err
	}
	if len(mcpRows) > MaxConnectorCatalogEntries || len(skillRows) > MaxConnectorCatalogEntries {
		return nil, nil, errors.New("connector catalog exceeds supported limit")
	}
	bearerOrigins := []string{origin}
	mcpServers := make([]connectorMCPServer, 0, len(mcpRows))
	for _, row := range mcpRows {
		if validateConnectorMCPServer(&row, bearerOrigins) != "" {
			return nil, nil, errors.New("connector MCP catalog contains an invalid descriptor")
		}
		mcpServers = append(mcpServers, connectorMCPServer{
			ID: row.ID, Name: row.Name, URL: row.URL,
			Authorization: row.Authorization, Description: row.Description,
		})
	}
	skills := make([]connectorSkill, 0, len(skillRows))
	for _, row := range skillRows {
		if validateConnectorSkillRelease(&row, bearerOrigins) != "" {
			return nil, nil, errors.New("connector Skill catalog contains an invalid descriptor")
		}
		skills = append(skills, connectorSkill{
			ID: row.ID, Name: row.Name, Version: row.Version,
			Archive: connectorSkillArchive{
				URL: row.ArchiveURL, SHA256: row.ArchiveSHA256, SizeBytes: row.ArchiveSizeBytes,
				Format: row.ArchiveFormat, Authorization: row.ArchiveAuthorization,
			},
		})
	}
	return mcpServers, skills, nil
}

// GetDesktopCatalog accepts the Desktop access JWT, not a relay key, portal
// cookie, or Connect session. No credentials are returned in the descriptors.
func GetDesktopCatalog(c *gin.Context) {
	desktopNoStore(c)
	header := c.GetHeader("Authorization")
	if !strings.HasPrefix(header, "Bearer ") || strings.TrimSpace(header) != header {
		desktopOAuthError(c, http.StatusUnauthorized, "invalid_token", "desktop session is inactive")
		return
	}
	session, err := service.GetActiveDesktopSession(strings.TrimPrefix(header, "Bearer "))
	if err != nil || session.ClientID != service.DesktopClientID {
		desktopOAuthError(c, http.StatusUnauthorized, "invalid_token", "desktop session is inactive")
		return
	}
	mcpServers, skills, err := readConnectorCatalog(publicOrigin(c))
	if err != nil {
		c.JSON(http.StatusServiceUnavailable, gin.H{"success": false, "message": "official catalog unavailable"})
		return
	}
	c.JSON(http.StatusOK, gin.H{"success": true, "data": gin.H{
		"schema_version": 1, "mcp_servers": mcpServers, "skills": skills,
	}})
}
