package middleware

import (
	"fmt"
	"strings"

	"github.com/dev-fan-sophon/boxai/common"
	relaycommon "github.com/dev-fan-sophon/boxai/relay/common"
	"github.com/gin-gonic/gin"
)

const RouteTagKey = "route_tag"

func RouteTag(tag string) gin.HandlerFunc {
	return func(c *gin.Context) {
		c.Set(RouteTagKey, tag)
		c.Next()
	}
}

func SetUpLogger(server *gin.Engine) {
	server.Use(gin.LoggerWithFormatter(func(param gin.LogFormatterParams) string {
		var requestID string
		if param.Keys != nil {
			requestID, _ = param.Keys[common.RequestIdKey].(string)
		}
		tag, _ := param.Keys[RouteTagKey].(string)
		if tag == "" {
			tag = "web"
		}
		// Redact the log value only; handlers still see the original query.
		path := param.Path
		if strings.HasPrefix(path, "/api/oauth/") || strings.HasPrefix(path, "/oauth/") {
			// OAuth callbacks carry one-time codes and state in the query string.
			path, _, _ = strings.Cut(path, "?")
		} else if param.Request.URL.RawQuery != "" {
			query := param.Request.URL.Query().Encode()
			path = param.Request.URL.EscapedPath() + relaycommon.SanitizeURLForLog("?"+query)
		} else {
			// param.Path keeps the query the request arrived with, including a
			// credential a handler took out of it.
			path = param.Request.URL.Path
		}
		return fmt.Sprintf("[GIN] %s | %s | %s | %3d | %13v | %15s | %7s %s\n",
			param.TimeStamp.Format("2006/01/02 - 15:04:05"),
			tag,
			requestID,
			param.StatusCode,
			param.Latency,
			param.ClientIP,
			param.Method,
			path,
		)
	}))
}
