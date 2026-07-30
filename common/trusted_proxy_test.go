package common

import (
	"net/http"
	"net/http/httptest"
	"testing"

	"github.com/gin-gonic/gin"
	"github.com/stretchr/testify/assert"
	"github.com/stretchr/testify/require"
)

func newProxyTestContext(t *testing.T, remoteAddr string, headers map[string]string) *gin.Context {
	t.Helper()
	gin.SetMode(gin.TestMode)
	c, _ := gin.CreateTestContext(httptest.NewRecorder())
	req, err := http.NewRequest(http.MethodGet, "/api/status", nil)
	require.NoError(t, err)
	req.RemoteAddr = remoteAddr
	for key, value := range headers {
		req.Header.Set(key, value)
	}
	c.Request = req
	return c
}

func resetTrustedProxyState(t *testing.T) {
	t.Helper()
	require.NoError(t, SetTrustedProxyCIDRs(""))
	SetCloudflareProxyEnabled(false)
	require.NoError(t, SetCloudflareEdgeCIDRs(nil))
}

func TestRealClientIP(t *testing.T) {
	testCases := []struct {
		name             string
		remoteAddr       string
		headers          map[string]string
		operatorCIDRs    string
		cloudflareProxy  bool
		expectedClientIP string
	}{
		{
			name:             "untrusted peer cannot forge forwarded headers",
			remoteAddr:       "203.0.113.7:51234",
			headers:          map[string]string{"X-Forwarded-For": "1.2.3.4", "X-Real-IP": "1.2.3.4"},
			expectedClientIP: "203.0.113.7",
		},
		{
			name:             "untrusted peer cannot forge cloudflare header",
			remoteAddr:       "203.0.113.7:51234",
			headers:          map[string]string{CloudflareConnectingIPHeader: "1.2.3.4"},
			cloudflareProxy:  true,
			expectedClientIP: "203.0.113.7",
		},
		{
			name:             "loopback proxy forwards the real client",
			remoteAddr:       "127.0.0.1:8080",
			headers:          map[string]string{"X-Forwarded-For": "198.51.100.23"},
			expectedClientIP: "198.51.100.23",
		},
		{
			name:             "cloudflare header ignored while proxy mode is off",
			remoteAddr:       "127.0.0.1:8080",
			headers:          map[string]string{CloudflareConnectingIPHeader: "1.2.3.4", "X-Forwarded-For": "198.51.100.23"},
			expectedClientIP: "198.51.100.23",
		},
		{
			name:             "cloudflare header wins behind a proxy fed by the edge",
			remoteAddr:       "127.0.0.1:8080",
			headers:          map[string]string{CloudflareConnectingIPHeader: "1.2.3.4", "X-Forwarded-For": "1.2.3.4, 162.158.1.1"},
			cloudflareProxy:  true,
			expectedClientIP: "1.2.3.4",
		},
		{
			// A hostname pointed straight at the origin still reaches the same
			// process. Trusting the header there would let any client pick its
			// own address for rate limiting and token allowlists.
			name:             "cloudflare header ignored when the request bypassed the edge",
			remoteAddr:       "127.0.0.1:8080",
			headers:          map[string]string{CloudflareConnectingIPHeader: "1.2.3.4", "X-Forwarded-For": "203.0.113.9"},
			cloudflareProxy:  true,
			expectedClientIP: "203.0.113.9",
		},
		{
			name:             "forged cloudflare hop cannot be appended by the client",
			remoteAddr:       "127.0.0.1:8080",
			headers:          map[string]string{CloudflareConnectingIPHeader: "1.2.3.4", "X-Forwarded-For": "162.158.1.1, 203.0.113.9"},
			cloudflareProxy:  true,
			expectedClientIP: "203.0.113.9",
		},
		{
			name:             "forwarded chain stops at the first untrusted hop",
			remoteAddr:       "127.0.0.1:8080",
			headers:          map[string]string{"X-Forwarded-For": "198.51.100.23, 10.0.0.9, 192.168.1.4"},
			expectedClientIP: "198.51.100.23",
		},
		{
			name:             "cloudflare edge is trusted only while proxy mode is on",
			remoteAddr:       "162.158.1.1:443",
			headers:          map[string]string{CloudflareConnectingIPHeader: "198.51.100.23"},
			cloudflareProxy:  true,
			expectedClientIP: "198.51.100.23",
		},
		{
			name:             "cloudflare edge is an ordinary peer while proxy mode is off",
			remoteAddr:       "162.158.1.1:443",
			headers:          map[string]string{CloudflareConnectingIPHeader: "198.51.100.23"},
			expectedClientIP: "162.158.1.1",
		},
		{
			name:             "operator supplied proxy is trusted",
			remoteAddr:       "203.0.113.7:51234",
			headers:          map[string]string{"X-Forwarded-For": "198.51.100.23"},
			operatorCIDRs:    "203.0.113.0/24",
			expectedClientIP: "198.51.100.23",
		},
		{
			name:             "malformed forwarded header falls back to the peer",
			remoteAddr:       "127.0.0.1:8080",
			headers:          map[string]string{"X-Forwarded-For": "not-an-ip"},
			expectedClientIP: "127.0.0.1",
		},
		{
			name:             "x-real-ip is used when no forwarded chain exists",
			remoteAddr:       "127.0.0.1:8080",
			headers:          map[string]string{"X-Real-IP": "198.51.100.23"},
			expectedClientIP: "198.51.100.23",
		},
	}

	for _, tc := range testCases {
		t.Run(tc.name, func(t *testing.T) {
			resetTrustedProxyState(t)
			defer resetTrustedProxyState(t)

			require.NoError(t, SetTrustedProxyCIDRs(tc.operatorCIDRs))
			SetCloudflareProxyEnabled(tc.cloudflareProxy)

			c := newProxyTestContext(t, tc.remoteAddr, tc.headers)
			assert.Equal(t, tc.expectedClientIP, RealClientIP(c))
		})
	}
}

