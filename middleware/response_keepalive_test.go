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

func TestResponseKeepaliveKeepsSlowResponseOpen(t *testing.T) {
	gin.SetMode(gin.TestMode)
	proceed := make(chan struct{})
	writtenBeforeError := make(chan bool, 1)
	router := gin.New()
	router.POST("/slow", ResponseKeepalive(5*time.Millisecond), func(c *gin.Context) {
		<-proceed
		// Relay retries are skipped once Written reports true.
		writtenBeforeError <- c.Writer.Written()
		c.JSON(http.StatusBadGateway, gin.H{"error": gin.H{"message": "upstream failed"}})
	})
	server := httptest.NewServer(router)
	defer server.Close()

	req, err := http.NewRequest(http.MethodPost, server.URL+"/slow", nil)
	require.NoError(t, err)
	req.Header.Set(ResponseKeepaliveHeader, "1")
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
	assert.Equal(t, `{"error":{"message":"upstream failed"}}`, strings.TrimSpace(string(rest)))
	assert.False(t, <-writtenBeforeError)
}

func TestResponseKeepaliveRequiresOptIn(t *testing.T) {
	gin.SetMode(gin.TestMode)
	router := gin.New()
	router.POST("/slow", ResponseKeepalive(time.Millisecond), func(c *gin.Context) {
		c.JSON(http.StatusBadGateway, gin.H{"error": gin.H{"message": "upstream failed"}})
	})

	recorder := httptest.NewRecorder()
	router.ServeHTTP(recorder, httptest.NewRequest(http.MethodPost, "/slow", nil))

	assert.Equal(t, http.StatusBadGateway, recorder.Code)
	assert.Equal(t, `{"error":{"message":"upstream failed"}}`, recorder.Body.String())
}
