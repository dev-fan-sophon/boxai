package channel

import (
	"bytes"
	"context"
	"net/http"
	"net/http/httptest"
	"strings"
	"testing"

	basecommon "github.com/dev-fan-sophon/boxai/common"
	relaycommon "github.com/dev-fan-sophon/boxai/relay/common"
	"github.com/dev-fan-sophon/boxai/service"
	"github.com/gin-gonic/gin"
	"github.com/stretchr/testify/assert"
	"github.com/stretchr/testify/require"
)

func newCorrelationTestContext(gatewayId string) *gin.Context {
	gin.SetMode(gin.TestMode)
	c, _ := gin.CreateTestContext(httptest.NewRecorder())
	c.Request = httptest.NewRequest(http.MethodPost, "/v1/chat/completions", nil)
	if gatewayId != "" {
		c.Set(basecommon.RequestIdKey, gatewayId)
	}
	return c
}

func doCorrelationRequest(t *testing.T, c *gin.Context, url string, info *relaycommon.RelayInfo) *http.Response {
	t.Helper()
	req, err := http.NewRequest(http.MethodPost, url, bytes.NewReader([]byte(`{}`)))
	require.NoError(t, err)
	resp, err := doRequest(c, req, info)
	require.NoError(t, err)
	require.NoError(t, resp.Body.Close())
	return resp
}

func TestDoRequestCapturesUpstreamRequestIdByPreference(t *testing.T) {
	service.InitHttpClient()
	tests := []struct {
		name    string
		headers map[string]string
		want    string
	}{
		{
			name: "CPA trace wins over every fallback",
			headers: map[string]string{
				"X-CPA-Trace-Id":      "cpa-trace-1",
				"X-Oneapi-Request-Id": "oneapi-1",
				"X-Request-Id":        "xreq-1",
				"OpenAI-Request-ID":   "oai-1",
			},
			want: "cpa-trace-1",
		},
		{
			name: "existing one-api header preferred over standard headers",
			headers: map[string]string{
				"X-Oneapi-Request-Id": "oneapi-2",
				"X-Request-Id":        "xreq-2",
			},
			want: "oneapi-2",
		},
		{
			name:    "x-request-id fallback",
			headers: map[string]string{"X-Request-Id": "xreq-3", "OpenAI-Request-ID": "oai-3"},
			want:    "xreq-3",
		},
		{
			name:    "openai request id fallback",
			headers: map[string]string{"OpenAI-Request-ID": "req_abc123"},
			want:    "req_abc123",
		},
		{
			name: "unsafe or oversized values are skipped",
			headers: map[string]string{
				"X-CPA-Trace-Id":    strings.Repeat("a", maxCorrelationIdLength+1),
				"X-Request-Id":      "bad value;<script>",
				"OpenAI-Request-ID": "req_safe",
			},
			want: "req_safe",
		},
		{
			name:    "echo of gateway id is not an upstream id",
			headers: map[string]string{"X-Request-Id": "gateway-id-1"},
			want:    "",
		},
	}
	for _, tt := range tests {
		t.Run(tt.name, func(t *testing.T) {
			server := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, _ *http.Request) {
				for k, v := range tt.headers {
					w.Header().Set(k, v)
				}
				w.WriteHeader(http.StatusOK)
			}))
			defer server.Close()

			c := newCorrelationTestContext("gateway-id-1")
			doCorrelationRequest(t, c, server.URL, &relaycommon.RelayInfo{ChannelMeta: &relaycommon.ChannelMeta{}})
			assert.Equal(t, tt.want, c.GetString(basecommon.UpstreamRequestIdKey))
		})
	}
}

func TestDoRequestFreshAttemptClearsPreviousUpstreamMetadata(t *testing.T) {
	service.InitHttpClient()
	first := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, _ *http.Request) {
		w.Header().Set("X-CPA-Trace-Id", "attempt-1-trace")
		w.Header().Set("Retry-After", "7")
		w.WriteHeader(http.StatusTooManyRequests)
	}))
	defer first.Close()
	second := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, _ *http.Request) {
		w.WriteHeader(http.StatusOK)
	}))
	defer second.Close()

	c := newCorrelationTestContext("gateway-id-2")
	info := &relaycommon.RelayInfo{ChannelMeta: &relaycommon.ChannelMeta{}}

	doCorrelationRequest(t, c, first.URL, info)
	assert.Equal(t, "attempt-1-trace", c.GetString(basecommon.UpstreamRequestIdKey))
	assert.Equal(t, 7, c.GetInt(UpstreamRetryAfterKey))

	doCorrelationRequest(t, c, second.URL, info)
	_, hasUpstreamId := c.Get(basecommon.UpstreamRequestIdKey)
	assert.False(t, hasUpstreamId)
	_, hasRetryAfter := c.Get(UpstreamRetryAfterKey)
	assert.False(t, hasRetryAfter)
}

