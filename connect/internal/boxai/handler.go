package boxai

import (
	"context"
	"crypto/subtle"
	"errors"
	"net"
	"net/http"
	"strings"
	"time"
)

// UIToken belongs to this process, never to the persisted cloud session.
var UIToken = func() string {
	t, err := randomValue()
	if err != nil {
		panic(err)
	}
	return t
}()

func AuthStatus(err error) int {
	if errors.Is(err, ErrLoginRequired) || errors.Is(err, errRejected) {
		return http.StatusUnauthorized
	}
	return http.StatusServiceUnavailable
}

func respond(w http.ResponseWriter, status int, value any) {
	w.Header().Set("Content-Type", "application/json")
	w.Header().Set("Cache-Control", "no-store")
	w.WriteHeader(status)
	b, _ := marshal(value)
	_, _ = w.Write(b)
}

func WriteAuthError(w http.ResponseWriter, err error) {
	respond(w, AuthStatus(err), map[string]string{"error": err.Error()})
}

// Native WebKit may send an opaque origin. Only the process token can
// authorize such a mutation; an arbitrary website can never read boot.js.
func trustedUI(r *http.Request) bool {
	origin := r.Header.Get("Origin")
	if r.Header.Get("Sec-Fetch-Site") == "cross-site" {
		return false
	}
	switch r.Host {
	case "localhost":
		return origin == "" || origin == "null" || origin == "wails://localhost"
	case "wails.localhost":
		return origin == "" || origin == "http://wails.localhost"
	default:
		host, _, err := net.SplitHostPort(r.Host)
		return err == nil && host == "127.0.0.1" && (origin == "" || origin == "http://"+r.Host)
	}
}

func PublicSessionPath(path string) bool {
	switch path {
	case "/api/boxai/session", "/api/boxai/login", "/api/boxai/cancel", "/api/boxai/logout", "/api/boxai/verify":
		return true
	}
	return false
}

// Guard runs before any original API handler (including GET side effects).
func Guard(next http.Handler) http.Handler {
	return http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		if !trustedUI(r) {
			respond(w, 403, map[string]string{"error": "Untrusted UI origin"})
			return
		}
		if r.Method != "GET" && r.Method != "HEAD" && subtle.ConstantTimeCompare([]byte(r.Header.Get("X-BoxAI-UI-Token")), []byte(UIToken)) != 1 {
			respond(w, 403, map[string]string{"error": "Invalid UI token"})
			return
		}
		if strings.HasPrefix(r.URL.Path, "/api/") && !PublicSessionPath(r.URL.Path) {
			if err := Require(r.Context()); err != nil {
				WriteAuthError(w, err)
				return
			}
		}
		next.ServeHTTP(w, r)
	})
}

func (c *Client) Handler(openURL func(string)) http.Handler {
	return http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		var err error
		switch r.URL.Path {
		case "/api/boxai/session":
			if r.Method != "GET" {
				respond(w, 405, map[string]string{"error": "Method not allowed"})
				return
			}
			err = c.Require(r.Context())
		case "/api/boxai/login", "/api/boxai/cancel", "/api/boxai/logout", "/api/boxai/verify":
			if r.Method != "POST" {
				respond(w, 405, map[string]string{"error": "Method not allowed"})
				return
			}
			switch r.URL.Path {
			case "/api/boxai/verify":
				c.mu.Lock()
				c.validated = time.Time{}
				err = c.requireLocked(r.Context())
				c.mu.Unlock()
			case "/api/boxai/login":
				err = c.Login(context.Background(), openURL)
			case "/api/boxai/cancel":
				c.Cancel()
			case "/api/boxai/logout":
				err = c.Logout(r.Context())
			}
		default:
			respond(w, 404, map[string]string{"error": "Not found"})
			return
		}
		s := c.Session()
		status := http.StatusOK
		if err != nil && !errors.Is(err, ErrLoginRequired) {
			s.Error = err.Error()
			if r.URL.Path != "/api/boxai/session" && r.URL.Path != "/api/boxai/verify" {
				status = http.StatusConflict
			} else if !errors.Is(err, errRejected) {
				status = http.StatusServiceUnavailable
			}
		}
		respond(w, status, s)
	})
}

func AccountHandler(w http.ResponseWriter, r *http.Request) {
	p, err := Provisioning(r.Context())
	if err != nil {
		WriteAuthError(w, err)
		return
	}
	respond(w, 200, p)
}
