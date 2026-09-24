package middleware

import (
	"context"
	"net/http/httptest"
	"testing"

	"github.com/alicebob/miniredis/v2"
	"github.com/dev-fan-sophon/boxai/common"
	"github.com/dev-fan-sophon/boxai/common/limiter"
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