func TestDoRequestClearsPreviousUpstreamMetadataOnTransportError(t *testing.T) {
	service.InitHttpClient()
	closed := httptest.NewServer(http.HandlerFunc(func(http.ResponseWriter, *http.Request) {}))
	closedURL := closed.URL
	closed.Close()

	c := newCorrelationTestContext("gateway-id-3")
	c.Set(basecommon.UpstreamRequestIdKey, "stale-trace")
	c.Set(UpstreamRetryAfterKey, 30)

	req, err := http.NewRequest(http.MethodPost, closedURL, bytes.NewReader([]byte(`{}`)))
	require.NoError(t, err)
	_, err = doRequest(c, req, &relaycommon.RelayInfo{ChannelMeta: &relaycommon.ChannelMeta{}})
	require.Error(t, err)

	_, hasUpstreamId := c.Get(basecommon.UpstreamRequestIdKey)
	assert.False(t, hasUpstreamId)
	_, hasRetryAfter := c.Get(UpstreamRetryAfterKey)
	assert.False(t, hasRetryAfter)
}

func TestParseUpstreamRetryAfter(t *testing.T) {
	date := "Tue, 06 Oct 2026 10:00:00 GMT"
	tests := []struct {
		name       string
		retryAfter string
		date       string
		want       int
		wantOK     bool
	}{
		{name: "delta seconds", retryAfter: "120", want: 120, wantOK: true},
		{name: "zero seconds", retryAfter: "0", want: 0, wantOK: true},
		{name: "multi-day quota reset", retryAfter: "226000", want: 226000, wantOK: true},
		{name: "delta seconds clamped", retryAfter: "604801", want: MaxUpstreamRetryAfterSeconds, wantOK: true},
		{name: "delta overflow clamped", retryAfter: "99999999999999999999999", want: MaxUpstreamRetryAfterSeconds, wantOK: true},
		{name: "http date relative to response date", retryAfter: "Tue, 06 Oct 2026 10:01:30 GMT", date: date, want: 90, wantOK: true},
		{name: "rfc850 date", retryAfter: "Tuesday, 06-Oct-26 10:00:45 GMT", date: date, want: 45, wantOK: true},
		{name: "past date becomes zero", retryAfter: "Tue, 06 Oct 2026 09:00:00 GMT", date: date, want: 0, wantOK: true},
		{name: "far future date clamped", retryAfter: "Tue, 20 Oct 2026 10:00:00 GMT", date: date, want: MaxUpstreamRetryAfterSeconds, wantOK: true},
		{name: "empty", retryAfter: ""},
		{name: "negative", retryAfter: "-5"},
		{name: "fractional", retryAfter: "1.5"},
		{name: "trailing junk", retryAfter: "10s"},
		{name: "garbage date", retryAfter: "tomorrow-ish"},
	}
	for _, tt := range tests {
		t.Run(tt.name, func(t *testing.T) {
			header := http.Header{}
			if tt.retryAfter != "" {
				header.Set("Retry-After", tt.retryAfter)
			}
			if tt.date != "" {
				header.Set("Date", tt.date)
			}
			got, ok := parseUpstreamRetryAfter(header)
			assert.Equal(t, tt.wantOK, ok)
			assert.Equal(t, tt.want, got)
		})
	}
}

func TestDoRequestCapturesRetryAfterSeconds(t *testing.T) {
	service.InitHttpClient()
	server := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, _ *http.Request) {
		w.Header().Set("Retry-After", "Tue, 06 Oct 2026 10:00:05 GMT")
		w.Header().Set("Date", "Tue, 06 Oct 2026 10:00:00 GMT")
		w.WriteHeader(http.StatusServiceUnavailable)
	}))
	defer server.Close()

	c := newCorrelationTestContext("gateway-id-4")
	doCorrelationRequest(t, c, server.URL, &relaycommon.RelayInfo{ChannelMeta: &relaycommon.ChannelMeta{}})
	value, ok := c.Get(UpstreamRetryAfterKey)
	require.True(t, ok)
	assert.Equal(t, 5, value)
}

