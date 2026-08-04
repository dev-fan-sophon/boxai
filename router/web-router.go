package router

import (
	"embed"
	"net/http"
	"strings"

	"github.com/dev-fan-sophon/boxai/common"
	"github.com/dev-fan-sophon/boxai/controller"
	"github.com/dev-fan-sophon/boxai/middleware"
	"github.com/dev-fan-sophon/boxai/setting/system_setting"
	"github.com/gin-contrib/gzip"
	"github.com/gin-contrib/static"
	"github.com/gin-gonic/gin"
)

// WebAssets holds frontend assets. Prefer DistDir (disk / symlink) when set so
// deploy-web can publish a new SPA without rebuilding or restarting the API.
// BuildFS + IndexPage remain the compile-time embed fallback.
type WebAssets struct {
	BuildFS   embed.FS
	IndexPage []byte
	// DistDir is a host path to a built SPA (typically /opt/boxai/web, a
	// symlink flipped atomically by deploy-web). Empty → embed only.
	DistDir string
}

func SetWebRouter(router *gin.Engine, assets WebAssets) {
	if dir := common.ResolveWebDistDir(assets.DistDir); dir != "" {
		common.SysLog("serving frontend from disk (prefer): " + dir)
	} else if strings.TrimSpace(assets.DistDir) != "" {
		common.SysLog("WEB_DIST_DIR configured; will use disk when index.html appears: " + assets.DistDir)
	}
	router.Use(gzip.Gzip(gzip.DefaultCompression))
	router.Use(middleware.GlobalWebRateLimit())
	router.Use(middleware.Cache())
	// PreferDiskFolder re-resolves DistDir on every Open/Exists so an atomic
	// symlink flip (or the first deploy-web after enabling WEB_DIST_DIR) is
	// visible without restarting the process.
	router.Use(static.Serve("/", common.PreferDiskFolder(assets.DistDir, assets.BuildFS, "web/default/dist")))
	router.NoRoute(webFallbackHandler(assets))
}

func webFallbackHandler(assets WebAssets) gin.HandlerFunc {
	return func(c *gin.Context) {
		c.Set(middleware.RouteTagKey, "web")
		requestPath := c.Request.URL.Path
		if strings.HasPrefix(requestPath, "/v1") || strings.HasPrefix(requestPath, "/api") || strings.HasPrefix(requestPath, "/assets") || requestPath == "/static" || strings.HasPrefix(requestPath, "/static/") {
			c.Header("Cache-Control", "no-store")
			controller.RelayNotFound(c)
			return
		}
		c.Header("Cache-Control", "no-cache")
		indexHTML := common.ReadWebIndexHTML(assets.DistDir, assets.IndexPage)
		c.Data(http.StatusOK, "text/html; charset=utf-8", injectIndexSEO(c, requestPath, indexHTML))
	}
}

// injectIndexSEO rewrites the SPA shell with path-specific meta tags and a
// crawler-visible prerender block for public pages. Private routes get noindex.
func injectIndexSEO(c *gin.Context, requestPath string, indexHTML []byte) []byte {
	path := common.NormalizePublicPath(requestPath)
	siteName := strings.TrimSpace(common.SystemName)
	if siteName == "" {
		siteName = "BoxAI"
	}
	base := common.SiteBaseURL(system_setting.ServerAddress)
	if base == "" && c != nil && c.Request != nil {
		scheme := "https"
		if c.Request.TLS == nil {
			if proto := strings.TrimSpace(c.GetHeader("X-Forwarded-Proto")); proto != "" {
				scheme = strings.ToLower(strings.Split(proto, ",")[0])
			} else {
				scheme = "http"
			}
		}
		if host := strings.TrimSpace(c.Request.Host); host != "" {
			base = scheme + "://" + host
		}
	}
	imageURL := strings.TrimSpace(common.Logo)
	if imageURL == "" {
		imageURL = "/og-image.png"
	}

	if page, ok := common.LookupSEOPage(path); ok {
		return common.InjectSEOIntoHTML(indexHTML, page, siteName, base, imageURL, false)
	}
	// Unknown client routes still get a sensible default shell; mark private paths noindex.
	page := common.SEOPage{
		Path:        path,
		Title:       siteName,
		Description: common.DefaultSEODescription,
	}
	noindex := common.IsPrivateSEOPath(path)
	return common.InjectSEOIntoHTML(indexHTML, page, siteName, base, imageURL, noindex)
}
