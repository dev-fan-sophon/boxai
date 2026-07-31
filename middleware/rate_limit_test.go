package middleware

import (
	"net/http"
	"net/http/httptest"
	"testing"

	"github.com/dev-fan-sophon/boxai/common"
	"github.com/gin-gonic/gin"
	"github.com/stretchr/testify/assert"
	"github.com/stretchr/testify/require"
)

func TestMemoryRateLimiterReturnsRetryAfter(t *testing.T) {
	gin.SetMode(gin.TestMode)
	inMemoryRateLimiter.Init(0)
	mark := "retry-after:" + t.Name() + ":"
	router := gin.New()
	router.Use(func(c *gin.Context) {
		memoryRateLimiter(c, 1, 37, mark)
	})
	router.GET("/limited", func(c *gin.Context) {
		c.Status(http.StatusNoContent)
	})

	first := httptest.NewRecorder()
	request := httptest.NewRequest(http.MethodGet, "/limited", nil)
	request.RemoteAddr = "192.0.2.1:1234"
	router.ServeHTTP(first, request)
	assert.Equal(t, http.StatusNoContent, first.Code)

	limited := httptest.NewRecorder()
	request = httptest.NewRequest(http.MethodGet, "/limited", nil)
	request.RemoteAddr = "192.0.2.1:1234"
	router.ServeHTTP(limited, request)
	assert.Equal(t, http.StatusTooManyRequests, limited.Code)
	assert.Equal(t, "37", limited.Header().Get("Retry-After"))
}

func TestSkipGlobalWebRateLimit(t *testing.T) {
	t.Parallel()
	cases := []struct {
		path string
		skip bool
	}{
		{"/", false},
		{"/console", false},
		{"/playground", false},
		{"/api/status", false},
		{"/static", true},
		{"/static/js/index.abc.js", true},
		{"/static/css/main.css", true},
		{"/logo.png", true},
		{"/favicon.ico", true},
		{"/assets/icon.svg", true},
		{"/font.woff2", true},
		{"/app.webmanifest", true},
	}
	for _, tc := range cases {
		tc := tc
		t.Run(tc.path, func(t *testing.T) {
			t.Parallel()
			assert.Equal(t, tc.skip, skipGlobalWebRateLimit(tc.path))
		})
	}
}

func TestGlobalWebRateLimitSkipsStaticAssets(t *testing.T) {
	gin.SetMode(gin.TestMode)
	prevRedis := common.RedisEnabled
	prevEnable := common.GlobalWebRateLimitEnable
	prevNum := common.GlobalWebRateLimitNum
	prevDur := common.GlobalWebRateLimitDuration
	t.Cleanup(func() {
		common.RedisEnabled = prevRedis
		common.GlobalWebRateLimitEnable = prevEnable
		common.GlobalWebRateLimitNum = prevNum
		common.GlobalWebRateLimitDuration = prevDur
	})

	common.RedisEnabled = false
	common.GlobalWebRateLimitEnable = true
	common.GlobalWebRateLimitNum = 3
	common.GlobalWebRateLimitDuration = 60
	inMemoryRateLimiter.Init(0)

	router := gin.New()
	router.Use(GlobalWebRateLimit())
	router.GET("/", func(c *gin.Context) { c.String(http.StatusOK, "home") })
	router.GET("/static/js/app.js", func(c *gin.Context) { c.String(http.StatusOK, "js") })
	router.GET("/logo.png", func(c *gin.Context) { c.Status(http.StatusOK) })

	// One IP can fetch far more static files than the HTML budget allows.
	for i := 0; i < 40; i++ {
		rec := httptest.NewRecorder()
		req := httptest.NewRequest(http.MethodGet, "/static/js/app.js", nil)
		req.RemoteAddr = "198.51.100.10:443"
		router.ServeHTTP(rec, req)
		require.Equal(t, http.StatusOK, rec.Code, "static request %d", i)
	}
	for i := 0; i < 10; i++ {
		rec := httptest.NewRecorder()
		req := httptest.NewRequest(http.MethodGet, "/logo.png", nil)
		req.RemoteAddr = "198.51.100.10:443"
		router.ServeHTTP(rec, req)
		require.Equal(t, http.StatusOK, rec.Code, "logo request %d", i)
	}

	// HTML document routes still share the per-IP budget.
	for i := 0; i < 3; i++ {
		rec := httptest.NewRecorder()
		req := httptest.NewRequest(http.MethodGet, "/", nil)
		req.RemoteAddr = "198.51.100.10:443"
		router.ServeHTTP(rec, req)
		require.Equal(t, http.StatusOK, rec.Code, "home request %d", i)
	}
	blocked := httptest.NewRecorder()
	req := httptest.NewRequest(http.MethodGet, "/", nil)
	req.RemoteAddr = "198.51.100.10:443"
	router.ServeHTTP(blocked, req)
	assert.Equal(t, http.StatusTooManyRequests, blocked.Code)

	// Static stays available after the HTML budget is exhausted (NAT office case).
	stillOK := httptest.NewRecorder()
	req = httptest.NewRequest(http.MethodGet, "/static/js/app.js", nil)
	req.RemoteAddr = "198.51.100.10:443"
	router.ServeHTTP(stillOK, req)
	assert.Equal(t, http.StatusOK, stillOK.Code)
}
