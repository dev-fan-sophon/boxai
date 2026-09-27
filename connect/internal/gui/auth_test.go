package gui

import (
	"context"
	"errors"
	"net/http"
	"net/http/httptest"
	"strings"
	"testing"

	"github.com/stretchr/testify/assert"
	"github.com/stretchr/testify/require"
)

func TestProductAuthenticationBoundary(t *testing.T) {
	oldHandler, oldRequire := authHandler, requireAuth
	t.Cleanup(func() { ConfigureAuth(oldHandler, oldRequire) })
	for _, authenticated := range []bool{false, true} {
		ConfigureAuth(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) { w.WriteHeader(202) }), func(context.Context) error {
			if !authenticated {
				return errors.New("signed out")
			}
			return nil
		})
		for _, path := range []string{"/api/state", "/api/models", "/api/settings", "/api/library", "/api/library/market/servers", "/api/library/market/skills", "/api/diagnostics", "/api/drift"} {
			t.Run(path+"/"+map[bool]string{true: "authenticated", false: "locked"}[authenticated], func(t *testing.T) {
				called := false
				h := productHandler(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) { called = true; w.WriteHeader(204) }))
				r := httptest.NewRequest("GET", "http://wails.localhost"+path, nil)
				w := httptest.NewRecorder()
				h.ServeHTTP(w, r)
				assert.Equal(t, authenticated, called)
				if authenticated {
					assert.Equal(t, 204, w.Code)
				} else {
					assert.Equal(t, 401, w.Code)
				}
			})
		}
		for _, path := range []string{"/api/library/market/server", "/api/library/market/skill"} {
			w := httptest.NewRecorder()
			r := httptest.NewRequest("POST", "http://wails.localhost"+path, strings.NewReader(`{"id":"official","agents":["claude"]}`))
			r.Header.Set("Origin", "http://wails.localhost")
			r.Header.Set("Content-Type", "application/json")
			r.Header.Set("X-BoxAI-UI-Token", uiToken)
			called := false
			productHandler(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
				called = true
				w.WriteHeader(204)
			})).ServeHTTP(w, r)
			assert.Equal(t, authenticated, called, "official installs still require a session")
			assert.Equal(t, map[bool]int{true: 204, false: 401}[authenticated], w.Code)
		}
		w := httptest.NewRecorder()
		r := httptest.NewRequest("POST", "http://wails.localhost/api/boxai/login", nil)
		r.Header.Set("Origin", "http://wails.localhost")
		r.Header.Set("Content-Type", "application/json")
		r.Header.Set("X-BoxAI-UI-Token", uiToken)
		productHandler(http.NotFoundHandler()).ServeHTTP(w, r)
		assert.Equal(t, 202, w.Code, "the configured auth handler owns the login policy")
	}
	ConfigureAuth(nil, nil)
	w := httptest.NewRecorder()
	productHandler(http.NotFoundHandler()).ServeHTTP(w, httptest.NewRequest("GET", "http://wails.localhost/api/settings", nil))
	assert.Equal(t, 401, w.Code, "missing integration must fail closed")
}

func TestProductRejectsLegacyRoutesAndCrossOriginWrites(t *testing.T) {
	oldHandler, oldRequire := authHandler, requireAuth
	t.Cleanup(func() { ConfigureAuth(oldHandler, oldRequire) })
	ConfigureAuth(nil, func(context.Context) error { return nil })
	for _, tc := range []struct {
		method, path, origin, content string
		status                        int
	}{
		{"POST", "/api/set", "http://wails.localhost", "application/json", 204},
		{"POST", "/api/set", "wails://wails.localhost", "application/json", 204},
		{"POST", "/api/set", "https://attacker.example", "application/json", 403},
		{"POST", "/api/set", "", "application/json", 403},
		{"POST", "/api/set", "null", "application/json", 403},
		{"POST", "/api/set", "http://wails.localhost", "text/plain", 403},
		{"POST", "/api/set", "http://wails.localhost/path", "application/json", 403},
		{"POST", "/api/set", "http://wails.localhost", "application/json-evil", 403},
		{"POST", "/api/set", "http://wails.localhost", "application/json; charset=utf-8", 204},
		{"GET", "/api/providers", "", "", 404},
		{"POST", "/api/provider/save", "http://wails.localhost", "application/json", 404},
		{"POST", "/api/import/icon", "http://wails.localhost", "application/json", 404},
		{"POST", "/api/backup/restore", "http://wails.localhost", "application/json", 404},
		{"POST", "/api/sync", "http://wails.localhost", "application/json", 404},
		{"POST", "/api/profile/use", "http://wails.localhost", "application/json", 404},
		{"POST", "/api/library/servers/import", "http://wails.localhost", "application/json", 404},
		{"POST", "/api/library/servers/save", "http://wails.localhost", "application/json", 404},
		{"POST", "/api/library/servers/agents", "http://wails.localhost", "application/json", 404},
		{"POST", "/api/library/skills/probe", "http://wails.localhost", "application/json", 404},
		{"POST", "/api/library/skills/install", "http://wails.localhost", "application/json", 404},
		{"POST", "/api/library/instructions/save", "http://wails.localhost", "application/json", 404},
		{"POST", "/api/library/market/server", "http://wails.localhost", "application/json", 204},
		{"POST", "/api/library/market/skill", "http://wails.localhost", "application/json", 204},
		{"POST", "/api/library/all/sync", "http://wails.localhost", "application/json", 404},
		{"GET", "/api/usage/quotas", "", "", 404},
		{"GET", "/api/groups", "", "", 404},
		{"GET", "/app.js", "", "", 404},
		{"GET", "/", "", "", 204},
	} {
		t.Run(tc.method+tc.path+tc.origin+tc.content, func(t *testing.T) {
			called := false
			h := productHandler(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) { called = true; w.WriteHeader(204) }))
			r := httptest.NewRequest(tc.method, "http://wails.localhost"+tc.path, strings.NewReader(`{}`))
			r.Header.Set("Origin", tc.origin)
			r.Header.Set("Content-Type", tc.content)
			r.Header.Set("X-BoxAI-UI-Token", uiToken)
			w := httptest.NewRecorder()
			h.ServeHTTP(w, r)
			require.Equal(t, tc.status, w.Code)
			assert.Equal(t, tc.status == 204, called, "rejected calls must not reach legacy handlers")
		})
	}
}

