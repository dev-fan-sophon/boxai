package controller

import (
	"errors"
	"io"
	"net/http"
	"time"

	"github.com/dev-fan-sophon/boxai/common"
	"github.com/dev-fan-sophon/boxai/service"
	"github.com/dev-fan-sophon/boxai/service/storage"
	"github.com/gin-gonic/gin"
)

// GetPlaygroundMediaFetch streams one private asset to a video gateway that
// was given a short-lived fetch grant. It does not accept a user session.
func GetPlaygroundMediaFetch(c *gin.Context) {
	userID, assetID, ok := service.ConsumeMediaFetchGrant(c.Param("token"))
	if !ok {
		c.Status(http.StatusNotFound)
		return
	}
	asset, err := service.GetMediaFetchAsset(userID, assetID)
	if err != nil {
		c.Status(http.StatusNotFound)
		return
	}
	c.Header("Cache-Control", "private, no-store")
	c.Header("Referrer-Policy", "no-referrer")
	store, err := storage.ForBackend(asset.Backend)
	if err != nil {
		c.Status(http.StatusNotFound)
		return
	}
	signedURL, err := store.PresignGet(c.Request.Context(), asset.StorageKey, time.Minute)
	if err == nil {
		c.Redirect(http.StatusTemporaryRedirect, signedURL)
		return
	}
	if !errors.Is(err, storage.ErrPresignUnsupported) {
		c.Status(http.StatusNotFound)
		return
	}
	body, err := service.OpenPlaygroundAssetContentDirect(c.Request.Context(), asset.Backend, asset.StorageKey)
	if err != nil {
		c.Status(http.StatusNotFound)
		return
	}
	defer body.Close()
	if asset.Mime != "" {
		c.Header("Content-Type", asset.Mime)
	}
	c.Header("Cache-Control", "private, no-store")
	c.Header("X-Content-Type-Options", "nosniff")
	c.Status(http.StatusOK)
	if _, err := io.Copy(c.Writer, body); err != nil {
		common.SysError("stream media fetch grant: " + err.Error())
	}
}
