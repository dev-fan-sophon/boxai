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
	store := storage.Default()
	ext := path.Ext(req.Name)
	key := path.Join("uploads", itoaUser(userID), uuid.NewString()+ext)
	putURL, err := store.PresignPut(c.Request.Context(), key, req.ContentType, 15*time.Minute)
	if err != nil {
		if errors.Is(err, storage.ErrPresignUnsupported) {
			common.ApiErrorMsg(c, "direct upload is not available")
			return
		}
		common.ApiError(c, err)
		return
	}
	asset := &model.PlaygroundAsset{
		UserId:     userID,
		Kind:       kind,
		Source:     model.PlaygroundAssetSourceLibrary,
		Name:       path.Base(req.Name),
		StorageKey: key,
		Backend:    store.Backend(),
		Mime:       req.ContentType,
		Size:       req.Size,
	}
	if err := model.CreatePlaygroundAsset(asset); err != nil {
		common.ApiError(c, err)
		return
	}
	asset.URL = playgroundAssetContentURL(asset.Id)
	_ = model.DB.Model(asset).Update("url", asset.URL).Error
	common.ApiSuccess(c, gin.H{
		"asset":   model.PublicPlaygroundAssetDTO(asset),
		"put_url": putURL,
	})
}

func itoaUser(id int) string {
	return strconv.Itoa(id)
}
