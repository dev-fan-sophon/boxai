package middleware

import (
	"context"
	"net/http"
	"net/http/httptest"
	"strconv"
	"sync"
	"sync/atomic"
	"testing"
	"time"

	"github.com/alicebob/miniredis/v2"
	"github.com/dev-fan-sophon/boxai/common"
	"github.com/gin-gonic/gin"
	"github.com/go-redis/redis/v8"
	"github.com/stretchr/testify/assert"
	"github.com/stretchr/testify/require"
)

func useRateLimitMiniRedis(t *testing.T) *miniredis.Miniredis {
	t.Helper()
	previousRedisEnabled := common.RedisEnabled
	previousRDB := common.RDB
	server := miniredis.RunT(t)
	client := redis.NewClient(&redis.Options{Addr: server.Addr()})
	require.NoError(t, client.Ping(context.Background()).Err())
	common.RedisEnabled = true
	common.RDB = client
	t.Cleanup(func() {
		_ = client.Close()
		common.RedisEnabled = previousRedisEnabled
		common.RDB = previousRDB
	})
	return server
}

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

func TestRedisRateLimiterUsesAtomicVersionedCounter(t *testing.T) {
	gin.SetMode(gin.TestMode)
	server := useRateLimitMiniRedis(t)
	legacyKey := "rateLimit:TEST192.0.2.10"
	_, err := server.Push(legacyKey, "legacy-list-entry")
	require.NoError(t, err)

	router := gin.New()
	require.NoError(t, router.SetTrustedProxies(nil))
	router.GET("/limited", rateLimitFactory("TEST", func() (bool, int, int64) {
		return true, 2, 37
	}), func(c *gin.Context) {
		c.Status(http.StatusNoContent)
	})

	request := func() *httptest.ResponseRecorder {
		recorder := httptest.NewRecorder()
		req := httptest.NewRequest(http.MethodGet, "/limited", nil)
		req.RemoteAddr = "192.0.2.10:12345"
		router.ServeHTTP(recorder, req)
		return recorder
	}
	assert.Equal(t, http.StatusNoContent, request().Code)
	assert.Equal(t, http.StatusNoContent, request().Code)
	limited := request()
	assert.Equal(t, http.StatusTooManyRequests, limited.Code)
	assert.Equal(t, "37", limited.Header().Get("Retry-After"))

	key := redisIPRateLimitKey("TEST", "192.0.2.10")
	count, err := server.Get(key)
	require.NoError(t, err)
	assert.Equal(t, "3", count)
	assert.Equal(t, 37*time.Second, server.TTL(key))
	assert.True(t, server.Exists(legacyKey))
}

func TestRedisFixedWindowIsAtomicUnderConcurrency(t *testing.T) {
	server := useRateLimitMiniRedis(t)
	const (
		requestCount = 20
		maximumCount = 7
		duration     = int64(41)
	)
	key := redisIPRateLimitKey("CONCURRENT", "192.0.2.40")

	var allowedCount atomic.Int64
	errorsFound := make(chan error, requestCount)
	var waitGroup sync.WaitGroup
	waitGroup.Add(requestCount)
	for range requestCount {
		go func() {
			defer waitGroup.Done()
			allowed, _, _, err := redisFixedWindowTake(context.Background(), key, maximumCount, duration)
			if err != nil {
				errorsFound <- err
				return
			}
			if allowed {
				allowedCount.Add(1)
			}
		}()
	}
	waitGroup.Wait()
	close(errorsFound)
	for err := range errorsFound {
		require.NoError(t, err)
	}

	assert.Equal(t, int64(maximumCount), allowedCount.Load())
	count, err := server.Get(key)
	require.NoError(t, err)
	assert.Equal(t, "20", count)
	assert.Equal(t, time.Duration(duration)*time.Second, server.TTL(key))
}

func TestRedisEmailVerificationRateLimiterUsesSharedCounter(t *testing.T) {
	gin.SetMode(gin.TestMode)
	server := useRateLimitMiniRedis(t)
	router := gin.New()
	require.NoError(t, router.SetTrustedProxies(nil))
	router.GET("/verify", EmailVerificationRateLimit(), func(c *gin.Context) {
		c.Status(http.StatusNoContent)
	})

	request := func() *httptest.ResponseRecorder {
		recorder := httptest.NewRecorder()
		req := httptest.NewRequest(http.MethodGet, "/verify", nil)
		req.RemoteAddr = "192.0.2.30:12345"
		router.ServeHTTP(recorder, req)
		return recorder
	}
	assert.Equal(t, http.StatusNoContent, request().Code)
	assert.Equal(t, http.StatusNoContent, request().Code)
	limited := request()
	assert.Equal(t, http.StatusTooManyRequests, limited.Code)
	assert.JSONEq(t, `{"success":false,"message":"发送过于频繁，请等待 30 秒后再试"}`, limited.Body.String())

	key := redisIPRateLimitKey(EmailVerificationRateLimitMark, "192.0.2.30")
	assert.True(t, server.Exists(key))
	assert.Equal(t, time.Duration(EmailVerificationDuration)*time.Second, server.TTL(key))
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

func TestUserCriticalRateLimitUsesUserIdentityAcrossIPs(t *testing.T) {
	tests := []struct {
		name  string
		redis bool
	}{
		{name: "memory"},
		{name: "redis", redis: true},
	}

	for _, test := range tests {
		t.Run(test.name, func(t *testing.T) {
			previousRedisEnabled := common.RedisEnabled
			previousRDB := common.RDB
			previousEnabled := common.CriticalRateLimitEnable
			previousNum := common.CriticalRateLimitNum
			previousDuration := common.CriticalRateLimitDuration
			t.Cleanup(func() {
				if test.redis {
					_ = common.RDB.Close()
				}
				common.RedisEnabled = previousRedisEnabled
				common.RDB = previousRDB
				common.CriticalRateLimitEnable = previousEnabled
				common.CriticalRateLimitNum = previousNum
				common.CriticalRateLimitDuration = previousDuration
			})

			common.RedisEnabled = test.redis
			common.CriticalRateLimitEnable = true
			common.CriticalRateLimitNum = 1
			common.CriticalRateLimitDuration = 60
			if test.redis {
				server := miniredis.RunT(t)
				common.RDB = redis.NewClient(&redis.Options{Addr: server.Addr()})
			}

			router := gin.New()
			router.Use(func(c *gin.Context) {
				userID, _ := strconv.Atoi(c.GetHeader("X-Test-User"))
				c.Set("id", userID)
			})
			router.POST("/critical", UserCriticalRateLimit(t.Name()), func(c *gin.Context) {
				c.Status(http.StatusNoContent)
			})

			request := func(userID int, remoteAddr string) *httptest.ResponseRecorder {
				recorder := httptest.NewRecorder()
				req := httptest.NewRequest(http.MethodPost, "/critical", nil)
				req.Header.Set("X-Test-User", strconv.Itoa(userID))
				req.RemoteAddr = remoteAddr
				router.ServeHTTP(recorder, req)
				return recorder
			}

			assert.Equal(t, http.StatusNoContent, request(41, "192.0.2.1:1000").Code)
			blocked := request(41, "198.51.100.2:2000")
			assert.Equal(t, http.StatusTooManyRequests, blocked.Code)
			assert.Equal(t, "60", blocked.Header().Get("Retry-After"))
			assert.Equal(t, http.StatusNoContent, request(42, "198.51.100.2:2000").Code)
			assert.Equal(t, http.StatusUnauthorized, request(0, "203.0.113.3:3000").Code)
		})
	}
}
