package boxai

import (
	"context"
	"crypto/sha256"
	"encoding/base64"
	"io"
	"net"
	"net/http"
	"net/http/httptest"
	"net/url"
	"os"
	"path/filepath"
	"runtime"
	"testing"
	"time"

	"github.com/stretchr/testify/assert"
	"github.com/stretchr/testify/require"
)

const testToken = "sk-test-browser-session"

func TestBrowserHandshakePersistenceAndExpiry(t *testing.T) {
	ctx := context.Background()
	status := 200
	calls := 0
	verifier := "test-verifier"
	challenge := sha256.Sum256([]byte(verifier))
	var origin, redirect string
	server := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		switch r.URL.Path {
		case "/api/v1/connector/token":
			b, err := io.ReadAll(r.Body)
			assert.NoError(t, err)
			var in map[string]string
			assert.NoError(t, unmarshal(b, &in))
			assert.Equal(t, map[string]string{"code": "approved", "code_verifier": verifier, "redirect_uri": redirect}, in)
			respond(w, 200, map[string]string{"access_token": testToken, "token_type": "Bearer", "base_url": origin + "/v1"})
		case "/api/v1/connector/provisioning":
			calls++
			assert.Equal(t, "Bearer "+testToken, r.Header.Get("Authorization"))
			respond(w, status, map[string]any{"success": true, "data": map[string]any{
				"account": Account{ID: 7, Username: "tester"}, "usage": Usage{WalletQuotaRemaining: 123456, LifetimeQuotaUsed: 567, LifetimeRequestCount: 8},
				"billing": map[string]any{"subscriptions": []any{}}, "models": []string{"not-for-ui"}, "mcp_servers": []any{},
			}})
		case "/api/v1/connector/revoke":
			respond(w, 200, map[string]bool{"success": true})
		default:
			t.Errorf("unexpected endpoint %s", r.URL.Path)
			w.WriteHeader(404)
		}
	}))
	defer server.Close()
	origin = server.URL
	v := fileVault{path: filepath.Join(t.TempDir(), "auth.json")}
	c := newClient(origin, v, nil)
	now := time.Date(2026, 1, 1, 0, 0, 0, 0, time.UTC)
	c.now = func() time.Time { return now }
	listener, err := net.Listen("tcp4", "127.0.0.1:0")
	require.NoError(t, err)
	flow, cancel := context.WithCancel(ctx)
	c.cancel, c.generation = cancel, 1
	c.login(flow, cancel, listener, 1, verifier, "expected-state", func(raw string) {
		u, err := url.Parse(raw)
		require.NoError(t, err)
		assert.Equal(t, "/api/v1/connector/authorize", u.Path)
		assert.Equal(t, base64.RawURLEncoding.EncodeToString(challenge[:]), u.Query().Get("code_challenge"))
		assert.Equal(t, "S256", u.Query().Get("code_challenge_method"))
		redirect = u.Query().Get("redirect_uri")
		bad, err := http.Get(redirect + "?state=wrong&code=approved")
		require.NoError(t, err)
		assert.Equal(t, 400, bad.StatusCode)
		bad.Body.Close()
		res, err := http.Get(redirect + "?state=expected-state&code=approved")
		require.NoError(t, err)
		assert.Equal(t, 200, res.StatusCode)
		res.Body.Close()
	})
	require.True(t, c.Session().Authenticated)
	assert.False(t, c.Session().Pending)
	saved, err := v.Get(ctx, "session")
	require.NoError(t, err)
	assert.Equal(t, testToken, saved)
	st, err := os.Stat(v.path)
	require.NoError(t, err)
	if runtime.GOOS != "windows" {
		assert.Equal(t, os.FileMode(0600), st.Mode().Perm())
	}
	restarted := newClient(origin, v, nil)
	require.NoError(t, restarted.Require(ctx))
	assert.Equal(t, 2, calls)
	require.NoError(t, c.Require(ctx))
	assert.Equal(t, 2, calls)
	now = now.Add(validationTTL)
	status = 503
	err = c.Require(ctx)
	require.Error(t, err)
	assert.Equal(t, 503, AuthStatus(err))
	saved, err = v.Get(ctx, "session")
	require.NoError(t, err)
	assert.Equal(t, testToken, saved, "transient failure must retain credential")
	status = 404 // ConnectorAuth hides invalid/revoked credentials behind 404.
	assert.Equal(t, 401, AuthStatus(c.Require(ctx)))
	_, err = v.Get(ctx, "session")
	assert.ErrorIs(t, err, errMissing)
	assert.False(t, c.Session().Authenticated)
}