func TestNativeMutationsNeedUITokenBeforeAuthHandler(t *testing.T) {
	oldHandler, oldRequire := authHandler, requireAuth
	t.Cleanup(func() { ConfigureAuth(oldHandler, oldRequire) })
	for _, path := range []string{"/api/boxai/login", "/api/boxai/logout", "/api/boxai/cancel", "/api/set"} {
		for _, tc := range []struct {
			origin, token string
			status        int
		}{
			{"", "", 403}, {"null", "", 403}, {"null", "wrong", 403},
			{"https://attacker.example", uiToken, 403},
			{"", uiToken, 204}, {"null", uiToken, 204}, {"wails://localhost", uiToken, 204},
		} {
			t.Run(path+"/"+tc.origin+"/"+map[bool]string{true: "valid-token", false: "invalid-token"}[tc.token == uiToken], func(t *testing.T) {
				var called bool
				next := http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
					called = true
					assert.Equal(t, "wails://localhost", r.Header.Get("Origin"))
					w.WriteHeader(204)
				})
				ConfigureAuth(next, func(context.Context) error { return nil })
				r := httptest.NewRequest("POST", "wails://localhost"+path, strings.NewReader(`{}`))
				r.Header.Set("Origin", tc.origin)
				r.Header.Set("Content-Type", "application/json")
				r.Header.Set("X-BoxAI-UI-Token", tc.token)
				w := httptest.NewRecorder()
				productHandler(next).ServeHTTP(w, r)
				assert.Equal(t, tc.status, w.Code)
				assert.Equal(t, tc.status == 204, called)
				assert.Equal(t, tc.origin, r.Header.Get("Origin"), "normalization must not mutate the original request")
			})
		}
	}
}

func TestBootstrapCannotLeakAcrossOrigins(t *testing.T) {
	for _, tc := range []struct {
		host, origin, referrer, site string
		status                       int
	}{
		{"localhost", "", "", "", 204},
		{"wails.localhost", "http://wails.localhost", "", "same-origin", 204},
		{"127.0.0.1:3000", "", "", "same-origin", 204},
		{"attacker.example", "", "", "", 403},
		{"localhost", "https://attacker.example", "", "", 403},
		{"localhost", "", "https://attacker.example/page", "", 403},
		{"localhost", "", "", "cross-site", 403},
		{"localhost", "", "", "same-site", 403},
	} {
		t.Run(tc.host+tc.origin+tc.referrer+tc.site, func(t *testing.T) {
			called := false
			h := productHandler(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) { called = true; w.WriteHeader(204) }))
			r := httptest.NewRequest("GET", "http://"+tc.host+"/boot.js", nil)
			r.Header.Set("Origin", tc.origin)
			r.Header.Set("Referer", tc.referrer)
			r.Header.Set("Sec-Fetch-Site", tc.site)
			w := httptest.NewRecorder()
			h.ServeHTTP(w, r)
			assert.Equal(t, tc.status, w.Code)
			assert.Equal(t, tc.status == 204, called)
			assert.Empty(t, w.Header().Get("Access-Control-Allow-Origin"))
			assert.Equal(t, "same-origin", w.Header().Get("Cross-Origin-Resource-Policy"))
		})
	}
}
