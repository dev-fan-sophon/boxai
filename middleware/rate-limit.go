package middleware

import (
	"context"
	"errors"
	"fmt"
	"net/http"
	"path"
	"strconv"
	"strings"

	"github.com/dev-fan-sophon/boxai/common"
	"github.com/dev-fan-sophon/boxai/logger"
	"github.com/gin-gonic/gin"
)

const (
	redisRateLimitNamespace = "rateLimit:v2"
	timeFormat              = "2006-01-02T15:04:05.000Z"
)

// Redis rate limiting uses an atomic fixed window. The versioned namespace
// avoids colliding with legacy keys that stored Redis lists instead of counters.
const redisFixedWindowScript = `
local count = redis.call('INCR', KEYS[1])
if count == 1 then
  redis.call('EXPIRE', KEYS[1], ARGV[2])
end
local ttl = redis.call('TTL', KEYS[1])
if ttl < 0 then
  redis.call('EXPIRE', KEYS[1], ARGV[2])
  ttl = redis.call('TTL', KEYS[1])
end
if count > tonumber(ARGV[1]) then
  return {0, count, ttl}
end
return {1, count, ttl}
`

var inMemoryRateLimiter common.InMemoryRateLimiter

// rateLimitConfig reports the live throttle for a mark. It is evaluated on every
// request so administrators can retune limits without restarting the process.
type rateLimitConfig func() (enabled bool, maxRequestNum int, duration int64)

func redisIPRateLimitKey(mark string, clientIP string) string {
	return fmt.Sprintf("%s:ip:%s:%s", redisRateLimitNamespace, mark, clientIP)
}

func redisUserRateLimitKey(mark string, userID int) string {
	return fmt.Sprintf("%s:user:%s:%d", redisRateLimitNamespace, mark, userID)
}

func redisReplyInteger(value interface{}) (int64, error) {
	switch typed := value.(type) {
	case int64:
		return typed, nil
	case string:
		return strconv.ParseInt(typed, 10, 64)
	case []byte:
		return strconv.ParseInt(string(typed), 10, 64)
	default:
		return 0, fmt.Errorf("unexpected Redis integer reply type %T", value)
	}
}

func redisFixedWindowTake(ctx context.Context, key string, maxRequestNum int, duration int64) (bool, int64, int64, error) {
	if common.RDB == nil {
		return false, 0, 0, errors.New("Redis client is not initialized")
	}
	if key == "" {
		return false, 0, 0, errors.New("rate limit key is empty")
	}
	if maxRequestNum <= 0 {
		return false, 0, 0, errors.New("rate limit maximum must be positive")
	}
	if duration <= 0 {
		return false, 0, 0, errors.New("rate limit duration must be positive")
	}

	values, err := common.RDB.Eval(ctx, redisFixedWindowScript, []string{key}, maxRequestNum, duration).Slice()
	if err != nil {
		return false, 0, 0, err
	}
	if len(values) != 3 {
		return false, 0, 0, fmt.Errorf("unexpected Redis rate limit reply length %d", len(values))
	}

	allowedValue, err := redisReplyInteger(values[0])
	if err != nil {
		return false, 0, 0, err
	}
	count, err := redisReplyInteger(values[1])
	if err != nil {
		return false, 0, 0, err
	}
	ttlSeconds, err := redisReplyInteger(values[2])
	if err != nil {
		return false, 0, 0, err
	}
	return allowedValue == 1, count, ttlSeconds, nil
}

func redisRateLimiter(c *gin.Context, maxRequestNum int, duration int64, mark string) {
	allowed, _, ttlSeconds, err := redisFixedWindowTake(
		c.Request.Context(),
		redisIPRateLimitKey(mark, common.RealClientIP(c)),
		maxRequestNum,
		duration,
	)
	if err != nil {
		logger.LogError(c.Request.Context(), fmt.Sprintf("rate limit check failed (mark=%s): %v", mark, err))
		c.Status(http.StatusInternalServerError)
		c.Abort()
		return
	}
	if !allowed {
		writeRateLimited(c, ttlSeconds)
	}
}

func memoryRateLimiter(c *gin.Context, maxRequestNum int, duration int64, mark string) {
	key := mark + common.RealClientIP(c)
	if !inMemoryRateLimiter.Request(key, maxRequestNum, duration) {
		writeRateLimited(c, duration)
		return
	}
}

func writeRateLimited(c *gin.Context, retryAfterSeconds int64) {
	if retryAfterSeconds > 0 {
		c.Header("Retry-After", strconv.FormatInt(retryAfterSeconds, 10))
	}
	c.Status(http.StatusTooManyRequests)
	c.Abort()
}

func rateLimitFactory(mark string, config rateLimitConfig) func(c *gin.Context) {
	// It's safe to call multi times.
	inMemoryRateLimiter.Init(common.RateLimitKeyExpirationDuration)
	return func(c *gin.Context) {
		enabled, maxRequestNum, duration := config()
		if !enabled || maxRequestNum <= 0 || duration <= 0 {
			c.Next()
			return
		}
		if common.RedisEnabled {
			redisRateLimiter(c, maxRequestNum, duration, mark)
			return
		}
		memoryRateLimiter(c, maxRequestNum, duration, mark)
	}
}

