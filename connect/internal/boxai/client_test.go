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

func TestBrowserHandshakeConfiguresKeyWithoutAccountRequests(t *testing.T) {
	ctx := context.Background()
	calls := 0
	verifier := "test-verifier"
	challenge := sha256.Sum256([]byte(verifier))
	var origin, redirect string
	server := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		switch r.URL.Path {
		case "/api/connect/token":
			calls++
			b, err := io.ReadAll(r.Body)
			assert.NoError(t, err)
			var in map[string]string
			assert.NoError(t, unmarshal(b, &in))
			assert.Equal(t, map[string]string{"code": "approved", "code_verifier": verifier, "redirect_uri": redirect}, in)
			respond(w, 200, map[string]string{"access_token": testToken, "token_type": "Bearer", "base_url": origin + "/v1"})
		default:
			t.Errorf("unexpected endpoint %s", r.URL.Path)
			w.WriteHeader(404)
		}
	}))
	defer server.Close()
	origin = server.URL
	v := fileVault{path: filepath.Join(t.TempDir(), "auth.json")}
	c := newClient(origin, v, nil)
	listener, err := net.Listen("tcp4", "127.0.0.1:0")
	require.NoError(t, err)
	flow, cancel := context.WithCancel(ctx)
	c.cancel, c.generation = cancel, 1
	c.login(flow, cancel, listener, 1, verifier, "expected-state", func(raw string) {
		u, err := url.Parse(raw)
		require.NoError(t, err)
		assert.Equal(t, "/api/connect/authorize", u.Path)
		assert.Equal(t, base64.RawURLEncoding.EncodeToString(challenge[:]), u.Query().Get("code_challenge"))
		assert.Equal(t, "S256", u.Query().Get("code_challenge_method"))
		assert.Equal(t, raw, c.Session().AuthorizationURL)
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
	assert.Empty(t, c.Session().AuthorizationURL)
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
	require.NoError(t, c.Require(ctx))
	assert.Equal(t, 1, calls, "restart and normal use never fetch account metadata")
	require.NoError(t, restarted.Logout(ctx))
	assert.Equal(t, 1, calls, "logout needs no cloud request")
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
			assert.False(t, c.finish(ctx, 1, testToken, nil))
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
	s := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		assert.Equal(t, "/api/usage/account", r.URL.Path)
		assert.Equal(t, "Bearer "+testToken, r.Header.Get("Authorization"))
		respond(w, 200, map[string]any{"success": true, "data": ProvisioningData{Account: Account{ID: 7}, Usage: Usage{WalletQuotaRemaining: 123456}, Billing: map[string]any{"subscriptions": []any{}}}})
	}))
	defer s.Close()
	c.origin = s.URL
	w := httptest.NewRecorder()
	Guard(http.HandlerFunc(AccountHandler)).ServeHTTP(w, httptest.NewRequest("GET", "http://localhost/api/boxai/account", nil))
	assert.Equal(t, 200, w.Code)
	assert.JSONEq(t, `{"account":{"id":7,"username":"","display_name":"","email":"","group":""},"usage":{"wallet_quota_remaining":123456,"lifetime_quota_used":0,"lifetime_request_count":0},"billing":{"subscriptions":[]}}`, w.Body.String())
	assert.NotContains(t, w.Body.String(), testToken)
}

func TestBrowserGuardRequiresSameOriginAndProcessToken(t *testing.T) {
	h := GuardBrowser(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) { w.WriteHeader(204) }))
	for _, tc := range []struct {
		origin, token, site string
		status              int
	}{
		{"http://192.168.1.20:8080", UIToken, "same-origin", 204},
		{"http://192.168.1.20:8080", "", "same-origin", 403},
		{"http://evil.invalid", UIToken, "", 403},
		{"null", UIToken, "", 403},
		{"", UIToken, "cross-site", 403},
	} {
		r := httptest.NewRequest("POST", "http://192.168.1.20:8080/api/boxai/cancel", nil)
		r.Header.Set("Origin", tc.origin)
		r.Header.Set("X-BoxAI-UI-Token", tc.token)
		r.Header.Set("Sec-Fetch-Site", tc.site)
		w := httptest.NewRecorder()
		h.ServeHTTP(w, r)
		assert.Equal(t, tc.status, w.Code, "%+v", tc)
	}
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

func TestOfflineLogoutClearsKeyAndLegacyMarker(t *testing.T) {
	s := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		t.Error("logout must not contact the server")
		w.WriteHeader(503)
	}))
	defer s.Close()
	v := fileVault{path: filepath.Join(t.TempDir(), "auth.json")}
	ctx := context.Background()
	require.NoError(t, v.Set(ctx, "session", testToken))
	require.NoError(t, v.Set(ctx, "signout", "pending"))
	c := newClient(s.URL, v, nil)
	require.NoError(t, c.Logout(ctx))
	assert.ErrorIs(t, c.Require(ctx), ErrLoginRequired)
	restarted := newClient(s.URL, v, nil)
	assert.ErrorIs(t, restarted.Require(ctx), ErrLoginRequired)
	require.NoError(t, restarted.Logout(ctx))
	_, err := v.Get(ctx, "session")
	assert.ErrorIs(t, err, errMissing)
	_, err = os.Stat(v.path)
	assert.True(t, os.IsNotExist(err))
}

func TestPageFailuresDoNotInvalidateConfiguredProvider(t *testing.T) {
	ctx := context.Background()
	calls, remoteStatus := 0, http.StatusOK
	s := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		calls++
		assert.Equal(t, "/api/usage/account", r.URL.Path)
		respond(w, remoteStatus, map[string]any{"success": true, "data": ProvisioningData{Account: Account{ID: 42}}})
	}))
	defer s.Close()
	v := fileVault{path: filepath.Join(t.TempDir(), "auth.json")}
	require.NoError(t, v.Set(ctx, "session", testToken))
	c := newClient(s.URL, v, nil)
	require.NoError(t, c.Require(ctx))
	require.NoError(t, c.Require(ctx))
	assert.Equal(t, 0, calls)
	for _, code := range []int{200, 503, 200, 401} {
		remoteStatus = code
		data, err := c.Provisioning(ctx)
		if code != 200 {
			require.Error(t, err)
		} else {
			require.NoError(t, err)
			assert.Equal(t, 42, data.Account.ID)
		}
		assert.True(t, c.Session().Authenticated)
		token, err := c.Token(ctx)
		require.NoError(t, err)
		assert.Equal(t, testToken, token)
	}
	assert.Equal(t, 4, calls)
}

func TestSessionHandlerDoesNotRequireRemoteService(t *testing.T) {
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
	assert.Equal(t, http.StatusOK, w.Code)
	_, err := v.Get(context.Background(), "session")
	require.NoError(t, err)
	w = httptest.NewRecorder()
	h.ServeHTTP(w, httptest.NewRequest("POST", "/api/boxai/logout", nil))
	assert.Equal(t, http.StatusOK, w.Code)
	status = http.StatusNotFound
	w = httptest.NewRecorder()
	h.ServeHTTP(w, httptest.NewRequest("POST", "/api/boxai/logout", nil))
	assert.Equal(t, http.StatusOK, w.Code)
	_, err = v.Get(context.Background(), "session")
	assert.ErrorIs(t, err, errMissing)
}
