package boxai

import (
	"context"
	"crypto/sha256"
	"encoding/base64"
	"errors"
	"io"
	"net/http"
	"net/http/httptest"
	"net/url"
	"sync"
	"sync/atomic"
	"testing"
	"time"

	"github.com/stretchr/testify/assert"
	"github.com/stretchr/testify/require"
)

type memoryVault struct {
	mu     sync.Mutex
	values map[string]string
	fail   bool
}

func (v *memoryVault) Get(_ context.Context, k string) (string, error) {
	v.mu.Lock()
	defer v.mu.Unlock()
	if v.fail {
		return "", ErrVaultUnavailable
	}
	s, ok := v.values[k]
	if !ok {
		return "", errMissing
	}
	return s, nil
}
func (v *memoryVault) Set(_ context.Context, k, s string) error {
	v.mu.Lock()
	defer v.mu.Unlock()
	if v.fail {
		return ErrVaultUnavailable
	}
	v.values[k] = s
	return nil
}
func (v *memoryVault) Delete(_ context.Context, k string) error {
	v.mu.Lock()
	defer v.mu.Unlock()
	if v.fail {
		return ErrVaultUnavailable
	}
	delete(v.values, k)
	return nil
}
func writeJSON(w http.ResponseWriter, v any) { b, _ := marshal(v); _, _ = w.Write(b) }
func provisioningFixture() ProvisioningData {
	return ProvisioningData{SchemaVersion: 2, Account: Account{ID: 71, Username: "tester"}, Models: []Model{{ID: "chat-a", ChatCapable: true, Endpoints: []string{"openai"}}}}
}

const testToken = "sk-test-secret-0123456789"

