package middleware

import (
	"context"
	"fmt"
	"net/http"
	"strconv"
	"strings"
	"time"

	"github.com/dev-fan-sophon/boxai/common"
	"github.com/dev-fan-sophon/boxai/common/limiter"
	"github.com/dev-fan-sophon/boxai/constant"
	"github.com/dev-fan-sophon/boxai/setting"

	"github.com/gin-gonic/gin"
	"github.com/google/uuid"
)

const (
	ModelRequestRateLimitCountMark        = "MRRL"
	ModelRequestRateLimitSuccessCountMark = "MRRLS"
)

var modelSuccessLimiter = limiter.NewSuccessMemory()

func modelRequestSucceeded(c *gin.Context) bool {
	if c.Request.Context().Err() != nil || c.Writer.Status() >= 400 {
		return false
	}
	if outcome, exists := c.Get(limiter.RelayOutcomeKey); exists {
		return outcome == true
	}
	// Do not guess stream success from HTTP 200 when no protocol outcome exists.
	return !strings.HasPrefix(c.Writer.Header().Get("Content-Type"), "text/event-stream")
}

// Redis限流处理器
func redisRateLimitHandler(duration int64, totalMaxCount, successMaxCount int) gin.HandlerFunc {
	return func(c *gin.Context) {
		userId := strconv.Itoa(c.GetInt("id"))
		ctx := context.Background()
		rdb := common.RDB

		success := false
		if successMaxCount > 0 {
			successKey := fmt.Sprintf("rateLimit:%s:v2:%s", ModelRequestRateLimitSuccessCountMark, userId)
			id := uuid.NewString()
			window := time.Duration(duration) * time.Second
			reserveCtx, cancelReserve := context.WithTimeout(ctx, 5*time.Second)
			allowed, err := limiter.SuccessRedis(reserveCtx, rdb, successKey, id, "reserve", successMaxCount, window, limiter.SuccessLease)
			cancelReserve()
			if err != nil {
				common.SysError("success rate limit reserve: " + err.Error())
				abortWithOpenAiMessage(c, http.StatusInternalServerError, "rate_limit_check_failed")
				return
			}
			if !allowed {
				abortWithOpenAiMessage(c, http.StatusTooManyRequests, fmt.Sprintf("您已达到请求数限制：%d分钟内最多请求%d次", setting.ModelRequestRateLimitDurationMinutes, successMaxCount))
				return
			}
			originalCtx := c.Request.Context()
			requestCtx, cancelRequest := context.WithCancel(originalCtx)
			c.Request = c.Request.WithContext(requestCtx)
			stop, stopped := make(chan struct{}), make(chan struct{})
			go func() {
				defer close(stopped)
				ticker := time.NewTicker(limiter.SuccessLease / 3)
				defer ticker.Stop()
				for {
					select {
					case <-stop:
						return
					case <-ticker.C:
						renewCtx, cancel := context.WithTimeout(context.Background(), 5*time.Second)
						ok, err := limiter.SuccessRedis(renewCtx, rdb, successKey, id, "renew", successMaxCount, window, limiter.SuccessLease)
						cancel()
						if err != nil || !ok {
							common.SysError(fmt.Sprintf("success rate limit lease lost: %v", err))
							cancelRequest()
							return
						}
					}
				}
			}()
			defer func() {
				close(stop)
				<-stopped
				operation := "release"
				if success && requestCtx.Err() == nil {
					operation = "success"
				}
				cancelRequest()
				c.Request = c.Request.WithContext(originalCtx)
				completeCtx, cancel := context.WithTimeout(context.Background(), 5*time.Second)
				defer cancel()
				ok, err := limiter.SuccessRedis(completeCtx, rdb, successKey, id, operation, successMaxCount, window, limiter.SuccessLease)
				if err != nil || !ok {
					common.SysError(fmt.Sprintf("success rate limit complete: lease=%t error=%v", ok, err))
				}
			}()
		}

		//2.检查总请求数限制并记录总请求（当totalMaxCount为0时会自动跳过，使用令牌桶限流器
		if totalMaxCount > 0 {
			totalKey := fmt.Sprintf("rateLimit:%s", userId)
			// 初始化
			tb := limiter.New(ctx, rdb)
			allowed, err := tb.Allow(
				ctx,
				totalKey,
				limiter.WithCapacity(int64(totalMaxCount)*duration),
				limiter.WithRate(int64(totalMaxCount)),
				limiter.WithRequested(duration),
			)

			if err != nil {
				fmt.Println("检查总请求数限制失败:", err.Error())
				abortWithOpenAiMessage(c, http.StatusInternalServerError, "rate_limit_check_failed")
				return
			}

			if !allowed {
				abortWithOpenAiMessage(c, http.StatusTooManyRequests, fmt.Sprintf("您已达到总请求数限制：%d分钟内最多请求%d次，包括失败次数，请检查您的请求是否正确", setting.ModelRequestRateLimitDurationMinutes, totalMaxCount))
				return
			}
		}

		// 4. 处理请求
		c.Next()

		success = modelRequestSucceeded(c)
	}
}

// 内存限流处理器
func memoryRateLimitHandler(duration int64, totalMaxCount, successMaxCount int) gin.HandlerFunc {
	inMemoryRateLimiter.Init(time.Duration(setting.ModelRequestRateLimitDurationMinutes) * time.Minute)

	return func(c *gin.Context) {
		userId := strconv.Itoa(c.GetInt("id"))
		totalKey := ModelRequestRateLimitCountMark + userId
		successKey := ModelRequestRateLimitSuccessCountMark + userId

		// 1. 检查总请求数限制（当totalMaxCount为0时跳过）
		if totalMaxCount > 0 && !inMemoryRateLimiter.Request(totalKey, totalMaxCount, duration) {
			c.Status(http.StatusTooManyRequests)
			c.Abort()
			return
		}

		complete, allowed := modelSuccessLimiter.Reserve(successKey, successMaxCount, time.Duration(duration)*time.Second)
		if !allowed {
			c.Status(http.StatusTooManyRequests)
			c.Abort()
			return
		}
		success := false
		defer func() { complete(success) }()

		// 3. 处理请求
		c.Next()

		success = modelRequestSucceeded(c)
	}
}

// ModelRequestRateLimit 模型请求限流中间件
func ModelRequestRateLimit() func(c *gin.Context) {
	return func(c *gin.Context) {
		// 在每个请求时检查是否启用限流
		if !setting.ModelRequestRateLimitEnabled {
			c.Next()
			return
		}

		// 计算限流参数
		duration := int64(setting.ModelRequestRateLimitDurationMinutes * 60)
		totalMaxCount := setting.ModelRequestRateLimitCount
		successMaxCount := setting.ModelRequestRateLimitSuccessCount

		// 获取分组
		group := common.GetContextKeyString(c, constant.ContextKeyTokenGroup)
		if group == "" {
			group = common.GetContextKeyString(c, constant.ContextKeyUserGroup)
		}

		//获取分组的限流配置
		groupTotalCount, groupSuccessCount, found := setting.GetGroupRateLimit(group)
		if found {
			totalMaxCount = groupTotalCount
			successMaxCount = groupSuccessCount
		}

		// 根据存储类型选择并执行限流处理器
		if common.RedisEnabled {
			redisRateLimitHandler(duration, totalMaxCount, successMaxCount)(c)
		} else {
			memoryRateLimitHandler(duration, totalMaxCount, successMaxCount)(c)
		}
	}
}
