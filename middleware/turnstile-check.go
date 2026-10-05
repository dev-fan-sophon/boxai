package middleware

import (
	"context"
	"io"
	"net/http"
	"net/url"
	"strings"
	"time"

	"github.com/dev-fan-sophon/boxai/common"
	"github.com/gin-gonic/gin"
)

const turnstileTokenHeader = "X-Turnstile-Token"

var (
	turnstileSiteverifyURL = "https://challenges.cloudflare.com/turnstile/v0/siteverify"
	turnstileHTTPClient    = &http.Client{Timeout: 10 * time.Second}
)

type turnstileCheckResponse struct {
	Success bool `json:"success"`
}

func TurnstileCheck() gin.HandlerFunc {
	return func(c *gin.Context) {
		if !common.TurnstileCheckEnabled {
			c.Next()
			return
		}

		token := strings.TrimSpace(c.GetHeader(turnstileTokenHeader))
		if token == "" {
			// Keep accepting the legacy query parameter while clients migrate to the header.
			token = strings.TrimSpace(c.Query("turnstile"))
		}
		if token == "" || len(token) > 2048 || common.TurnstileSecretKey == "" {
			abortTurnstileCheck(c)
			return
		}

		form := url.Values{
			"secret":   {common.TurnstileSecretKey},
			"response": {token},
			"remoteip": {common.RealClientIP(c)},
		}
		ctx, cancel := context.WithTimeout(c.Request.Context(), 10*time.Second)
		defer cancel()
		req, err := http.NewRequestWithContext(ctx, http.MethodPost, turnstileSiteverifyURL, strings.NewReader(form.Encode()))
		if err != nil {
			common.SysError("failed to create Turnstile verification request: " + err.Error())
			abortTurnstileCheck(c)
			return
		}
		req.Header.Set("Content-Type", "application/x-www-form-urlencoded")

		rawRes, err := turnstileHTTPClient.Do(req)
		if err != nil {
			common.SysError("Turnstile verification request failed: " + err.Error())
			abortTurnstileCheck(c)
			return
		}
		defer rawRes.Body.Close()
		if rawRes.StatusCode < http.StatusOK || rawRes.StatusCode >= http.StatusMultipleChoices {
			common.SysError("Turnstile verification returned status " + rawRes.Status)
			abortTurnstileCheck(c)
			return
		}

		var result turnstileCheckResponse
		if err := common.DecodeJson(io.LimitReader(rawRes.Body, 64<<10), &result); err != nil {
			common.SysError("failed to decode Turnstile verification response: " + err.Error())
			abortTurnstileCheck(c)
			return
		}
		if !result.Success {
			abortTurnstileCheck(c)
			return
		}

		c.Next()
	}
}

func abortTurnstileCheck(c *gin.Context) {
	c.JSON(http.StatusOK, gin.H{
		"success": false,
		"message": "Human verification failed. Please try again.",
	})
	c.Abort()
}