func TestRestoreTTLAndRemoteRevocation(t *testing.T) {
	var calls atomic.Int32
	var reject atomic.Bool
	s := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		calls.Add(1)
		assert.Equal(t, "Bearer "+testToken, r.Header.Get("Authorization"))
		if reject.Load() {
			w.WriteHeader(401)
			return
		}
		writeJSON(w, map[string]any{"success": true, "data": provisioningFixture()})
	}))
	defer s.Close()
	v := &memoryVault{values: map[string]string{"session": testToken}}
	c := newClient(s.URL, v, nil)
	now := time.Now()
	c.now = func() time.Time { return now }
	assert.False(t, c.Session().Authenticated)
	require.NoError(t, c.Require(context.Background()))
	assert.EqualValues(t, 1, calls.Load())
	p, ok := c.CachedProvisioning()
	require.True(t, ok)
	p.Models[0].ID = "modified"
	p, ok = c.CachedProvisioning()
	require.True(t, ok)
	assert.Equal(t, "chat-a", p.Models[0].ID)
	var group sync.WaitGroup
	for range 12 {
		group.Go(func() {
			token, e := c.Token(context.Background())
			assert.NoError(t, e)
			assert.Equal(t, testToken, token)
		})
	}
	group.Wait()
	assert.EqualValues(t, 1, calls.Load())
	now = now.Add(validationTTL)
	reject.Store(true)
	_, ok = c.CachedProvisioning()
	assert.False(t, ok)
	_, err := c.Token(context.Background())
	require.ErrorIs(t, err, errRejected)
	assert.False(t, c.Session().Authenticated)
	_, err = v.Get(context.Background(), "session")
	assert.ErrorIs(t, err, errMissing)
	b, e := marshal(c.Session())
	require.NoError(t, e)
	assert.NotContains(t, string(b), testToken)
}
func TestLogoutFailureCannotRestoreAfterRestart(t *testing.T) {
	var fail atomic.Bool
	fail.Store(true)
	s := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		if r.URL.Path == "/api/v1/connector/revoke" {
			if fail.Load() {
				w.WriteHeader(500)
			} else {
				w.WriteHeader(204)
			}
			return
		}
		writeJSON(w, map[string]any{"success": true, "data": provisioningFixture()})
	}))
	defer s.Close()
	v := &memoryVault{values: map[string]string{"session": testToken}}
	c := newClient(s.URL, v, nil)
	require.NoError(t, c.Require(context.Background()))
	require.Error(t, c.Logout(context.Background()))
	assert.False(t, c.Session().Authenticated)
	restarted := newClient(s.URL, v, nil)
	assert.ErrorIs(t, restarted.Require(context.Background()), ErrLoginRequired)
	fail.Store(false)
	require.NoError(t, restarted.Logout(context.Background()))
	_, e := v.Get(context.Background(), "session")
	assert.ErrorIs(t, e, errMissing)
}
func TestNoRedirectBearerLeakAndUnsafeCatalog(t *testing.T) {
	var leaked atomic.Bool
	other := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) { leaked.Store(true) }))
	defer other.Close()
	s := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) { http.Redirect(w, r, other.URL, 302) }))
	defer s.Close()
	c := newClient(s.URL, &memoryVault{values: map[string]string{"session": testToken}}, nil)
	require.Error(t, c.Require(context.Background()))
	assert.False(t, leaked.Load())
	for _, raw := range []string{"https://you-box.com.evil/mcp", "https://user@you-box.com/mcp", "https://you-box.com:443/mcp", "http://you-box.com/mcp", "https://you-box.com/mcp#x"} {
		assert.False(t, New().safeURL(raw, true), raw)
	}
	assert.True(t, New().safeURL("https://you-box.com/mcp", true))
}
func TestHandlerOriginAndSecretFreeSession(t *testing.T) {
	c := newClient(Origin, &memoryVault{values: map[string]string{}}, nil)
	h := c.Handler(func(string) {})
	for _, tc := range []struct {
		host, origin, method, path, content string
		status                              int
	}{
		{"wails.localhost", "wails://wails.localhost", "POST", "cancel", "application/json", 200},
		{"wails.localhost", "http://wails.localhost", "POST", "cancel", "application/json", 200},
		{"127.0.0.1:1234", "http://127.0.0.1:1234", "POST", "cancel", "application/json", 200},
		{"127.0.0.1:1234", "http://evil.test", "POST", "cancel", "application/json", 403},
		{"evil.test:1234", "http://evil.test:1234", "POST", "cancel", "application/json", 403},
		{"wails.localhost", "", "POST", "cancel", "application/json", 403},
		{"wails.localhost", "null", "POST", "cancel", "application/json", 403},
		{"wails.localhost", "http://wails.localhost", "POST", "cancel", "text/plain", 415},
		{"wails.localhost", "", "GET", "session", "", 200},
	} {
		t.Run(tc.host+tc.origin+tc.content+tc.path, func(t *testing.T) {
			r := httptest.NewRequest(tc.method, "http://"+tc.host+"/api/boxai/"+tc.path, nil)
			r.Header.Set("Origin", tc.origin)
			r.Header.Set("Content-Type", tc.content)
			w := httptest.NewRecorder()
			h.ServeHTTP(w, r)
			assert.Equal(t, tc.status, w.Code)
			assert.NotContains(t, w.Body.String(), testToken)
		})
	}
}
func TestBrowserPKCEStateReplayAndCommit(t *testing.T) {
	var base string
	var challenge, redirect string
	var exchanges atomic.Int32
	exchanging := make(chan struct{})
	release := make(chan struct{})
	done := make(chan struct{})
	s := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		switch r.URL.Path {
		case "/api/v1/connector/manifest":
			writeJSON(w, map[string]any{"success": true, "data": map[string]any{"schema_version": 2, "platform": map[string]string{"id": "boxai"}, "authentication": map[string]string{"type": "browser_pkce", "authorize_url": base + "/api/v1/connector/authorize", "token_url": base + "/api/v1/connector/token"}, "gateway": map[string]string{"base_url": base}, "provisioning_url": base + "/api/v1/connector/provisioning", "connection_bearer_origins": []string{base}}})
		case "/api/v1/connector/token":
			exchanges.Add(1)
			b, _ := io.ReadAll(r.Body)
			var body map[string]string
			assert.NoError(t, unmarshal(b, &body))
			sum := sha256.Sum256([]byte(body["code_verifier"]))
			assert.Equal(t, challenge, base64.RawURLEncoding.EncodeToString(sum[:]))
			assert.Equal(t, redirect, body["redirect_uri"])
			assert.Equal(t, "one-time-code", body["code"])
			close(exchanging)
			<-release
			writeJSON(w, map[string]string{"access_token": testToken, "token_type": "Bearer", "base_url": base + "/v1"})
		case "/api/v1/connector/provisioning":
			writeJSON(w, map[string]any{"success": true, "data": provisioningFixture()})
			close(done)
		default:
			w.WriteHeader(404)
		}
	}))
	defer s.Close()
	base = s.URL
	v := &memoryVault{values: map[string]string{}}
	c := newClient(base, v, nil)
	defer c.Cancel()
	opened := make(chan string, 1)
	require.NoError(t, c.Login(context.Background(), func(raw string) { opened <- raw }))
	var raw string
	select {
	case raw = <-opened:
	case <-time.After(3 * time.Second):
		t.Fatal("browser not opened")
	}
	u, e := url.Parse(raw)
	require.NoError(t, e)
	q := u.Query()
	challenge = q.Get("code_challenge")
	redirect = q.Get("redirect_uri")
	assert.Len(t, q.Get("state"), 43)
	bad, e := http.Get(redirect + "?state=wrong&code=one-time-code")
	require.NoError(t, e)
	assert.Equal(t, 400, bad.StatusCode)
	bad.Body.Close()
	callback := redirect + "?state=" + q.Get("state") + "&code=one-time-code"
	resp, e := http.Get(callback)
	require.NoError(t, e)
	assert.Equal(t, 200, resp.StatusCode)
	resp.Body.Close()
	select {
	case <-exchanging:
	case <-time.After(3 * time.Second):
		t.Fatal("exchange not started")
	}
	replay, e := http.Get(callback)
	require.NoError(t, e)
	assert.Equal(t, 409, replay.StatusCode)
	replay.Body.Close()
	close(release)
	select {
	case <-done:
	case <-time.After(3 * time.Second):
		t.Fatal("provisioning not requested")
	}
	require.Eventually(t, func() bool { return c.Session().Authenticated }, 3*time.Second, time.Millisecond)
	assert.EqualValues(t, 1, exchanges.Load())
	stored, e := v.Get(context.Background(), "session")
	require.NoError(t, e)
	assert.Equal(t, testToken, stored)
	local, e := c.LocalGatewayToken()
	require.NoError(t, e)
	assert.Len(t, local, 43)
	assert.NotEqual(t, testToken, local)
	local2, e := c.LocalGatewayToken()
	require.NoError(t, e)
	assert.Equal(t, local, local2)
}
func TestVaultFailureCannotAuthenticate(t *testing.T) {
	v := &memoryVault{values: map[string]string{}}
	c := newClient(Origin, v, nil)
	v.fail = true
	assert.False(t, c.finish(context.Background(), c.generation, testToken, provisioningFixture(), nil))
	assert.False(t, c.Session().Authenticated)
	assert.Equal(t, ErrVaultUnavailable.Error(), c.Session().Error)
	_, e := c.LocalGatewayToken()
	assert.ErrorIs(t, e, ErrVaultUnavailable)
}

