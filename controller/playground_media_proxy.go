package controller

import (
	"bytes"
	"context"
	"io"
	"net/http"
	"net/url"
	"strconv"
	"strings"

	"github.com/dev-fan-sophon/boxai/common"
	"github.com/dev-fan-sophon/boxai/service"
	"github.com/dev-fan-sophon/boxai/setting/system_setting"
	"github.com/gin-gonic/gin"
)

// Bound concurrent media transfers per process; reject excess work instead of
// building an unbounded queue of slow downloads. No content is archived.
var mediaProxyCapacity = make(chan struct{}, 16)

func GetPlaygroundMediaProxy(c *gin.Context) {
	if c.GetInt("id") <= 0 {
		c.Status(http.StatusUnauthorized)
		return
	}
	kind := c.Query("kind")
	if kind != "image" && kind != "audio" && kind != "video" {
		c.Status(http.StatusBadRequest)
		return
	}
	raw := c.Query("url")
	parsed, err := url.Parse(raw)
	if err != nil || len(raw) > 8192 || parsed.Host == "" || parsed.User != nil ||
		(parsed.Scheme != "http" && parsed.Scheme != "https") {
		c.Status(http.StatusBadRequest)
		return
	}
	select {
	case mediaProxyCapacity <- struct{}{}:
		defer func() { <-mediaProxyCapacity }()
	default:
		c.Header("Retry-After", "2")
		c.Status(http.StatusServiceUnavailable)
		return
	}
	ctx, cancel := context.WithTimeout(c.Request.Context(), service.VideoOutputTransferTimeout)
	defer cancel()
	req, err := http.NewRequestWithContext(ctx, http.MethodGet, raw, nil)
	if err != nil {
		c.Status(http.StatusBadRequest)
		return
	}
	// Never forward user cookies or API credentials to an arbitrary result URL.
	req.Header.Set("Accept-Encoding", "identity")
	client := *service.GetStrictUntrustedMediaHTTPClient()
	client.Timeout = service.VideoOutputTransferTimeout
	resp, err := client.Do(req)
	if err != nil {
		c.Status(http.StatusBadGateway)
		return
	}
	defer resp.Body.Close()
	if resp.StatusCode != http.StatusOK {
		c.Status(http.StatusBadGateway)
		return
	}
	limit := service.MaxBytesForPlaygroundKind(kind)
	if resp.ContentLength > limit {
		c.Status(http.StatusBadGateway)
		return
	}
	header := make([]byte, 512)
	n, err := io.ReadFull(resp.Body, header)
	if err != nil && err != io.EOF && err != io.ErrUnexpectedEOF {
		c.Status(http.StatusBadGateway)
		return
	}
	header = header[:n]
	mimeType, actualKind, err := service.SniffPlaygroundMime(header, resp.Header.Get("Content-Type"))
	if err != nil || actualKind != kind {
		c.Status(http.StatusBadGateway)
		return
	}
	c.Header("Content-Type", mimeType)
	c.Header("X-Content-Type-Options", "nosniff")
	c.Header("Cache-Control", "private, no-store")
	c.Header("Referrer-Policy", "no-referrer")
	if resp.ContentLength >= 0 {
		c.Header("Content-Length", strconv.FormatInt(resp.ContentLength, 10))
	}
	c.Status(http.StatusOK)
	if _, err := io.Copy(c.Writer, io.LimitReader(io.MultiReader(bytes.NewReader(header), resp.Body), limit)); err != nil {
		common.SysError("stream generated media: " + err.Error())
	}
}

// Refresh the reference immediately before submission, not when a library
// asset was originally uploaded. Ownership and upload readiness are enforced.
func CreatePlaygroundReferenceURL(c *gin.Context) {
	id, err := strconv.Atoi(c.Param("id"))
	if err != nil || id <= 0 || c.GetInt("id") <= 0 {
		common.ApiErrorMsg(c, "invalid asset id")
		return
	}
	ref, err := service.PrivateReferenceMediaURL("/api/playground/assets/"+strconv.Itoa(id)+"/content", strings.TrimRight(system_setting.ServerAddress, "/"), c.GetInt("id"))
	if err != nil {
		common.ApiErrorMsg(c, "reference media unavailable")
		return
	}
	common.ApiSuccess(c, gin.H{"url": ref})
}
