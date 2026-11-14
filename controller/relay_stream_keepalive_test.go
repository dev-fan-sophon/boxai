package controller

import (
	"errors"
	"net/http"
	"net/http/httptest"
	"strings"
	"sync"
	"testing"
	"time"

	"github.com/dev-fan-sophon/boxai/common"
	"github.com/dev-fan-sophon/boxai/constant"
	"github.com/dev-fan-sophon/boxai/relay/helper"
	"github.com/dev-fan-sophon/boxai/service"
	"github.com/dev-fan-sophon/boxai/setting/operation_setting"
	"github.com/dev-fan-sophon/boxai/types"

	"github.com/gin-gonic/gin"
	"github.com/stretchr/testify/assert"
	"github.com/stretchr/testify/require"
)

// Once a keepalive ping committed a 200 event stream, the final error is
// reported on that stream, with the configured upstream address masked.
func TestRelayStreamErrorAfterKeepAlive(t *testing.T) {
	for _, format := range []types.RelayFormat{types.RelayFormatClaude, types.RelayFormatOpenAI} {
		t.Run(string(format), func(t *testing.T) {
			recorder := httptest.NewRecorder()
			c, _ := gin.CreateTestContext(recorder)
			c.Request = httptest.NewRequest(http.MethodPost, "/stream", nil)
			helper.SetEventStreamHeaders(c)
			require.NoError(t, helper.PingData(c))
			common.SetContextKey(c, constant.ContextKeyChannelBaseUrl, "https://provider.example")
			common.SetContextKey(c, constant.ContextKeyUpstreamRequestOrigin, "https://provider.example")
			apiError := types.NewErrorWithStatusCode(errors.New("upstream rejected input at https://provider.example/v1/messages"), types.ErrorCodeBadResponseStatusCode, http.StatusBadRequest)

			writeRelayStreamError(c, format, apiError, service.UpstreamAddresses(c))

			assert.Equal(t, http.StatusOK, recorder.Code)
			assert.Equal(t, "text/event-stream", recorder.Header().Get("Content-Type"))
			assert.Contains(t, recorder.Body.String(), "upstream rejected input")
			assert.NotContains(t, recorder.Body.String(), "provider.example")
			if format == types.RelayFormatClaude {
				assert.Contains(t, recorder.Body.String(), "event: error\n")
			} else {
				assert.Contains(t, recorder.Body.String(), "data: [DONE]")
			}
		})
	}
}

// A request that failed validation never starts the keepalive and keeps its
// JSON error status.
func TestRelayKeepAlivePreservesValidationErrors(t *testing.T) {
	settings := operation_setting.GetGeneralSetting()
	previousEnabled := settings.PingIntervalEnabled
	settings.PingIntervalEnabled = true
	t.Cleanup(func() { settings.PingIntervalEnabled = previousEnabled })
	recorder := httptest.NewRecorder()
	c, _ := gin.CreateTestContext(recorder)
	c.Request = httptest.NewRequest(http.MethodPost, "/v1/messages", strings.NewReader(`{"model":"claude-sonnet-4-20250514","stream":true}`))
	c.Request.Header.Set("Content-Type", "application/json")

	Relay(c, types.RelayFormatClaude)

	assert.Equal(t, http.StatusBadRequest, recorder.Code)
	assert.Contains(t, recorder.Header().Get("Content-Type"), "application/json")
	assert.NotContains(t, recorder.Body.String(), ": PING")
}

// signalRecorder reports each write so a test can wait for a keepalive ping.
type signalRecorder struct {
	*httptest.ResponseRecorder
	mu     sync.Mutex
	writes chan struct{}
}

func (r *signalRecorder) Write(data []byte) (int, error) {
	r.mu.Lock()
	n, err := r.ResponseRecorder.Write(data)
	r.mu.Unlock()
	select {
	case r.writes <- struct{}{}:
	default:
	}
	return n, err
}

// Keepalive pings are not relay output: a failed attempt can still move to
// another channel after the stream headers were committed by a ping.
func TestShouldRetryIgnoresKeepAlivePings(t *testing.T) {
	recorder := &signalRecorder{ResponseRecorder: httptest.NewRecorder(), writes: make(chan struct{}, 8)}
	c, _ := gin.CreateTestContext(recorder)
	c.Request = httptest.NewRequest(http.MethodPost, "/v1/messages", nil)
	stop := helper.StartStreamKeepAlive(c, time.Millisecond)
	select {
	case <-recorder.writes:
	case <-time.After(5 * time.Second):
		t.Fatal("keepalive never pinged")
	}
	stop()
	require.True(t, helper.StreamResponseCommitted(c))

	apiErr := types.NewOpenAIError(errors.New("upstream unavailable"), types.ErrorCodeBadResponseStatusCode, http.StatusBadGateway)
	assert.True(t, shouldRetry(c, apiErr, 1))
	_, err := c.Writer.WriteString("data: relayed\n\n")
	require.NoError(t, err)
	assert.False(t, shouldRetry(c, apiErr, 1), "relay output must never be retried")
}

// A stream that fails after the keepalive started but before its first ping
// still answers with its JSON status, not an event stream.
func TestRelayKeepAliveFastStreamFailureStaysJSON(t *testing.T) {
	settings := operation_setting.GetGeneralSetting()
	previousEnabled, previousInterval := settings.PingIntervalEnabled, settings.PingIntervalSeconds
	previousCount, previousMedia := constant.CountToken, constant.GetMediaToken
	settings.PingIntervalEnabled, settings.PingIntervalSeconds = true, 3600
	constant.CountToken, constant.GetMediaToken = true, true
	t.Cleanup(func() {
		settings.PingIntervalEnabled, settings.PingIntervalSeconds = previousEnabled, previousInterval
		constant.CountToken, constant.GetMediaToken = previousCount, previousMedia
	})
	recorder := httptest.NewRecorder()
	c, _ := gin.CreateTestContext(recorder)
	body := `{"model":"claude-sonnet-4-20250514","max_tokens":16,"stream":true,"messages":[{"role":"user","content":[{"type":"image","source":{"type":"base64","media_type":"image/png","data":"!"}}]}]}`
	c.Request = httptest.NewRequest(http.MethodPost, "/v1/messages", strings.NewReader(body))
	c.Request.Header.Set("Content-Type", "application/json")
	common.SetContextKey(c, constant.ContextKeyOriginalModel, "claude-sonnet-4-20250514")

	Relay(c, types.RelayFormatClaude)

	assert.GreaterOrEqual(t, recorder.Code, http.StatusBadRequest)
	assert.Contains(t, recorder.Header().Get("Content-Type"), "application/json")
	assert.NotContains(t, recorder.Body.String(), ": PING")
	var response map[string]any
	require.NoError(t, common.Unmarshal(recorder.Body.Bytes(), &response))
	assert.Equal(t, "error", response["type"])
}
