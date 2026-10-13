package middleware

import (
	"io"
	"net/http"
	"net/http/httptest"
	"strings"
	"testing"
	"time"

	"github.com/gin-gonic/gin"
	"github.com/stretchr/testify/assert"
	"github.com/stretchr/testify/require"
)

const keepaliveErrorBody = `{"error":{"message":"upstream failed"}}`

func TestResponseKeepaliveKeepsSlowResponseOpen(t *testing.T) {
	tests := []struct {
		name  string
		idle  time.Duration
		optIn bool
	}{
		{name: "idle delay without header", idle: 5 * time.Millisecond},
		{name: "opt-in header on opt-in route", idle: 0, optIn: true},
	}
	for _, tt := range tests {
		t.Run(tt.name, func(t *testing.T) {
			gin.SetMode(gin.TestMode)
			proceed := make(chan struct{})
			writtenBeforeError := make(chan bool, 1)
			router := gin.New()
			router.POST("/slow", ResponseKeepalive(tt.idle, 5*time.Millisecond), func(c *gin.Context) {
				// Header edits while pings run must not race them.
				c.Header("X-Upstream", "slow")
				<-proceed
				// Relay retries are skipped once Written reports true.
				writtenBeforeError <- c.Writer.Written()
				c.JSON(http.StatusBadGateway, gin.H{"error": gin.H{"message": "upstream failed"}})
			})
			server := httptest.NewServer(router)
			defer server.Close()

			req, err := http.NewRequest(http.MethodPost, server.URL+"/slow", strings.NewReader(`{"model":"m"}`))
			require.NoError(t, err)
			req.Header.Set("Content-Type", "application/json")
			if tt.optIn {
				req.Header.Set(ResponseKeepaliveHeader, "1")
			}
			resp, err := http.DefaultClient.Do(req)
			require.NoError(t, err)
			defer resp.Body.Close()

			first := make([]byte, 1)
			_, err = io.ReadFull(resp.Body, first)
			require.NoError(t, err)
			close(proceed)
			rest, err := io.ReadAll(resp.Body)
			require.NoError(t, err)

			assert.Equal(t, http.StatusOK, resp.StatusCode)
			assert.Equal(t, "application/json; charset=utf-8", resp.Header.Get("Content-Type"))
			assert.Equal(t, " ", string(first))
			assert.Equal(t, keepaliveErrorBody, strings.TrimSpace(string(rest)))
			assert.False(t, <-writtenBeforeError)
		})
	}
}

func TestResponseKeepaliveLeavesOtherResponsesUnchanged(t *testing.T) {
	tests := []struct {
		name        string
		idle        time.Duration
		optIn       bool
		contentType string
		body        string
	}{
		{name: "opt-in route without header", idle: 0, contentType: "application/json", body: `{"model":"m"}`},
		{name: "streaming request", idle: time.Nanosecond, optIn: true, contentType: "application/json", body: `{"model":"m","stream":true}`},
		{name: "multipart request", idle: time.Nanosecond, optIn: true, contentType: "multipart/form-data; boundary=x", body: "--x--"},
	}
	for _, tt := range tests {
		t.Run(tt.name, func(t *testing.T) {
			gin.SetMode(gin.TestMode)
			router := gin.New()
			router.POST("/slow", ResponseKeepalive(tt.idle, time.Nanosecond), func(c *gin.Context) {
				_, wrapped := c.Writer.(*keepaliveWriter)
				assert.False(t, wrapped, "no pings may be scheduled")
				c.Header("X-Upstream", "kept")
				c.JSON(http.StatusBadGateway, gin.H{"error": gin.H{"message": "upstream failed"}})
			})

			req := httptest.NewRequest(http.MethodPost, "/slow", strings.NewReader(tt.body))
			req.Header.Set("Content-Type", tt.contentType)
			if tt.optIn {
				req.Header.Set(ResponseKeepaliveHeader, "1")
			}
			recorder := httptest.NewRecorder()
			router.ServeHTTP(recorder, req)

			assert.Equal(t, http.StatusBadGateway, recorder.Code)
			assert.Equal(t, "kept", recorder.Header().Get("X-Upstream"))
			assert.Equal(t, keepaliveErrorBody, recorder.Body.String())
		})
	}
}

func TestResponseKeepaliveFastResponseKeepsStatusAndHeaders(t *testing.T) {
	gin.SetMode(gin.TestMode)
	router := gin.New()
	router.POST("/fast", ResponseKeepalive(time.Hour, time.Hour), func(c *gin.Context) {
		c.Header("X-Upstream", "fast")
		c.JSON(http.StatusCreated, gin.H{"ok": true})
	})

	req := httptest.NewRequest(http.MethodPost, "/fast", strings.NewReader(`{"model":"m"}`))
	req.Header.Set("Content-Type", "application/json")
	recorder := httptest.NewRecorder()
	router.ServeHTTP(recorder, req)

	assert.Equal(t, http.StatusCreated, recorder.Code)
	assert.Equal(t, "fast", recorder.Header().Get("X-Upstream"))
	assert.Equal(t, "application/json; charset=utf-8", recorder.Header().Get("Content-Type"))
	assert.Equal(t, `{"ok":true}`, recorder.Body.String())
}