func TestParseCIDRList(t *testing.T) {
	testCases := []struct {
		name     string
		raw      string
		expected []string
		wantErr  bool
	}{
		{name: "empty input", raw: "   ", expected: nil},
		{name: "comma separated cidrs", raw: "10.0.0.0/8, 2001:db8::/32", expected: []string{"10.0.0.0/8", "2001:db8::/32"}},
		{name: "bare addresses are widened to host masks", raw: "1.2.3.4\n2001:db8::1", expected: []string{"1.2.3.4/32", "2001:db8::1/128"}},
		{name: "rejects garbage", raw: "10.0.0.0/8, nonsense", wantErr: true},
		{name: "rejects out of range mask", raw: "10.0.0.0/64", wantErr: true},
	}

	for _, tc := range testCases {
		t.Run(tc.name, func(t *testing.T) {
			parsed, err := ParseCIDRList(tc.raw)
			if tc.wantErr {
				require.Error(t, err)
				return
			}
			require.NoError(t, err)
			assert.Equal(t, tc.expected, parsed)
		})
	}
}

func TestTrustedProxyCIDRsIncludesCloudflareOnlyWhenEnabled(t *testing.T) {
	resetTrustedProxyState(t)
	defer resetTrustedProxyState(t)

	assert.NotContains(t, TrustedProxyCIDRs(), "162.158.0.0/15")

	SetCloudflareProxyEnabled(true)
	assert.Contains(t, TrustedProxyCIDRs(), "162.158.0.0/15")

	require.NoError(t, SetCloudflareEdgeCIDRs([]string{"192.0.2.0/24"}))
	assert.Contains(t, TrustedProxyCIDRs(), "192.0.2.0/24")
	assert.NotContains(t, TrustedProxyCIDRs(), "162.158.0.0/15")
}

// The router keeps its own copy of the proxy list, so an administrator toggling
// Cloudflare mode must reach it too. Otherwise gin's ClientIP, which feeds the
// access log, keeps reporting the edge address that RealClientIP has already
// seen through.
func TestOnTrustedProxyChangeTracksEdits(t *testing.T) {
	resetTrustedProxyState(t)
	defer func() {
		OnTrustedProxyChange(nil)
		resetTrustedProxyState(t)
	}()

	var applied []string
	OnTrustedProxyChange(func(cidrs []string) { applied = cidrs })
	require.NotEmpty(t, applied, "registering an observer reports the current list")
	assert.NotContains(t, applied, "162.158.0.0/15")

	SetCloudflareProxyEnabled(true)
	assert.Contains(t, applied, "162.158.0.0/15")

	require.NoError(t, SetTrustedProxyCIDRs("203.0.113.0/24"))
	assert.Contains(t, applied, "203.0.113.0/24")

	SetCloudflareProxyEnabled(false)
	assert.NotContains(t, applied, "162.158.0.0/15")
}
