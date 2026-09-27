package gui

import (
	"context"
	"crypto/rand"
	"crypto/subtle"
	"mime"
	"net"
	"net/http"
	"net/url"
	"strings"
)

// ConfigureAuth must be called before Run or Handler. Without it the desktop
// fails closed. The parent owns the BoxAI session and browser authentication.
func ConfigureAuth(handler http.Handler, require func(context.Context) error) {
	authHandler, requireAuth = handler, require
}

var authHandler http.Handler
var requireAuth func(context.Context) error
var uiToken = rand.Text()

// productHandler is the product boundary, not just a navigation filter. Legacy
// provider, import, backup, profile, subscription, sync and updater routes are
// unreachable even when an authenticated caller constructs requests by hand.
func productHandler(next http.Handler) http.Handler {
	return http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		w.Header().Set("Cache-Control", "no-store")
		w.Header().Set("Cross-Origin-Resource-Policy", "same-origin")
		w.Header().Set("X-Content-Type-Options", "nosniff")
		host := r.Host
		if h, _, err := net.SplitHostPort(host); err == nil {
			host = h
		}
		ip := net.ParseIP(host)
		if host != "wails.localhost" && host != "localhost" && (ip == nil || !ip.IsLoopback()) {
			http.Error(w, "local host required", http.StatusForbidden)
			return
		}
		// In particular, do not let a cross-site script include boot.js and
		// steal its per-process UI token. Native webviews may omit metadata.
		if site := r.Header.Get("Sec-Fetch-Site"); site != "" && site != "same-origin" && site != "none" {
			http.Error(w, "same-origin request required", http.StatusForbidden)
			return
		}
		origin := r.Header.Get("Origin")
		if origin != "" && origin != "null" {
			o, err := url.Parse(origin)
			if err != nil || o.Host != r.Host || o.Host == "" || o.User != nil || o.Path != "" || o.RawQuery != "" || o.Fragment != "" || (o.Scheme != "http" && o.Scheme != "https" && o.Scheme != "wails") {
				http.Error(w, "same-origin request required", http.StatusForbidden)
				return
			}
		}
		if referrer := r.Header.Get("Referer"); referrer != "" {
			u, err := url.Parse(referrer)
			if err != nil || u.Host != r.Host {
				http.Error(w, "same-origin request required", http.StatusForbidden)
				return
			}
		}
		p := r.URL.Path
		// All mutations, including login/logout/cancel, prove they came from
		// this process's UI. A null Origin alone is never a native exemption.
		if strings.HasPrefix(p, "/api/") && r.Method != http.MethodGet {
			mediaType, _, err := mime.ParseMediaType(r.Header.Get("Content-Type"))
			if err != nil || mediaType != "application/json" || subtle.ConstantTimeCompare([]byte(r.Header.Get("X-BoxAI-UI-Token")), []byte(uiToken)) != 1 || ((origin == "" || origin == "null") && r.Host != "localhost") {
				http.Error(w, "verified UI JSON request required", http.StatusForbidden)
				return
			}
			if r.Host == "localhost" {
				// Wails on macOS/Linux uses wails://localhost, but its engine
				// can send null/absent Origin. Normalize only after proof.
				r = r.Clone(r.Context())
				r.Header.Set("Origin", "wails://localhost")
			}
		}
		if strings.HasPrefix(p, "/api/boxai/") {
			if authHandler == nil {
				http.Error(w, "BoxAI authentication unavailable", http.StatusServiceUnavailable)
				return
			}
			authHandler.ServeHTTP(w, r)
			return
		}
		if !strings.HasPrefix(p, "/api/") {
			switch p {
			case "/", "/index.html", "/boot.js", "/connect.js", "/connect.css", "/connect-i18n.js", "/boxai.png":
				next.ServeHTTP(w, r)
			default:
				http.NotFound(w, r)
			}
			return
		}
		if requireAuth == nil || requireAuth(r.Context()) != nil {
			w.Header().Set("Content-Type", "application/json")
			w.WriteHeader(http.StatusUnauthorized)
			_, _ = w.Write([]byte(`{"error":"Sign in to BoxAI"}`))
			return
		}
		allowed := false
		if r.Method == http.MethodGet {
			switch p {
			case "/api/state", "/api/models", "/api/settings", "/api/drift", "/api/library", "/api/library/market/servers", "/api/library/market/skills", "/api/diagnostics":
				allowed = true
			}
		} else if r.Method == http.MethodPost {
			switch p {
			case "/api/set", "/api/settings", "/api/settings/reveal", "/api/account", "/api/installer/check", "/api/installer/open", "/api/window/hide", "/api/window/main", "/api/window/quit", "/api/window/fit", "/api/window/tint", "/api/agents/arrange",
				"/api/library/market/server", "/api/library/market/skill":
				allowed = true
			}
			if strings.HasPrefix(p, "/api/agents/reapply/") || strings.HasPrefix(p, "/api/agents/keep/") {
				allowed = true
			}
		}
		if !allowed {
			http.NotFound(w, r)
			return
		}
		next.ServeHTTP(w, r)
	})
}