func TestCancelAndDeadlineCannotPersistLogin(t *testing.T) {
	for _, expired := range []bool{false, true} {
		t.Run(map[bool]string{false: "cancel", true: "expired"}[expired], func(t *testing.T) {
			v := fileVault{path: filepath.Join(t.TempDir(), "auth.json")}
			c := newClient("http://unused.invalid", v, nil)
			ctx, cancel := context.WithCancel(context.Background())
			defer cancel()
			c.generation = 1
			c.cancel = cancel
			if expired {
				cancel()
			} else {
				c.Cancel()
			}
			assert.False(t, c.finish(ctx, 1, testToken, ProvisioningData{Account: Account{ID: 7}}, nil))
			assert.False(t, c.Session().Authenticated)
			assert.False(t, c.Session().Pending)
			_, err := v.Get(context.Background(), "session")
			assert.ErrorIs(t, err, errMissing)
		})
	}
}

func TestGuardAndAccountContract(t *testing.T) {
	v := fileVault{path: filepath.Join(t.TempDir(), "auth.json")}
	c := newClient("http://unused.invalid", v, nil)
	old := defaultClient
	defaultClient = c
	t.Cleanup(func() { defaultClient = old })
	called := false
	h := Guard(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) { called = true; w.WriteHeader(204) }))
	for _, tc := range []struct {
		method, path, host, origin, token string
		status                            int
	}{
		{"GET", "/boot.js", "localhost", "", "", 204},
		{"GET", "/boot.js", "attacker.invalid", "", "", 403},
		{"GET", "/boot.js", "localhost", "https://evil.invalid", "", 403},
		{"GET", "/api/state", "localhost", "", "", 401},
		{"POST", "/api/set", "localhost", "null", UIToken, 401},
		{"POST", "/api/boxai/cancel", "localhost", "null", "", 403},
		{"POST", "/api/boxai/cancel", "localhost", "null", UIToken, 204},
		{"POST", "/api/boxai/cancel", "wails.localhost", "http://wails.localhost", UIToken, 204},
		{"POST", "/api/boxai/cancel", "127.0.0.1:8080", "http://127.0.0.1:8080", UIToken, 204},
		{"POST", "/api/boxai/cancel", "127.0.0.1:8080", "null", UIToken, 403},
	} {
		called = false
		r := httptest.NewRequest(tc.method, "http://"+tc.host+tc.path, nil)
		r.Header.Set("Origin", tc.origin)
		r.Header.Set("X-BoxAI-UI-Token", tc.token)
		w := httptest.NewRecorder()
		h.ServeHTTP(w, r)
		assert.Equal(t, tc.status, w.Code, "%+v", tc)
		assert.Equal(t, tc.status == 204, called)
	}
	require.NoError(t, v.Set(context.Background(), "session", testToken))
	c.token, c.validated = testToken, time.Now()
	c.data = ProvisioningData{Account: Account{ID: 7}, Usage: Usage{WalletQuotaRemaining: 123456}, Billing: map[string]any{"subscriptions": []any{}}}
	w := httptest.NewRecorder()
	Guard(http.HandlerFunc(AccountHandler)).ServeHTTP(w, httptest.NewRequest("GET", "http://localhost/api/boxai/account", nil))
	assert.Equal(t, 200, w.Code)
	assert.JSONEq(t, `{"account":{"id":7,"username":"","display_name":"","email":"","group":""},"usage":{"wallet_quota_remaining":123456,"lifetime_quota_used":0,"lifetime_request_count":0},"billing":{"subscriptions":[]}}`, w.Body.String())
	assert.NotContains(t, w.Body.String(), testToken)
}

