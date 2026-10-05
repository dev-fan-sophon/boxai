package middleware

import (
	"context"
	"net/http/httptest"
	"testing"

	"github.com/alicebob/miniredis/v2"
	"github.com/dev-fan-sophon/boxai/common"
	"github.com/dev-fan-sophon/boxai/common/limiter"
	"github.com/dev-fan-sophon/boxai/setting/operation_setting"
	"github.com/gin-gonic/gin"
	"github.com/go-redis/redis/v8"
	"github.com/stretchr/testify/assert"
	"github.com/stretchr/testify/require"
)

func TestModelSuccessQuotaOutcomes(t *testing.T) {
	for _, backend := range []string{"memory", "redis"} {
		for _, failure := range []string{"http", "protocol", "cancel", "unknown-stream", "panic"} {
			t.Run(backend+"/"+failure, func(t *testing.T) {
				oldMemory, oldRedis := modelSuccessLimiter, common.RDB
				modelSuccessLimiter = limiter.NewSuccessMemory()
				t.Cleanup(func() { modelSuccessLimiter, common.RDB = oldMemory, oldRedis })
				handler := memoryRateLimitHandler(60, 0, 1)
				if backend == "redis" {
					server := miniredis.RunT(t)
					client := redis.NewClient(&redis.Options{Addr: server.Addr()})
					t.Cleanup(func() { require.NoError(t, client.Close()) })
					common.RDB = client
					handler = redisRateLimitHandler(60, 0, 1)
				}
				router := gin.New()
				router.Use(gin.Recovery(), handler)
				router.GET("/", func(c *gin.Context) {
					if c.Query("fail") != "" {
						switch failure {
						case "http":
							c.Status(500)
						case "protocol":
							c.Header("Content-Type", "text/event-stream")
							c.Set(limiter.RelayOutcomeKey, false)
							c.String(200, "data: {\"error\":\"failed\"}\n\n")
						case "unknown-stream":
							c.Header("Content-Type", "text/event-stream")
						case "cancel":
							ctx, cancel := context.WithCancel(c.Request.Context())
							cancel()
							c.Request = c.Request.WithContext(ctx)
						case "panic":
							panic("failed relay")
						}
						return
					}
					c.Header("Content-Type", "text/event-stream")
					c.Set(limiter.RelayOutcomeKey, true)
					c.Status(200)
				})
				for _, path := range []string{"/?fail=1", "/?fail=1"} {
					w := httptest.NewRecorder()
					router.ServeHTTP(w, httptest.NewRequest("GET", path, nil))
					assert.NotEqual(t, 429, w.Code, "failure must not occupy success quota")
				}
				w := httptest.NewRecorder()
				router.ServeHTTP(w, httptest.NewRequest("GET", "/", nil))
				require.Equal(t, 200, w.Code)
				w = httptest.NewRecorder()
				router.ServeHTTP(w, httptest.NewRequest("GET", "/", nil))
				assert.Equal(t, 429, w.Code, "successful SSE must consume quota")
			})
		}
	}
}

func TestAccountConcurrencyTwoAcrossModelsAndImmediateRelease(t *testing.T) {
	for _, backend := range []string{"memory", "redis"} {
		t.Run(backend, func(t *testing.T) {
			oldMemory, oldRedis, oldEnabled := modelSuccessLimiter, common.RDB, common.RedisEnabled
			oldPolicy, err := common.Marshal(operation_setting.GetRegistrationRiskPolicy())
			require.NoError(t, err)
			modelSuccessLimiter = limiter.NewSuccessMemory()
			common.RedisEnabled = backend == "redis"
			t.Cleanup(func() {
				modelSuccessLimiter, common.RDB, common.RedisEnabled = oldMemory, oldRedis, oldEnabled
				require.NoError(t, operation_setting.SetRegistrationRiskPolicy(string(oldPolicy)))
			})
			require.NoError(t, operation_setting.SetRegistrationRiskPolicy(`{"enabled":true,"registration_ip_daily":20,"email_ip_hourly":10,"email_identity_hourly":3}`))
			if common.RedisEnabled {
				server := miniredis.RunT(t)
				client := redis.NewClient(&redis.Options{Addr: server.Addr()})
				t.Cleanup(func() { require.NoError(t, client.Close()) })
				common.RDB = client
			}
			router := gin.New()
			router.Use(func(c *gin.Context) {
				id := 101
				if c.Query("other") != "" {
					id = 102
				}
				c.Set("id", id)
			}, UserConcurrencyLimit())
			router.GET("/:model", func(c *gin.Context) {
				switch c.Query("depth") {
				case "first":
					// Nested handlers keep both leases active without sleeps.
					second := httptest.NewRecorder()
					router.ServeHTTP(second, httptest.NewRequest("GET", "/expensive-model?depth=second", nil))
					assert.Equal(t, 200, second.Code)
				case "second":
					third := httptest.NewRecorder()
					router.ServeHTTP(third, httptest.NewRequest("GET", "/another-model", nil))
					assert.Equal(t, 429, third.Code)
					other := httptest.NewRecorder()
					router.ServeHTTP(other, httptest.NewRequest("GET", "/another-model?other=1", nil))
					assert.Equal(t, 200, other.Code, "another account has its own slots")
				}
				c.Status(200)
			})
			for _, path := range []string{"/cheap-model?depth=first", "/cheap-model?depth=first", "/expensive-model"} {
				w := httptest.NewRecorder()
				router.ServeHTTP(w, httptest.NewRequest("GET", path, nil))
				assert.Equal(t, 200, w.Code, "completed requests must not consume a rate window")
			}
		})
	}
}