func TestLogoutHookRunsAfterOriginCheckAndBeforeCredentialMutation(t *testing.T) {
	var revoked atomic.Bool
	s := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		if r.URL.Path == "/api/v1/connector/revoke" {
			revoked.Store(true)
			w.WriteHeader(204)
			return
		}
		writeJSON(w, map[string]any{"success": true, "data": provisioningFixture()})
	}))
	defer s.Close()
	v := &memoryVault{values: map[string]string{"session": testToken}}
	c := newClient(s.URL, v, nil)
	require.NoError(t, c.Require(context.Background()))
	var calls int
	fail := true
	c.SetBeforeLogout(func(ctx context.Context) error {
		calls++
		assert.False(t, c.Session().Authenticated)
		assert.ErrorIs(t, c.Require(ctx), ErrLoginRequired)
		stored, e := v.Get(ctx, "session")
		assert.NoError(t, e)
		assert.Equal(t, testToken, stored)
		_, e = v.Get(ctx, "signout")
		assert.ErrorIs(t, e, errMissing)
		assert.False(t, revoked.Load())
		if fail {
			return errors.New("private restore failure")
		}
		return nil
	})
	h := c.Handler(nil)
	r := httptest.NewRequest("POST", "http://wails.localhost/api/boxai/logout", nil)
	r.Header.Set("Origin", "https://evil.example")
	r.Header.Set("Content-Type", "application/json")
	w := httptest.NewRecorder()
	h.ServeHTTP(w, r)
	assert.Equal(t, 403, w.Code)
	assert.Zero(t, calls)
	r.Header.Set("Origin", "http://wails.localhost")
	w = httptest.NewRecorder()
	h.ServeHTTP(w, r)
	assert.Equal(t, 409, w.Code)
	assert.Equal(t, 1, calls)
	assert.NotContains(t, w.Body.String(), "private restore failure")
	assert.Error(t, c.Login(context.Background(), func(string) {}))
	_, ok := c.CachedProvisioning()
	assert.False(t, ok)
	fail = false
	require.NoError(t, c.Logout(context.Background()))
	assert.Equal(t, 2, calls)
	assert.True(t, revoked.Load())
	_, e := v.Get(context.Background(), "session")
	assert.ErrorIs(t, e, errMissing)
}

func TestCancelStopsLoopbackAndNeverStoresToken(t *testing.T) {
	var base string
	s := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		assert.Equal(t, "/api/v1/connector/manifest", r.URL.Path)
		writeJSON(w, map[string]any{"success": true, "data": map[string]any{"schema_version": 2, "platform": map[string]string{"id": "boxai"}, "authentication": map[string]string{"type": "browser_pkce", "authorize_url": base + "/api/v1/connector/authorize", "token_url": base + "/api/v1/connector/token"}, "gateway": map[string]string{"base_url": base}, "provisioning_url": base + "/api/v1/connector/provisioning", "connection_bearer_origins": []string{base}}})
	}))
	defer s.Close()
	base = s.URL
	v := &memoryVault{values: map[string]string{}}
	c := newClient(base, v, nil)
	opened := make(chan string, 1)
	require.NoError(t, c.Login(context.Background(), func(s string) { opened <- s }))
	var raw string
	select {
	case raw = <-opened:
	case <-time.After(3 * time.Second):
		t.Fatal("browser not opened")
	}
	u, e := url.Parse(raw)
	require.NoError(t, e)
	c.Cancel()
	assert.False(t, c.Session().Pending)
	callback := u.Query().Get("redirect_uri") + "?state=" + u.Query().Get("state") + "&code=late-code"
	h := &http.Client{Timeout: time.Second}
	require.Eventually(t, func() bool {
		r, e := h.Get(callback)
		if e != nil {
			return true
		}
		r.Body.Close()
		return false
	}, 3*time.Second, time.Millisecond)
	assert.False(t, c.Session().Authenticated)
	_, e = v.Get(context.Background(), "session")
	assert.ErrorIs(t, e, errMissing)
}
