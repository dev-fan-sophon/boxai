package controller

import (
	"errors"
	"fmt"
	"net"
	"net/url"
	"regexp"
	"strings"
	"unicode"

	"github.com/dev-fan-sophon/boxai/common"
	"github.com/dev-fan-sophon/boxai/model"
	"github.com/gin-gonic/gin"
	"gorm.io/gorm"
)

const (
	MaxConnectorSkillArchiveSizeBytes int64 = 64 * 1024 * 1024
	MaxConnectorCatalogEntries              = 256
)

var (
	errConnectorCatalogLimit        = errors.New("connector catalog limit reached")
	errConnectorSkillAlreadyEnabled = errors.New("another release of this Skill is already enabled")
	connectorCatalogIDPattern       = regexp.MustCompile(`^[a-z0-9][a-z0-9-]{0,63}$`)
	connectorCatalogVersionPattern  = regexp.MustCompile(`^[A-Za-z0-9][A-Za-z0-9._+-]{0,63}$`)
	connectorCatalogSHA256Pattern   = regexp.MustCompile(`^[0-9a-f]{64}$`)
)

func connectorCatalogMutationError(c *gin.Context, err error) {
	switch {
	case errors.Is(err, errConnectorCatalogLimit):
		common.ApiErrorMsg(c, "enabled connector catalog has reached its 256-entry limit")
	case errors.Is(err, errConnectorSkillAlreadyEnabled):
		common.ApiErrorMsg(c, "only one release per Skill may be enabled")
	default:
		common.ApiError(c, err)
	}
}

func validateConnectorCatalogText(value string) bool {
	return !strings.ContainsFunc(value, unicode.IsControl)
}

func isWindowsReservedConnectorID(value string) bool {
	stem := strings.ToUpper(strings.SplitN(value, ".", 2)[0])
	if stem == "CON" || stem == "PRN" || stem == "AUX" || stem == "NUL" {
		return true
	}
	if len(stem) == 4 && (strings.HasPrefix(stem, "COM") || strings.HasPrefix(stem, "LPT")) {
		return stem[3] >= '1' && stem[3] <= '9'
	}
	return false
}

func validateConnectorCatalogURL(raw string) bool {
	parsed, err := url.Parse(strings.TrimSpace(raw))
	if err != nil || parsed.Host == "" || parsed.User != nil || parsed.Fragment != "" {
		return false
	}
	if parsed.Scheme == "https" {
		return true
	}
	if gin.Mode() != gin.TestMode || parsed.Scheme != "http" {
		return false
	}
	host := parsed.Hostname()
	if host == "localhost" {
		return true
	}
	ip := net.ParseIP(host)
	return ip != nil && ip.IsLoopback()
}

func normalizedConnectorOrigin(raw string) string {
	parsed, err := url.Parse(strings.TrimSpace(raw))
	if err != nil || parsed.Hostname() == "" {
		return ""
	}
	port := parsed.Port()
	if port == "" {
		switch parsed.Scheme {
		case "https":
			port = "443"
		case "http":
			port = "80"
		default:
			return ""
		}
	}
	return fmt.Sprintf("%s://%s", strings.ToLower(parsed.Scheme), net.JoinHostPort(strings.ToLower(parsed.Hostname()), port))
}

func connectorOriginAllowed(raw string, allowedOrigins []string) bool {
	origin := normalizedConnectorOrigin(raw)
	if origin == "" {
		return false
	}
	for _, allowed := range allowedOrigins {
		if normalizedConnectorOrigin(allowed) == origin {
			return true
		}
	}
	return false
}

func validateConnectorMCPServer(server *model.ConnectorMCPServer, bearerOrigins []string) string {
	server.ID = strings.TrimSpace(server.ID)
	server.Name = strings.TrimSpace(server.Name)
	server.URL = strings.TrimSpace(server.URL)
	server.Description = strings.TrimSpace(server.Description)
	if !connectorCatalogIDPattern.MatchString(server.ID) {
		return "id must be a lower-case slug of at most 64 characters"
	}
	if server.Name == "" || len(server.Name) > 128 {
		return "name is required and must not exceed 128 characters"
	}
	if !validateConnectorCatalogText(server.Name) {
		return "name must not contain control characters"
	}
	if !validateConnectorCatalogURL(server.URL) {
		return "url must be HTTPS"
	}
	if server.Authorization != "connection_bearer" {
		return "authorization must be connection_bearer"
	}
	if !connectorOriginAllowed(server.URL, bearerOrigins) {
		return "url origin is not allowed for connection_bearer"
	}
	if len(server.Description) > 1024 {
		return "description must not exceed 1024 bytes"
	}
	if !validateConnectorCatalogText(server.Description) {
		return "description must not contain control characters"
	}
	return ""
}

