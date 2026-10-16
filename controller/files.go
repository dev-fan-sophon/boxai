package controller

import (
	"fmt"
	"io"
	"net/http"
	"path/filepath"
	"strconv"
	"strings"

	"github.com/dev-fan-sophon/boxai/model"
	"github.com/dev-fan-sophon/boxai/service"

	"github.com/gin-gonic/gin"
)

// The Files API is how API clients bring their own media. POST /v1/files stores
// the bytes in the asset store and returns a `file-<id>` handle; that handle is
// accepted wherever a media URL is accepted, and the relay swaps in a signed URL
// at submit time. Inlining media as base64 instead is what pushes a generation
// request past the upstream body limit (Ark rejects it with 413).

// fileObject renders the OpenAI-compatible file object for a stored asset.
func fileObject(asset *model.PlaygroundAsset) gin.H {
	return gin.H{
		"id":         service.FileReferencePrefix + strconv.Itoa(asset.Id),
		"object":     "file",
		"bytes":      asset.Size,
		"created_at": asset.CreatedAt,
		"filename":   asset.Name,
		"purpose":    filePurposeForKind(asset.Kind),
	}
}

// filePurposeForKind maps our asset kinds onto the OpenAI purpose vocabulary.
func filePurposeForKind(kind string) string {
	switch kind {
	case "video":
		return "video"
	case "audio":
		return "audio"
	case "document":
		return "user_data"
	default:
		return "vision"
	}
}

func fileAPIError(c *gin.Context, status int, code, message string) {
	c.JSON(status, gin.H{"error": gin.H{
		"message": message,
		"type":    "invalid_request_error",
		"code":    code,
	}})
}

// parseFileID accepts "file-123" and a bare "123".
func parseFileID(raw string) (int, bool) {
	trimmed := strings.TrimPrefix(strings.TrimSpace(raw), service.FileReferencePrefix)
	id, err := strconv.Atoi(trimmed)
	if err != nil || id <= 0 {
		return 0, false
	}
	return id, true
}

// fileForRequest loads the caller's file or answers the request with 404.
func fileForRequest(c *gin.Context) (*model.PlaygroundAsset, bool) {
	id, ok := parseFileID(c.Param("id"))
	if !ok {
		fileAPIError(c, http.StatusBadRequest, "invalid_request_error", "invalid file id")
		return nil, false
	}
	asset, err := model.GetPlaygroundAsset(id, c.GetInt("id"))
	if err != nil || asset == nil {
		fileAPIError(c, http.StatusNotFound, "invalid_request_error", fmt.Sprintf("file %s not found", c.Param("id")))
		return nil, false
	}
	return asset, true
}

// UploadFile implements POST /v1/files (multipart `file`, optional `purpose`).
func UploadFile(c *gin.Context) {
	userId := c.GetInt("id")
	c.Request.Body = http.MaxBytesReader(c.Writer, c.Request.Body, service.PlaygroundAssetMaxVideoBytes+(1<<20))
	if err := c.Request.ParseMultipartForm(8 << 20); err != nil {
		fileAPIError(c, http.StatusBadRequest, "invalid_request_error", "multipart/form-data with a file field is required")
		return
	}
	file, err := c.FormFile("file")
	if err != nil {
		fileAPIError(c, http.StatusBadRequest, "invalid_request_error", "file is required")
		return
	}
	// The declared type is only a hint; SavePlaygroundAssetFile sniffs content.
	declared := file.Header.Get("Content-Type")
	if declared == "" {
		declared = "application/octet-stream"
	}
	src, err := file.Open()
	if err != nil {
		fileAPIError(c, http.StatusBadRequest, "invalid_request_error", "file could not be read")
		return
	}
	defer func() { _ = src.Close() }()

	storageKey, backend, mimeType, kind, contentHash, err := service.SavePlaygroundAssetFile(userId, file.Filename, declared, src, file.Size)
	if err != nil {
		fileAPIError(c, http.StatusBadRequest, "invalid_request_error", err.Error())
		return
	}
	asset := &model.PlaygroundAsset{
		UserId:      userId,
		Kind:        kind,
		Source:      model.PlaygroundAssetSourceAttachment,
		Name:        filepath.Base(file.Filename),
		StorageKey:  storageKey,
		Backend:     backend,
		Mime:        mimeType,
		Size:        file.Size,
		ContentHash: contentHash,
	}
	if err := model.CreatePlaygroundAsset(asset); err != nil {
		service.DeletePlaygroundAssetFile(backend, storageKey)
		fileAPIError(c, http.StatusInternalServerError, "server_error", "file could not be stored")
		return
	}
	c.JSON(http.StatusOK, fileObject(asset))
}

// ListFiles implements GET /v1/files.
func ListFiles(c *gin.Context) {
	limit := 100
	if raw := strings.TrimSpace(c.Query("limit")); raw != "" {
		if parsed, err := strconv.Atoi(raw); err == nil && parsed > 0 {
			limit = min(parsed, 1000)
		}
	}
	assets, total, err := model.ListPlaygroundAssets(c.GetInt("id"), "", model.PlaygroundAssetSourceAttachment, 0, limit)
	if err != nil {
		fileAPIError(c, http.StatusInternalServerError, "server_error", "files could not be listed")
		return
	}
	items := make([]gin.H, 0, len(assets))
	for i := range assets {
		items = append(items, fileObject(&assets[i]))
	}
	c.JSON(http.StatusOK, gin.H{
		"object":   "list",
		"data":     items,
		"has_more": int64(limit) < total,
	})
}

// GetFile implements GET /v1/files/{id}.
func GetFile(c *gin.Context) {
	asset, ok := fileForRequest(c)
	if !ok {
		return
	}
	c.JSON(http.StatusOK, fileObject(asset))
}

// DeleteFile implements DELETE /v1/files/{id}.
func DeleteFile(c *gin.Context) {
	asset, ok := fileForRequest(c)
	if !ok {
		return
	}
	if err := model.DeletePlaygroundAsset(asset.Id, asset.UserId); err != nil {
		fileAPIError(c, http.StatusInternalServerError, "server_error", "file could not be deleted")
		return
	}
	service.DeletePlaygroundAssetFile(asset.Backend, asset.StorageKey)
	c.JSON(http.StatusOK, gin.H{
		"id":      service.FileReferencePrefix + strconv.Itoa(asset.Id),
		"object":  "file",
		"deleted": true,
	})
}

// DownloadFile implements GET /v1/files/{id}/content.
func DownloadFile(c *gin.Context) {
	asset, ok := fileForRequest(c)
	if !ok {
		return
	}
	body, err := service.OpenPlaygroundAssetContentDirect(c.Request.Context(), asset.Backend, asset.StorageKey)
	if err != nil {
		fileAPIError(c, http.StatusNotFound, "invalid_request_error", "file content is unavailable")
		return
	}
	defer func() { _ = body.Close() }()
	if asset.Mime != "" {
		c.Header("Content-Type", asset.Mime)
	}
	if asset.Size > 0 {
		c.Header("Content-Length", strconv.FormatInt(asset.Size, 10))
	}
	name := asset.Name
	if name == "" {
		name = "file"
	}
	c.Header("Content-Disposition", fmt.Sprintf("attachment; filename=%q", name))
	c.Header("X-Content-Type-Options", "nosniff")
	c.Status(http.StatusOK)
	if _, err := io.Copy(c.Writer, body); err != nil {
		_ = c.Error(err)
	}
}