func GlobalWebRateLimit() func(c *gin.Context) {
	// Fingerprinted SPA assets already sit on Cloudflare CDN, but a cache MISS
	// still reaches origin. Counting those bursts against the shared per-IP web
	// bucket turns one homepage cold load (dozens of /static/* files) into a
	// 429 white-screen for every client behind the same NAT. Skip immutable
	// static assets here; HTML document routes remain throttled.
	limiter := rateLimitFactory("GW", func() (bool, int, int64) {
		return common.GlobalWebRateLimitEnable, common.GlobalWebRateLimitNum, common.GlobalWebRateLimitDuration
	})
	return func(c *gin.Context) {
		if skipGlobalWebRateLimit(c.Request.URL.Path) {
			c.Next()
			return
		}
		limiter(c)
	}
}

// skipGlobalWebRateLimit reports whether path is a cacheable frontend asset
// that must not consume the shared per-IP Global Web budget.
func skipGlobalWebRateLimit(requestPath string) bool {
	if requestPath == "/static" || strings.HasPrefix(requestPath, "/static/") {
		return true
	}
	switch strings.ToLower(path.Ext(requestPath)) {
	case ".js", ".css", ".map", ".mjs", ".cjs",
		".png", ".jpg", ".jpeg", ".gif", ".svg", ".ico", ".webp", ".avif",
		".woff", ".woff2", ".ttf", ".otf", ".eot",
		".wasm", ".txt", ".webmanifest":
		return true
	default:
		return false
	}
}

func GlobalAPIRateLimit() func(c *gin.Context) {
	return rateLimitFactory("GA", func() (bool, int, int64) {
		return common.GlobalApiRateLimitEnable, common.GlobalApiRateLimitNum, common.GlobalApiRateLimitDuration
	})
}

func CriticalRateLimit() func(c *gin.Context) {
	return rateLimitFactory("CT", func() (bool, int, int64) {
		return common.CriticalRateLimitEnable, common.CriticalRateLimitNum, common.CriticalRateLimitDuration
	})
}

// UserCriticalRateLimit applies the critical-operation budget per authenticated
// user, so rotating source IPs cannot bypass limits on sensitive state changes.
func UserCriticalRateLimit(scope string) func(c *gin.Context) {
	return userRateLimitFactory("UC:"+scope, func() (bool, int, int64) {
		return common.CriticalRateLimitEnable, common.CriticalRateLimitNum, common.CriticalRateLimitDuration
	})
}

func DownloadRateLimit() func(c *gin.Context) {
	return rateLimitFactory("DW", func() (bool, int, int64) {
		return common.DownloadRateLimitEnable, common.DownloadRateLimitNum, common.DownloadRateLimitDuration
	})
}

func UploadRateLimit() func(c *gin.Context) {
	return rateLimitFactory("UP", func() (bool, int, int64) {
		return common.UploadRateLimitEnable, common.UploadRateLimitNum, common.UploadRateLimitDuration
	})
}

// userRateLimitFactory creates a rate limiter keyed by authenticated user ID
// instead of client IP, making it resistant to proxy rotation attacks.
// Must be used AFTER authentication middleware (UserAuth).
func userRateLimitFactory(mark string, config rateLimitConfig) func(c *gin.Context) {
	// It's safe to call multi times.
	inMemoryRateLimiter.Init(common.RateLimitKeyExpirationDuration)
	return func(c *gin.Context) {
		enabled, maxRequestNum, duration := config()
		if !enabled || maxRequestNum <= 0 || duration <= 0 {
			c.Next()
			return
		}
		userId := c.GetInt("id")
		if userId == 0 {
			c.Status(http.StatusUnauthorized)
			c.Abort()
			return
		}
		if common.RedisEnabled {
			userRedisRateLimiter(c, maxRequestNum, duration, redisUserRateLimitKey(mark, userId))
			return
		}
		key := fmt.Sprintf("%s:user:%d", mark, userId)
		if !inMemoryRateLimiter.Request(key, maxRequestNum, duration) {
			writeRateLimited(c, duration)
			return
		}
	}
}

// userRedisRateLimiter is like redisRateLimiter but accepts a pre-built key
// (to support user-ID-based keys).
func userRedisRateLimiter(c *gin.Context, maxRequestNum int, duration int64, key string) {
	allowed, _, ttlSeconds, err := redisFixedWindowTake(c.Request.Context(), key, maxRequestNum, duration)
	if err != nil {
		logger.LogError(c.Request.Context(), fmt.Sprintf("rate limit check failed (key=%s): %v", key, err))
		c.Status(http.StatusInternalServerError)
		c.Abort()
		return
	}
	if !allowed {
		writeRateLimited(c, ttlSeconds)
	}
}

// SearchRateLimit returns a per-user rate limiter for search endpoints.
func SearchRateLimit() func(c *gin.Context) {
	return userRateLimitFactory("SR", func() (bool, int, int64) {
		return common.SearchRateLimitEnable, common.SearchRateLimitNum, common.SearchRateLimitDuration
	})
}