func validateConnectorSkillRelease(release *model.ConnectorSkillRelease, bearerOrigins []string) string {
	release.ID = strings.TrimSpace(release.ID)
	release.Version = strings.TrimSpace(release.Version)
	release.Name = strings.TrimSpace(release.Name)
	release.ArchiveURL = strings.TrimSpace(release.ArchiveURL)
	if !connectorCatalogIDPattern.MatchString(release.ID) || isWindowsReservedConnectorID(release.ID) {
		return "id must be a lower-case slug of at most 64 characters"
	}
	if !connectorCatalogVersionPattern.MatchString(release.Version) {
		return "version is required and must not exceed 64 characters"
	}
	last := release.Version[len(release.Version)-1]
	if !((last >= 'a' && last <= 'z') || (last >= 'A' && last <= 'Z') || (last >= '0' && last <= '9')) {
		return "version must end with an ASCII letter or digit"
	}
	if release.Name == "" || len(release.Name) > 128 {
		return "name is required and must not exceed 128 characters"
	}
	if !validateConnectorCatalogText(release.Name) {
		return "name must not contain control characters"
	}
	if !validateConnectorCatalogURL(release.ArchiveURL) {
		return "archive_url must be HTTPS"
	}
	if !connectorCatalogSHA256Pattern.MatchString(release.ArchiveSHA256) {
		return "archive_sha256 must be a lower-case 64-character SHA-256"
	}
	if release.ArchiveSizeBytes <= 0 || release.ArchiveSizeBytes > MaxConnectorSkillArchiveSizeBytes {
		return "archive_size_bytes is outside the supported range"
	}
	if release.ArchiveFormat != "zip" {
		return "archive_format must be zip"
	}
	if release.ArchiveAuthorization != "none" && release.ArchiveAuthorization != "connection_bearer" {
		return "archive_authorization must be none or connection_bearer"
	}
	if release.ArchiveAuthorization == "connection_bearer" && !connectorOriginAllowed(release.ArchiveURL, bearerOrigins) {
		return "archive_url origin is not allowed for connection_bearer"
	}
	return ""
}

type connectorCatalogSync struct {
	MCPServers []connectorMCPServer `json:"mcp_servers"`
	Skills     []connectorSkill     `json:"skills"`
}

