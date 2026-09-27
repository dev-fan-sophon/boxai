package gateway

import (
	"context"
	"crypto/subtle"
	"errors"
	"net"
	"net/http"
	"strings"
	"sync/atomic"
)

type boxaiPolicy struct {
	require    func(context.Context) error
	credential func() string
	mcp        http.Handler
}

var boxaiAccess atomic.Pointer[boxaiPolicy]

// ConfigureBoxAI installs the mandatory account and local-client gates before
// the application starts any listeners. It cannot be changed by user config.
func ConfigureBoxAI(require func(context.Context) error, credential func() string, mcp http.Handler) {
	if require == nil || credential == nil || !boxaiAccess.CompareAndSwap(nil, &boxaiPolicy{require: require, credential: credential, mcp: mcp}) {
		panic("BoxAI gateway policy must be configured exactly once")
	}
}

// Credential is a separate local-only secret projected into Agent config.
// The BoxAI account credential is never returned here.
func Credential() string {
	if policy := boxaiAccess.Load(); policy != nil {
		return policy.credential()
	}
	return Token
}

func (p *boxaiPolicy) handler(next http.Handler) http.Handler {
	return http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		w.Header().Set("Cache-Control", "no-store")
		host, _, err := net.SplitHostPort(r.Host)
		if err != nil {
			host = r.Host
		}
		ip := net.ParseIP(host)
		if ip == nil || !ip.IsLoopback() || r.Header.Get("Origin") != "" || r.Header.Get("Sec-Fetch-Site") != "" {
			http.Error(w, "This endpoint is only available to local Agent clients", http.StatusForbidden)
			return
		}
		// A credential-free liveness probe reveals no account or model data.
		if r.Method == http.MethodGet && r.URL.Path == "/" {
			w.Header().Set("Content-Type", "application/json")
			_, _ = w.Write([]byte(`{"name":"boxai-connect","status":"running"}`))
			return
		}
		given := strings.TrimPrefix(r.Header.Get("Authorization"), "Bearer ")
		if given == "" {
			given = r.Header.Get("X-Api-Key")
		}
		if given == "" {
			given = r.Header.Get("X-Goog-Api-Key")
		}
		// Do not accept query-string secrets: URLs routinely enter logs.
		want := p.credential()
		if len(want) < 32 || subtle.ConstantTimeCompare([]byte(given), []byte(want)) != 1 {
			http.Error(w, "A valid BoxAI Connect local credential is required", http.StatusUnauthorized)
			return
		}
		if err := p.require(r.Context()); err != nil {
			http.Error(w, "Sign in to BoxAI Connect to continue", http.StatusUnauthorized)
			return
		}
		if strings.HasPrefix(r.URL.Path, "/_magpie/") || strings.HasPrefix(r.URL.Path, CodexPath+"/") {
			http.NotFound(w, r)
			return
		}
		if strings.HasPrefix(r.URL.Path, "/mcp/") && p.mcp != nil {
			p.mcp.ServeHTTP(w, r)
			return
		}
		next.ServeHTTP(w, r)
	})
}

type boxaiTransport struct{ base http.RoundTripper }

func (t boxaiTransport) RoundTrip(r *http.Request) (*http.Response, error) {
	if r.URL.Scheme != "https" || r.URL.Host != "you-box.com" || r.URL.User != nil {
		return nil, errors.New("BoxAI Connect refuses an upstream outside https://you-box.com")
	}
	return t.base.RoundTrip(r)
}
