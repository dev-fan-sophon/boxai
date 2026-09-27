package boxai

import (
	"context"
	"mime"
	"net"
	"net/http"
	"net/url"
)

// trustedUI rejects DNS rebinding, opaque origins and cross-site mutations.
// Wails uses a native custom scheme on macOS and HTTP on Windows/Linux.
func trustedUI(r *http.Request, mutation bool) bool {
	u, e := url.Parse(r.Header.Get("Origin"))
	if r.Host == "localhost" {
		if !mutation && r.Header.Get("Origin") == "" {
			return true
		}
		// The native GUI validates a per-window CSRF token before normalizing
		// WebKit's opaque Origin to its actual Wails asset origin.
		return e == nil && u.String() == "wails://localhost"
	}
	if r.Host == "wails.localhost" {
		if !mutation && r.Header.Get("Origin") == "" {
			return true
		}
		return e == nil && (u.String() == "wails://wails.localhost" || u.String() == "http://wails.localhost")
	}
	host, _, e2 := net.SplitHostPort(r.Host)
	if e2 != nil || host != "127.0.0.1" {
		return false
	}
	if !mutation && r.Header.Get("Origin") == "" {
		return true
	}
	return e == nil && u.String() == "http://"+r.Host
}
func (c *Client) Handler(openURL func(string)) http.Handler {
	return http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		w.Header().Set("Cache-Control", "no-store")
		w.Header().Set("Content-Type", "application/json")
		mutation := r.URL.Path != "/api/boxai/session"
		if !trustedUI(r, mutation) || r.Header.Get("Sec-Fetch-Site") == "cross-site" {
			http.Error(w, "Forbidden", 403)
			return
		}
		if (!mutation && r.Method != "GET") || (mutation && r.Method != "POST") {
			http.Error(w, "Method not allowed", 405)
			return
		}
		if mutation {
			media, _, _ := mime.ParseMediaType(r.Header.Get("Content-Type"))
			if media != "application/json" {
				http.Error(w, "JSON required", 415)
				return
			}
		}
		var err error
		status := 200
		switch r.URL.Path {
		case "/api/boxai/session":
			err = c.Require(r.Context())
		case "/api/boxai/login":
			err = c.Login(context.Background(), openURL)
			status = 202
		case "/api/boxai/logout":
			err = c.Logout(r.Context())
		case "/api/boxai/cancel":
			c.Cancel()
		default:
			http.NotFound(w, r)
			return
		}
		s := c.Session()
		if err != nil && err != ErrLoginRequired {
			s.Error = err.Error()
			if mutation {
				status = 409
			}
		}
		b, _ := marshal(s)
		w.WriteHeader(status)
		_, _ = w.Write(b)
	})
}