// AdminSyncConnectorCatalog validates a complete publishable catalog before
// atomically replacing the currently enabled descriptors. Disabled Skill
// releases remain as history, while MCP servers are source-of-truth records.
func AdminSyncConnectorCatalog(c *gin.Context) {
	var input connectorCatalogSync
	if err := c.ShouldBindJSON(&input); err != nil {
		common.ApiError(c, err)
		return
	}
	if input.MCPServers == nil {
		input.MCPServers = []connectorMCPServer{}
	}
	if input.Skills == nil {
		input.Skills = []connectorSkill{}
	}
	if len(input.MCPServers) > MaxConnectorCatalogEntries || len(input.Skills) > MaxConnectorCatalogEntries {
		common.ApiErrorMsg(c, "connector catalog must not exceed 256 entries per kind")
		return
	}

	bearerOrigins := []string{publicOrigin(c)}
	now := common.GetTimestamp()
	servers := make([]model.ConnectorMCPServer, 0, len(input.MCPServers))
	serverIDs := make(map[string]struct{}, len(input.MCPServers))
	for _, item := range input.MCPServers {
		server := model.ConnectorMCPServer{
			ID: item.ID, Name: item.Name, URL: item.URL, Authorization: item.Authorization,
			Description: item.Description, Enabled: true, CreatedAt: now, UpdatedAt: now,
		}
		if message := validateConnectorMCPServer(&server, bearerOrigins); message != "" {
			common.ApiErrorMsg(c, "invalid MCP server "+server.ID+": "+message)
			return
		}
		if _, duplicate := serverIDs[server.ID]; duplicate {
			common.ApiErrorMsg(c, "duplicate MCP server id: "+server.ID)
			return
		}
		serverIDs[server.ID] = struct{}{}
		servers = append(servers, server)
	}

	releases := make([]model.ConnectorSkillRelease, 0, len(input.Skills))
	skillIDs := make(map[string]struct{}, len(input.Skills))
	for _, item := range input.Skills {
		release := model.ConnectorSkillRelease{
			ID: item.ID, Name: item.Name, Version: item.Version, ArchiveURL: item.Archive.URL,
			ArchiveSHA256: item.Archive.SHA256, ArchiveSizeBytes: item.Archive.SizeBytes,
			ArchiveFormat: item.Archive.Format, ArchiveAuthorization: item.Archive.Authorization,
			Enabled: true, CreatedAt: now, UpdatedAt: now,
		}
		if message := validateConnectorSkillRelease(&release, bearerOrigins); message != "" {
			common.ApiErrorMsg(c, "invalid Skill "+release.ID+": "+message)
			return
		}
		if _, duplicate := skillIDs[release.ID]; duplicate {
			common.ApiErrorMsg(c, "duplicate Skill id: "+release.ID)
			return
		}
		skillIDs[release.ID] = struct{}{}
		releases = append(releases, release)
	}

	if err := model.WithConnectorCatalogMutation(func(tx *gorm.DB) error {
		if err := tx.Where("1 = 1").Delete(&model.ConnectorMCPServer{}).Error; err != nil {
			return err
		}
		if len(servers) != 0 {
			if err := tx.Create(&servers).Error; err != nil {
				return err
			}
		}
		if err := tx.Model(&model.ConnectorSkillRelease{}).Where("enabled = ?", true).Update("enabled", false).Error; err != nil {
			return err
		}
		for i := range releases {
			var historical model.ConnectorSkillRelease
			err := tx.First(&historical, "id = ? AND version = ?", releases[i].ID, releases[i].Version).Error
			if err == nil {
				releases[i].CreatedAt = historical.CreatedAt
				if err := tx.Save(&releases[i]).Error; err != nil {
					return err
				}
				continue
			}
			if !errors.Is(err, gorm.ErrRecordNotFound) {
				return err
			}
			if err := tx.Create(&releases[i]).Error; err != nil {
				return err
			}
		}
		return nil
	}); err != nil {
		connectorCatalogMutationError(c, err)
		return
	}

	common.ApiSuccess(c, input)
}

func AdminListConnectorMCPServers(c *gin.Context) {
	servers, err := model.ListConnectorMCPServers(false)
	if err != nil {
		common.ApiError(c, err)
		return
	}
	common.ApiSuccess(c, servers)
}

func AdminCreateConnectorMCPServer(c *gin.Context) {
	var server model.ConnectorMCPServer
	if err := c.ShouldBindJSON(&server); err != nil {
		common.ApiError(c, err)
		return
	}
	if message := validateConnectorMCPServer(&server, []string{publicOrigin(c)}); message != "" {
		common.ApiErrorMsg(c, message)
		return
	}
	now := common.GetTimestamp()
	server.CreatedAt = now
	server.UpdatedAt = now
	if err := model.WithConnectorCatalogMutation(func(tx *gorm.DB) error {
		if server.Enabled {
			var count int64
			if err := tx.Model(&model.ConnectorMCPServer{}).Where("enabled = ?", true).Count(&count).Error; err != nil {
				return err
			}
			if count >= MaxConnectorCatalogEntries {
				return errConnectorCatalogLimit
			}
		}
		return tx.Create(&server).Error
	}); err != nil {
		connectorCatalogMutationError(c, err)
		return
	}
	common.ApiSuccess(c, server)
}

func AdminUpdateConnectorMCPServer(c *gin.Context) {
	var input model.ConnectorMCPServer
	if err := c.ShouldBindJSON(&input); err != nil {
		common.ApiError(c, err)
		return
	}
	input.ID = c.Param("id")
	if message := validateConnectorMCPServer(&input, []string{publicOrigin(c)}); message != "" {
		common.ApiErrorMsg(c, message)
		return
	}
	if err := model.WithConnectorCatalogMutation(func(tx *gorm.DB) error {
		var existing model.ConnectorMCPServer
		if err := tx.First(&existing, "id = ?", input.ID).Error; err != nil {
			return err
		}
		if input.Enabled && !existing.Enabled {
			var count int64
			if err := tx.Model(&model.ConnectorMCPServer{}).Where("enabled = ?", true).Count(&count).Error; err != nil {
				return err
			}
			if count >= MaxConnectorCatalogEntries {
				return errConnectorCatalogLimit
			}
		}
		input.CreatedAt = existing.CreatedAt
		input.UpdatedAt = common.GetTimestamp()
		return tx.Save(&input).Error
	}); err != nil {
		connectorCatalogMutationError(c, err)
		return
	}
	common.ApiSuccess(c, input)
}