func TestDoRequestIgnoresMalformedRetryAfter(t *testing.T) {
	service.InitHttpClient()
	server := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, _ *http.Request) {
		w.Header().Set("Retry-After", "soon")
		w.WriteHeader(http.StatusTooManyRequests)
	}))
	defer server.Close()

	c := newCorrelationTestContext("gateway-id-5")
	doCorrelationRequest(t, c, server.URL, &relaycommon.RelayInfo{ChannelMeta: &relaycommon.ChannelMeta{}})
	_, ok := c.Get(UpstreamRetryAfterKey)
	assert.False(t, ok)
}

func TestDoRequestSendsGatewayRequestIdNotCallerValue(t *testing.T) {
	service.InitHttpClient()
	var received []string
	server := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		received = append(received, r.Header.Get("X-Request-Id"))
		w.WriteHeader(http.StatusOK)
	}))
	defer server.Close()

	// Header passthrough copies every caller header, including X-Request-Id.
	info := &relaycommon.RelayInfo{ChannelMeta: &relaycommon.ChannelMeta{
		HeadersOverride: map[string]any{"*": ""},
	}}
	adaptor := &replayTestTaskAdaptor{baseURL: server.URL}

	t.Run("gateway id replaces caller value", func(t *testing.T) {
		received = nil
		c := newCorrelationTestContext("gateway-id-6")
		c.Request.Header.Set("X-Request-Id", "caller-spoofed")
		resp, err := DoApiRequest(&correlationTestAdaptor{baseURL: server.URL}, c, info, bytes.NewReader([]byte(`{}`)))
		require.NoError(t, err)
		require.NoError(t, resp.Body.Close())
		assert.Equal(t, []string{"gateway-id-6"}, received)
	})

	t.Run("task adaptor requests carry gateway id", func(t *testing.T) {
		received = nil
		c := newCorrelationTestContext("gateway-id-7")
		resp, err := DoTaskApiRequest(adaptor, c, info, bytes.NewReader([]byte(`{}`)))
		require.NoError(t, err)
		require.NoError(t, resp.Body.Close())
		assert.Equal(t, []string{"gateway-id-7"}, received)
	})

	t.Run("caller value dropped without gateway id", func(t *testing.T) {
		received = nil
		c := newCorrelationTestContext("")
		c.Request.Header.Set("X-Request-Id", "caller-spoofed")
		resp, err := DoApiRequest(&correlationTestAdaptor{baseURL: server.URL}, c, info, bytes.NewReader([]byte(`{}`)))
		require.NoError(t, err)
		require.NoError(t, resp.Body.Close())
		assert.Equal(t, []string{""}, received)
	})
}

func TestDoRequestHonorsRequestContextCancellation(t *testing.T) {
	service.InitHttpClient()
	ctx, cancel := context.WithCancel(context.Background())
	defer cancel()
	release := make(chan struct{})
	server := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, request *http.Request) {
		cancel()
		<-release
	}))
	defer server.Close()
	defer close(release)

	c := newCorrelationTestContext("gateway-id-8")
	c.Request = c.Request.WithContext(ctx)
	c.Set(basecommon.UpstreamRequestIdKey, "stale-trace")
	_, err := DoApiRequest(&correlationTestAdaptor{baseURL: server.URL}, c, &relaycommon.RelayInfo{ChannelMeta: &relaycommon.ChannelMeta{}}, strings.NewReader(`{}`))
	require.Error(t, err)
	assert.ErrorIs(t, ctx.Err(), context.Canceled)
	_, hasUpstreamId := c.Get(basecommon.UpstreamRequestIdKey)
	assert.False(t, hasUpstreamId)
}

func TestResponseHeaderCopyPreservesCPATrace(t *testing.T) {
	c := newCorrelationTestContext("gateway-id")
	c.Set(basecommon.UpstreamRequestIdKey, "cpa-trace")
	assert.False(t, service.ShouldCopyUpstreamHeader(c, "X-Oneapi-Request-Id", []string{"legacy-trace"}))
	assert.Equal(t, "cpa-trace", c.GetString(basecommon.UpstreamRequestIdKey))
}

type correlationTestAdaptor struct {
	Adaptor
	baseURL string
}

func (a *correlationTestAdaptor) GetRequestURL(*relaycommon.RelayInfo) (string, error) {
	return a.baseURL, nil
}

func (a *correlationTestAdaptor) SetupRequestHeader(*gin.Context, *http.Header, *relaycommon.RelayInfo) error {
	return nil
}
