package controller

import (
	"io"
	"net/http"
	"net/http/httptest"
	"net/url"
	"strings"
	"testing"

	"github.com/dev-fan-sophon/boxai/service"
	"github.com/gin-gonic/gin"
	"github.com/stretchr/testify/assert"
	"github.com/stretchr/testify/require"
)

type mediaProxyTransport func(*http.Request) (*http.Response, error)

func (f mediaProxyTransport) RoundTrip(r *http.Request) (*http.Response, error) { return f(r) }

func TestMediaProxyStreamsWithoutCredentialsOrStorage(t *testing.T) {
	service.InitHttpClient()
	client := service.GetStrictUntrustedMediaHTTPClient()
	old := client.Transport
	t.Cleanup(func() { client.Transport = old })
	payload := "\x89PNG\r\n\x1a\n" + strings.Repeat("x", 1024)
	client.Transport = mediaProxyTransport(func(r *http.Request) (*http.Response, error) {
		assert.Empty(t, r.Header.Get("Authorization"))
		assert.Empty(t, r.Header.Get("Cookie"))
		assert.Empty(t, r.Header.Get("New-Api-User"))
		assert.Equal(t, "https://cdn.example/result.png", r.URL.String())
		return &http.Response{StatusCode: 200, Header: http.Header{"Content-Type": {"image/png"}, "Set-Cookie": {"secret=upstream"}}, Body: io.NopCloser(strings.NewReader(payload)), ContentLength: int64(len(payload))}, nil
	})
	w := httptest.NewRecorder()
	c, _ := gin.CreateTestContext(w)
	c.Set("id", 12)
	c.Request = httptest.NewRequest("GET", "/?kind=image&url="+url.QueryEscape("https://cdn.example/result.png"), nil)
	c.Request.Header.Set("Authorization", "Bearer user-secret")
	c.Request.Header.Set("Cookie", "session=private")
	GetPlaygroundMediaProxy(c)
	require.Equal(t, 200, w.Code)
	assert.Equal(t, payload, w.Body.String())
	assert.Empty(t, w.Header().Get("Set-Cookie"))
	assert.Equal(t, "private, no-store", w.Header().Get("Cache-Control"))
	// No DB or storage is initialized: ordinary downloads require neither.
}

func TestMediaProxyRejectsUnsafeSourcesAndCapacity(t *testing.T) {
	service.InitHttpClient()
	for _, tc := range []struct {
		raw          string
		user, status int
	}{
		{"https://cdn.example/a.png", 0, 401},
		{"file:///etc/passwd", 1, 400},
		{"https://user:password@cdn.example/a.png", 1, 400},
		{"http://127.0.0.1/private", 1, 502},
		{"http://169.254.169.254/latest/meta-data", 1, 502},
	} {
		w := httptest.NewRecorder()
		c, _ := gin.CreateTestContext(w)
		c.Set("id", tc.user)
		c.Request = httptest.NewRequest("GET", "/?kind=image&url="+url.QueryEscape(tc.raw), nil)
		GetPlaygroundMediaProxy(c)
		c.Writer.WriteHeaderNow()
		assert.Equal(t, tc.status, w.Code, tc.raw)
	}
	for i := 0; i < cap(mediaProxyCapacity); i++ {
		mediaProxyCapacity <- struct{}{}
	}
	defer func() {
		for len(mediaProxyCapacity) > 0 {
			<-mediaProxyCapacity
		}
	}()
	w := httptest.NewRecorder()
	c, _ := gin.CreateTestContext(w)
	c.Set("id", 1)
	c.Request = httptest.NewRequest("GET", "/?kind=image&url=https://cdn.example/a.png", nil)
	GetPlaygroundMediaProxy(c)
	c.Writer.WriteHeaderNow()
	assert.Equal(t, 503, w.Code)
	assert.Equal(t, "2", w.Header().Get("Retry-After"))
}

func TestMediaProxyRejectsNonMediaAndOversizedResponses(t *testing.T) {
	service.InitHttpClient()
	client := service.GetStrictUntrustedMediaHTTPClient()
	old := client.Transport
	t.Cleanup(func() { client.Transport = old })
	for _, tc := range []struct {
		body, mime string
		length     int64
	}{
		{"<html>not an image</html>", "image/png", 25},
		{"\x89PNG\r\n\x1a\n", "image/png", service.MaxBytesForPlaygroundKind("image") + 1},
	} {
		client.Transport = mediaProxyTransport(func(r *http.Request) (*http.Response, error) {
			return &http.Response{StatusCode: 200, Header: http.Header{"Content-Type": {tc.mime}}, Body: io.NopCloser(strings.NewReader(tc.body)), ContentLength: tc.length}, nil
		})
		w := httptest.NewRecorder()
		c, _ := gin.CreateTestContext(w)
		c.Set("id", 1)
		c.Request = httptest.NewRequest("GET", "/?kind=image&url=https://cdn.example/a.png", nil)
		GetPlaygroundMediaProxy(c)
		c.Writer.WriteHeaderNow()
		assert.Equal(t, 502, w.Code)
	}
}