func TestBrowserCancelAndExpiredFlow(t *testing.T) {
	for _, expired := range []bool{false, true} {
		t.Run(map[bool]string{false: "cancel-in-browser", true: "expired-before-browser"}[expired], func(t *testing.T) {
			c := newClient("http://unused.invalid", fileVault{path: filepath.Join(t.TempDir(), "auth.json")}, nil)
			ctx, cancel := context.WithCancel(context.Background())
			if expired {
				cancel()
				ctx, cancel = context.WithDeadline(context.Background(), time.Unix(1, 0))
			}
			defer cancel()
			listener, err := net.Listen("tcp4", "127.0.0.1:0")
			require.NoError(t, err)
			c.cancel, c.generation = cancel, 1
			opened := false
			c.login(ctx, cancel, listener, 1, "verifier", "state", func(string) { opened = true; c.Cancel() })
			assert.Equal(t, !expired, opened)
			assert.False(t, c.Session().Pending)
			assert.False(t, c.Session().Authenticated)
			_, err = c.vault.Get(context.Background(), "session")
			assert.ErrorIs(t, err, errMissing)
		})
	}
}

func TestLogoutRemainsBlockedUntilRevocationSucceeds(t *testing.T) {
	status := 503
	s := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		assert.Equal(t, "/api/v1/connector/revoke", r.URL.Path)
		assert.Equal(t, "Bearer "+testToken, r.Header.Get("Authorization"))
		w.WriteHeader(status)
	}))
	defer s.Close()
	v := fileVault{path: filepath.Join(t.TempDir(), "auth.json")}
	ctx := context.Background()
	require.NoError(t, v.Set(ctx, "session", testToken))
	c := newClient(s.URL, v, nil)
	require.Error(t, c.Logout(ctx))
	assert.ErrorIs(t, c.Require(ctx), ErrLoginRequired)
	restarted := newClient(s.URL, v, nil)
	assert.ErrorIs(t, restarted.Require(ctx), ErrLoginRequired)
	status = 200
	require.NoError(t, restarted.Logout(ctx))
	_, err := v.Get(ctx, "session")
	assert.ErrorIs(t, err, errMissing)
	_, err = os.Stat(v.path)
	assert.True(t, os.IsNotExist(err))
}

func TestSessionHandlerDistinguishesOutageFromRevocation(t *testing.T) {
	status := http.StatusServiceUnavailable
	s := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		w.WriteHeader(status)
	}))
	defer s.Close()
	v := fileVault{path: filepath.Join(t.TempDir(), "auth.json")}
	require.NoError(t, v.Set(context.Background(), "session", testToken))
	c := newClient(s.URL, v, nil)
	h := c.Handler(nil)
	w := httptest.NewRecorder()
	h.ServeHTTP(w, httptest.NewRequest("GET", "/api/boxai/session", nil))
	assert.Equal(t, http.StatusServiceUnavailable, w.Code)
	_, err := v.Get(context.Background(), "session")
	require.NoError(t, err)
	w = httptest.NewRecorder()
	h.ServeHTTP(w, httptest.NewRequest("POST", "/api/boxai/logout", nil))
	assert.Equal(t, http.StatusConflict, w.Code)
	assert.Contains(t, w.Body.String(), "Sign-out pending:")
	status = http.StatusNotFound // Already revoked is successful local sign-out.
	w = httptest.NewRecorder()
	h.ServeHTTP(w, httptest.NewRequest("POST", "/api/boxai/logout", nil))
	assert.Equal(t, http.StatusOK, w.Code)
	_, err = v.Get(context.Background(), "session")
	assert.ErrorIs(t, err, errMissing)
}