func AdminDeleteConnectorMCPServer(c *gin.Context) {
	if err := model.WithConnectorCatalogMutation(func(tx *gorm.DB) error {
		return tx.Delete(&model.ConnectorMCPServer{}, "id = ?", c.Param("id")).Error
	}); err != nil {
		connectorCatalogMutationError(c, err)
		return
	}
	common.ApiSuccess(c, nil)
}

func AdminListConnectorSkillReleases(c *gin.Context) {
	releases, err := model.ListConnectorSkillReleases(false)
	if err != nil {
		common.ApiError(c, err)
		return
	}
	common.ApiSuccess(c, releases)
}

func AdminCreateConnectorSkillRelease(c *gin.Context) {
	var release model.ConnectorSkillRelease
	if err := c.ShouldBindJSON(&release); err != nil {
		common.ApiError(c, err)
		return
	}
	if message := validateConnectorSkillRelease(&release, []string{publicOrigin(c)}); message != "" {
		common.ApiErrorMsg(c, message)
		return
	}
	now := common.GetTimestamp()
	release.CreatedAt = now
	release.UpdatedAt = now
	if err := model.WithConnectorCatalogMutation(func(tx *gorm.DB) error {
		if release.Enabled {
			var count int64
			if err := tx.Model(&model.ConnectorSkillRelease{}).Where("enabled = ?", true).Count(&count).Error; err != nil {
				return err
			}
			if count >= MaxConnectorCatalogEntries {
				return errConnectorCatalogLimit
			}
			if err := tx.Model(&model.ConnectorSkillRelease{}).Where("id = ? AND enabled = ?", release.ID, true).Count(&count).Error; err != nil {
				return err
			}
			if count != 0 {
				return errConnectorSkillAlreadyEnabled
			}
		}
		return tx.Create(&release).Error
	}); err != nil {
		connectorCatalogMutationError(c, err)
		return
	}
	common.ApiSuccess(c, release)
}

func AdminUpdateConnectorSkillRelease(c *gin.Context) {
	var input model.ConnectorSkillRelease
	if err := c.ShouldBindJSON(&input); err != nil {
		common.ApiError(c, err)
		return
	}
	input.ID = c.Param("id")
	input.Version = c.Param("version")
	if message := validateConnectorSkillRelease(&input, []string{publicOrigin(c)}); message != "" {
		common.ApiErrorMsg(c, message)
		return
	}
	if err := model.WithConnectorCatalogMutation(func(tx *gorm.DB) error {
		var existing model.ConnectorSkillRelease
		if err := tx.First(&existing, "id = ? AND version = ?", input.ID, input.Version).Error; err != nil {
			return err
		}
		if input.Enabled && !existing.Enabled {
			var count int64
			if err := tx.Model(&model.ConnectorSkillRelease{}).Where("enabled = ?", true).Count(&count).Error; err != nil {
				return err
			}
			if count >= MaxConnectorCatalogEntries {
				return errConnectorCatalogLimit
			}
			if err := tx.Model(&model.ConnectorSkillRelease{}).Where("id = ? AND enabled = ?", input.ID, true).Count(&count).Error; err != nil {
				return err
			}
			if count != 0 {
				return errConnectorSkillAlreadyEnabled
			}
		}
		input.CreatedAt = existing.CreatedAt
		input.UpdatedAt = common.GetTimestamp()
		return tx.Save(&input).Error
	}); err != nil {
		connectorCatalogMutationError(c, err)
		return
	}
	common.ApiSuccess(c, input)
}

func AdminDeleteConnectorSkillRelease(c *gin.Context) {
	if err := model.WithConnectorCatalogMutation(func(tx *gorm.DB) error {
		return tx.Delete(&model.ConnectorSkillRelease{}, "id = ? AND version = ?", c.Param("id"), c.Param("version")).Error
	}); err != nil {
		connectorCatalogMutationError(c, err)
		return
	}
	common.ApiSuccess(c, nil)
}
