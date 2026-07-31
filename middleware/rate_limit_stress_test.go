package middleware

import (
	"fmt"
	"net/http"
	"net/http/httptest"
	"sync"
	"sync/atomic"
	"testing"
	"time"

	"github.com/dev-fan-sophon/boxai/common"
	"github.com/gin-gonic/gin"
	"github.com/stretchr/testify/require"
)

// TestHomepageColdLoadUnderSharedNAT simulates several office clients behind one
// public IP each doing an SPA cold load (1 HTML + many fingerprinted assets).
// With the static exemption, assets must stay 200 while only HTML is budgeted.
func TestHomepageColdLoadUnderSharedNAT(t *testing.T) {
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
	// Old default was 120/180s and counted static. Use a tight HTML budget to
	// prove static no longer burns it during a multi-client cold load.
	common.GlobalWebRateLimitNum = 30
	common.GlobalWebRateLimitDuration = 180
	inMemoryRateLimiter.Init(0)

	router := gin.New()
	router.Use(GlobalWebRateLimit())
	router.GET("/", func(c *gin.Context) { c.String(http.StatusOK, "home") })
	router.GET("/static/js/*filepath", func(c *gin.Context) { c.String(http.StatusOK, "js") })
	router.GET("/logo.png", func(c *gin.Context) { c.Status(http.StatusOK) })

	const (
		clients         = 5
		assetsPerClient = 60 // typical SPA chunk burst
		htmlPerClient   = 2  // document + one client-route fallback
		officeIP        = "203.0.113.50:443"
	)

	var staticOK, static429, htmlOK, html429 atomic.Int64
	var wg sync.WaitGroup
	start := time.Now()
	for c := 0; c < clients; c++ {
		wg.Add(1)
		go func(client int) {
			defer wg.Done()
			// HTML first (like browser navigation)
			for i := 0; i < htmlPerClient; i++ {
				rec := httptest.NewRecorder()
				req := httptest.NewRequest(http.MethodGet, "/", nil)
				req.RemoteAddr = officeIP
				router.ServeHTTP(rec, req)
				if rec.Code == http.StatusOK {
					htmlOK.Add(1)
				} else if rec.Code == http.StatusTooManyRequests {
					html429.Add(1)
				}
			}
			// Then the asset waterfall
			for i := 0; i < assetsPerClient; i++ {
				rec := httptest.NewRecorder()
				path := fmt.Sprintf("/static/js/async/%d.%d.js", client, i)
				req := httptest.NewRequest(http.MethodGet, path, nil)
				req.RemoteAddr = officeIP
				router.ServeHTTP(rec, req)
				if rec.Code == http.StatusOK {
					staticOK.Add(1)
				} else if rec.Code == http.StatusTooManyRequests {
					static429.Add(1)
				}
			}
			// logo etc.
			rec := httptest.NewRecorder()
			req := httptest.NewRequest(http.MethodGet, "/logo.png", nil)
			req.RemoteAddr = officeIP
			router.ServeHTTP(rec, req)
			if rec.Code == http.StatusOK {
				staticOK.Add(1)
			} else if rec.Code == http.StatusTooManyRequests {
				static429.Add(1)
			}
		}(c)
	}
	wg.Wait()
	elapsed := time.Since(start)

	totalStatic := int64(clients * (assetsPerClient + 1))
	totalHTML := int64(clients * htmlPerClient)

	t.Logf("cold-load NAT stress: clients=%d assets/client=%d html/client=%d elapsed=%s",
		clients, assetsPerClient, htmlPerClient, elapsed)
	t.Logf("static: ok=%d 429=%d (total=%d)", staticOK.Load(), static429.Load(), totalStatic)
	t.Logf("html:   ok=%d 429=%d (total=%d, budget=%d)", htmlOK.Load(), html429.Load(), totalHTML, common.GlobalWebRateLimitNum)

	require.Equal(t, totalStatic, staticOK.Load(), "all static assets must succeed under shared NAT")
	require.Zero(t, static429.Load(), "static must never 429 from Global Web limit")
	// HTML still throttled: more navigations than budget => some 429 expected.
	require.Equal(t, totalHTML, htmlOK.Load()+html429.Load())
	require.Greater(t, htmlOK.Load(), int64(0))
	if totalHTML > int64(common.GlobalWebRateLimitNum) {
		require.Greater(t, html429.Load(), int64(0), "HTML over budget should still 429")
	}
}

// TestLegacyStaticCountedWouldFail documents the pre-fix failure mode: if
// static consumed the same budget as HTML, a single cold load would 429.
func TestLegacyStaticCountedWouldFail(t *testing.T) {
	gin.SetMode(gin.TestMode)
	prevRedis := common.RedisEnabled
	t.Cleanup(func() { common.RedisEnabled = prevRedis })
	common.RedisEnabled = false
	inMemoryRateLimiter.Init(0)

	// Emulate OLD GlobalWebRateLimit: every path counts.
	oldLimiter := rateLimitFactory("GW-legacy-"+t.Name(), func() (bool, int, int64) {
		return true, 120, 180
	})
	router := gin.New()
	router.Use(oldLimiter)
	router.GET("/", func(c *gin.Context) { c.String(http.StatusOK, "home") })
	router.GET("/static/js/*filepath", func(c *gin.Context) { c.String(http.StatusOK, "js") })

	var okN, failN atomic.Int64
	// 2 clients x 80 assets + 2 html = 164 > 120
	for client := 0; client < 2; client++ {
		for i := 0; i < 2; i++ {
			rec := httptest.NewRecorder()
			req := httptest.NewRequest(http.MethodGet, "/", nil)
			req.RemoteAddr = "198.51.100.77:443"
			router.ServeHTTP(rec, req)
			if rec.Code == 200 {
				okN.Add(1)
			} else {
				failN.Add(1)
			}
		}
		for i := 0; i < 80; i++ {
			rec := httptest.NewRecorder()
			req := httptest.NewRequest(http.MethodGet, fmt.Sprintf("/static/js/c%d-%d.js", client, i), nil)
			req.RemoteAddr = "198.51.100.77:443"
			router.ServeHTTP(rec, req)
			if rec.Code == 200 {
				okN.Add(1)
			} else {
				failN.Add(1)
			}
		}
	}
	t.Logf("legacy behavior: ok=%d 429=%d", okN.Load(), failN.Load())
	require.Greater(t, failN.Load(), int64(0), "legacy shared bucket must 429 under cold-load burst")
}
