package controller

import (
	"errors"
	"path"
	"strconv"
	"strings"
	"time"

	"github.com/dev-fan-sophon/boxai/common"
	"github.com/dev-fan-sophon/boxai/model"
	"github.com/dev-fan-sophon/boxai/service"
	"github.com/dev-fan-sophon/boxai/service/storage"
	"github.com/gin-gonic/gin"
	"github.com/google/uuid"
)

type playgroundUploadIntentRequest struct {
	Name        string `json:"name"`
	ContentType string `json:"content_type"`
	Size        int64  `json:"size"`
	Kind        string `json:"kind"`
	Source      string `json:"source"`
	CreateOnly  bool   `json:"create_only"`
}

// CreatePlaygroundUploadIntent returns a short-lived PUT URL so the browser
// uploads the file directly to object storage. Local storage has no presign
// and the client falls back to the multipart upload route.
func CreatePlaygroundUploadIntent(c *gin.Context) {
	userID := c.GetInt("id")
	var req playgroundUploadIntentRequest
	if err := c.ShouldBindJSON(&req); err != nil {
		common.ApiError(c, err)
		return
	}
	kind := strings.TrimSpace(req.Kind)
	if kind != "image" && kind != "video" && kind != "audio" {
		common.ApiErrorMsg(c, "kind must be image, video, or audio")
		return
	}
	if req.Size <= 0 || req.Size > service.MaxBytesForPlaygroundKind(kind) {
		common.ApiErrorMsg(c, "file exceeds size limit")
		return
	}
	putContentType := req.ContentType // Keep the exact header the browser will PUT.
	req.ContentType = service.NormalizePlaygroundMime(req.ContentType)
	declaredKind, err := service.DetectPlaygroundAssetKind(req.ContentType)
	if err != nil || declaredKind != kind {
		common.ApiErrorMsg(c, "content type does not match upload kind")
		return
	}
	if req.Source == "" {
		req.Source = model.PlaygroundAssetSourceLibrary
	}
	if req.Source != model.PlaygroundAssetSourceLibrary && req.Source != model.PlaygroundAssetSourceAttachment {
		common.ApiErrorMsg(c, "invalid asset source")
		return
	}
	store := storage.Default()
	ext := path.Ext(req.Name)
	// Legacy clients use replayable staging PUTs; create-only clients avoid copying.
	key := path.Join("upload-intents", itoaUser(userID), uuid.NewString()+ext)
	putHeaders := map[string]string{}
	if req.CreateOnly {
		// New clients sign a create-only PUT and keep this object in place.
		// Older clients retain the staging flow until their next page reload.
		key = path.Join(storage.DirectUploadPrefix, itoaUser(userID), uuid.NewString()+ext)
		putHeaders["If-None-Match"] = "*"
	}
	expiresAt := time.Now().Add(15 * time.Minute).Unix()
	putURL, err := store.PresignPut(c.Request.Context(), key, putContentType, 15*time.Minute)
	if err != nil {
		if errors.Is(err, storage.ErrPresignUnsupported) {
			common.ApiErrorMsg(c, "direct upload is not available")
			return
		}
		common.ApiError(c, err)
		return
	}
	asset := &model.PlaygroundAsset{
		UserId:          userID,
		Kind:            kind,
		Source:          req.Source,
		Name:            path.Base(req.Name),
		StorageKey:      key,
		Backend:         store.Backend(),
		Mime:            req.ContentType,
		Size:            req.Size,
		UploadState:     "pending",
		UploadExpiresAt: expiresAt,
	}
	if err := model.CreatePlaygroundAsset(asset); err != nil {
		common.ApiError(c, err)
		return
	}
	common.ApiSuccess(c, gin.H{
		"asset":       model.PublicPlaygroundAssetDTO(asset),
		"put_url":     putURL,
		"put_headers": putHeaders,
	})
}

func itoaUser(id int) string {
	return strconv.Itoa(id)
}
