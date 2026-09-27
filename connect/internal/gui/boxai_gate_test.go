package gui

import (
	"io"
	"net/http"
	"net/http/httptest"
	"os"
	"os/exec"
	"path/filepath"
	"strings"
	"testing"

	"github.com/stretchr/testify/assert"
	"github.com/stretchr/testify/require"
	"github.com/yetone/magpie/internal/boxai"
	"github.com/yetone/magpie/internal/provider"
)

type accountTransport func(*http.Request) (*http.Response, error)

func (f accountTransport) RoundTrip(r *http.Request) (*http.Response, error) { return f(r) }

func TestBoxAIAPIGate(t *testing.T) {
	if os.Getenv("BOXAI_UI_GATE_TEST") != "1" {
		cmd := exec.Command(os.Args[0], "-test.run=^TestBoxAIAPIGate$")
		cmd.Env = append(os.Environ(), "BOXAI_UI_GATE_TEST=1")
		out, err := cmd.CombinedOutput()
		require.NoError(t, err, string(out))
		return
	}
	t.Setenv("XDG_CONFIG_HOME", t.TempDir())
	provider.UseBoxAI()
	h := Handler(nil, nil)
	for _, tc := range []struct {
		method, path, token string
		status              int
	}{
		{"GET", "/boot.js", "", 200},
		{"GET", "/api/boxai/session", "", 200},
		{"GET", "/api/state", "", 401},
		{"GET", "/api/usage?period=7d", "", 401},
		{"GET", "/api/boxai/account", "", 401},
		{"POST", "/api/set", boxai.UIToken, 401},
		{"POST", "/api/window/quit", boxai.UIToken, 401},
		{"POST", "/api/boxai/cancel", "", 403},
		{"POST", "/api/boxai/cancel", boxai.UIToken, 200},
	} {
		r := httptest.NewRequest(tc.method, "http://localhost"+tc.path, nil)
		r.Header.Set("X-BoxAI-UI-Token", tc.token)
		w := httptest.NewRecorder()
		h.ServeHTTP(w, r)
		assert.Equal(t, tc.status, w.Code, tc.path)
		if tc.path == "/boot.js" {
			assert.Contains(t, w.Body.String(), `"uiToken":"`+boxai.UIToken+`"`)
		}
	}
	require.NoError(t, os.WriteFile(filepath.Join(filepath.Dir(provider.Path()), "auth.json"), []byte(`{"session":"sk-ui-test-session"}`), 0600))
	transport := http.DefaultTransport
	http.DefaultTransport = accountTransport(func(r *http.Request) (*http.Response, error) {
		assert.Equal(t, "/api/usage/account", r.URL.Path)
		return &http.Response{StatusCode: 200, Header: make(http.Header), Body: io.NopCloser(strings.NewReader(`{"success":true,"data":{"account":{"id":9},"usage":{"wallet_quota_remaining":765432,"lifetime_quota_used":123,"lifetime_request_count":4},"billing":{"subscriptions":[]},"models":["hidden"],"agents":{"hidden":true}}}`))}, nil
	})
	t.Cleanup(func() { http.DefaultTransport = transport })
	var account string
	for _, path := range []string{"/api/boxai/account", "/api/usage?period=today", "/api/usage?period=all"} {
		w := httptest.NewRecorder()
		h.ServeHTTP(w, httptest.NewRequest("GET", "http://localhost"+path, nil))
		require.Equal(t, 200, w.Code)
		if account == "" {
			account = w.Body.String()
		}
		assert.JSONEq(t, account, w.Body.String())
		assert.Contains(t, w.Body.String(), `"wallet_quota_remaining":765432`)
		assert.NotContains(t, w.Body.String(), "hidden")
		assert.NotContains(t, w.Body.String(), "sk-ui-test-session")
	}
}
