package middleware

import (
	"context"
	"fmt"
	"net/http"
	"strconv"
	"time"

	"github.com/QuantumNous/new-api/common"
	"github.com/gin-gonic/gin"
)

var timeFormat = "2006-01-02T15:04:05.000Z"

var inMemoryRateLimiter common.InMemoryRateLimiter

// rateLimitConfig reports the live throttle for a mark. It is evaluated on every
// request so administrators can retune limits without restarting the process.
type rateLimitConfig func() (enabled bool, maxRequestNum int, duration int64)

func redisRateLimiter(c *gin.Context, maxRequestNum int, duration int64, mark string) {
	ctx := context.Background()
	rdb := common.RDB
	key := "rateLimit:" + mark + common.RealClientIP(c)
	listLength, err := rdb.LLen(ctx, key).Result()
	if err != nil {
		fmt.Println(err.Error())
		c.Status(http.StatusInternalServerError)
		c.Abort()
		return
	}
	if listLength < int64(maxRequestNum) {
		rdb.LPush(ctx, key, time.Now().Format(timeFormat))
		rdb.Expire(ctx, key, common.RateLimitKeyExpirationDuration)
	} else {
		oldTimeStr, _ := rdb.LIndex(ctx, key, -1).Result()
		oldTime, err := time.Parse(timeFormat, oldTimeStr)
		if err != nil {
			fmt.Println(err)
			c.Status(http.StatusInternalServerError)
			c.Abort()
			return
		}
		nowTimeStr := time.Now().Format(timeFormat)
		nowTime, err := time.Parse(timeFormat, nowTimeStr)
		if err != nil {
			fmt.Println(err)
			c.Status(http.StatusInternalServerError)
			c.Abort()
			return
		}
		// time.Since will return negative number!
		// See: https://stackoverflow.com/questions/50970900/why-is-time-since-returning-negative-durations-on-windows
		elapsed := int64(nowTime.Sub(oldTime).Seconds())
		if elapsed < duration {
			rdb.Expire(ctx, key, common.RateLimitKeyExpirationDuration)
			writeRateLimited(c, duration-elapsed)
			return
		} else {
			rdb.LPush(ctx, key, time.Now().Format(timeFormat))
			rdb.LTrim(ctx, key, 0, int64(maxRequestNum-1))
			rdb.Expire(ctx, key, common.RateLimitKeyExpirationDuration)
		}
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
	return rateLimitFactory("GW", func() (bool, int, int64) {
		return common.GlobalWebRateLimitEnable, common.GlobalWebRateLimitNum, common.GlobalWebRateLimitDuration
	})
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
			userRedisRateLimiter(c, maxRequestNum, duration, fmt.Sprintf("rateLimit:%s:user:%d", mark, userId))
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
	ctx := context.Background()
	rdb := common.RDB
	listLength, err := rdb.LLen(ctx, key).Result()
	if err != nil {
		fmt.Println(err.Error())
		c.Status(http.StatusInternalServerError)
		c.Abort()
		return
	}
	if listLength < int64(maxRequestNum) {
		rdb.LPush(ctx, key, time.Now().Format(timeFormat))
		rdb.Expire(ctx, key, common.RateLimitKeyExpirationDuration)
	} else {
		oldTimeStr, _ := rdb.LIndex(ctx, key, -1).Result()
		oldTime, err := time.Parse(timeFormat, oldTimeStr)
		if err != nil {
			fmt.Println(err)
			c.Status(http.StatusInternalServerError)
			c.Abort()
			return
		}
		nowTimeStr := time.Now().Format(timeFormat)
		nowTime, err := time.Parse(timeFormat, nowTimeStr)
		if err != nil {
			fmt.Println(err)
			c.Status(http.StatusInternalServerError)
			c.Abort()
			return
		}
		elapsed := int64(nowTime.Sub(oldTime).Seconds())
		if elapsed < duration {
			rdb.Expire(ctx, key, common.RateLimitKeyExpirationDuration)
			writeRateLimited(c, duration-elapsed)
			return
		} else {
			rdb.LPush(ctx, key, time.Now().Format(timeFormat))
			rdb.LTrim(ctx, key, 0, int64(maxRequestNum-1))
			rdb.Expire(ctx, key, common.RateLimitKeyExpirationDuration)
		}
	}
}

// SearchRateLimit returns a per-user rate limiter for search endpoints.
func SearchRateLimit() func(c *gin.Context) {
	return userRateLimitFactory("SR", func() (bool, int, int64) {
		return common.SearchRateLimitEnable, common.SearchRateLimitNum, common.SearchRateLimitDuration
	})
}
