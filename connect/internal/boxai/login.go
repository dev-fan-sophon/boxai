package boxai

import (
	"context"
	"crypto/sha256"
	"crypto/subtle"
	"encoding/base64"
	"errors"
	"net"
	"net/http"
	"net/url"
	"sync/atomic"
	"time"
)

// Login starts a bounded browser flow. ctx must outlive the initiating HTTP
// request; Handler supplies an independent three-minute lifetime.
func (c *Client) Login(ctx context.Context, openURL func(string)) error {
	if openURL == nil {
		return errors.New("browser opener unavailable")
	}
	c.mu.Lock()
	defer c.mu.Unlock()
	if c.cancel != nil {
		return errors.New("BoxAI sign-in already pending")
	}
	if err := c.requireLocked(ctx); err == nil {
		return nil
	} else if !errors.Is(err, ErrLoginRequired) && !errors.Is(err, errRejected) {
		return err
	}
	pending, err := c.vault.Get(ctx, "signout")
	if err != nil && !errors.Is(err, errMissing) {
		return ErrVaultUnavailable
	}
	if pending != "" {
		return errors.New("Sign-out pending: retry sign-out before signing in")
	}
	verifier, e := randomValue()
	if e != nil {
		return e
	}
	state, e := randomValue()
	if e != nil {
		return e
	}
	l, e := net.Listen("tcp4", "127.0.0.1:0")
	if e != nil {
		return errors.New("could not open BoxAI loopback callback")
	}
	flow, cancel := context.WithTimeout(ctx, 180*time.Second)
	c.cancel = cancel
	c.generation++
	generation := c.generation
	c.lastError = ""
	go c.login(flow, cancel, l, generation, verifier, state, openURL)
	return nil
}
func (c *Client) login(ctx context.Context, cancel context.CancelFunc, l net.Listener, generation uint64, verifier, state string, openURL func(string)) {
	defer cancel()
	defer l.Close()
	var manifest struct {
		Success bool `json:"success"`
		Data    struct {
			SchemaVersion int `json:"schema_version"`
			Platform      struct {
				ID string `json:"id"`
			} `json:"platform"`
			Authentication struct {
				Type         string `json:"type"`
				AuthorizeURL string `json:"authorize_url"`
				TokenURL     string `json:"token_url"`
			} `json:"authentication"`
			ProvisioningURL         string   `json:"provisioning_url"`
			ConnectionBearerOrigins []string `json:"connection_bearer_origins"`
			Gateway                 struct {
				BaseURL string `json:"base_url"`
			} `json:"gateway"`
		} `json:"data"`
	}
	err := c.request(ctx, "GET", "/api/v1/connector/manifest", "", nil, &manifest)
	if err == nil {
		m := manifest.Data
		if !manifest.Success || m.SchemaVersion != 2 || m.Platform.ID != "boxai" || m.Authentication.Type != "browser_pkce" || m.Authentication.AuthorizeURL != c.origin+"/api/v1/connector/authorize" || m.Authentication.TokenURL != c.origin+"/api/v1/connector/token" || m.ProvisioningURL != c.origin+"/api/v1/connector/provisioning" || m.Gateway.BaseURL != c.origin || len(m.ConnectionBearerOrigins) != 1 || m.ConnectionBearerOrigins[0] != c.origin {
			err = errors.New("untrusted BoxAI manifest")
		}
	}
	if err != nil {
		c.finish(ctx, generation, "", ProvisioningData{}, err)
		return
	}
	redirect := "http://" + l.Addr().String() + "/callback"
	result := make(chan string, 1)
	var consumed atomic.Bool
	srv := &http.Server{ReadHeaderTimeout: 2 * time.Second, ReadTimeout: 3 * time.Second, WriteTimeout: 3 * time.Second, IdleTimeout: 3 * time.Second, MaxHeaderBytes: 8192}
	srv.Handler = http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		w.Header().Set("Cache-Control", "no-store")
		w.Header().Set("Referrer-Policy", "no-referrer")
		w.Header().Set("Content-Security-Policy", "default-src 'none'")
		q, e := url.ParseQuery(r.URL.RawQuery)
		if e != nil || r.Method != "GET" || r.Host != l.Addr().String() || r.URL.EscapedPath() != "/callback" || len(r.URL.RawQuery) > 4096 || len(q["state"]) != 1 || subtle.ConstantTimeCompare([]byte(q.Get("state")), []byte(state)) != 1 || len(q["code"]) > 1 || len(q["error"]) > 1 {
			http.Error(w, "Invalid callback", 400)
			return
		}
		code := q.Get("code")
		if q.Get("error") != "" {
			code = ""
		} else if code == "" || len(code) > 512 {
			http.Error(w, "Invalid code", 400)
			return
		}
		if !consumed.CompareAndSwap(false, true) {
			http.Error(w, "Callback already used", 409)
			return
		}
		result <- code
		w.WriteHeader(200)
		_, _ = w.Write([]byte("You may close this window and return to BoxAI Connect."))
	})
	go func() { _ = srv.Serve(l) }()
	defer srv.Close()
	challenge := sha256.Sum256([]byte(verifier))
	query := url.Values{"redirect_uri": {redirect}, "state": {state}, "code_challenge": {base64.RawURLEncoding.EncodeToString(challenge[:])}, "code_challenge_method": {"S256"}, "client_name": {"BoxAI Connect"}}
	if ctx.Err() != nil {
		c.finish(ctx, generation, "", ProvisioningData{}, ctx.Err())
		return
	}
	openURL(c.origin + "/api/v1/connector/authorize?" + query.Encode())
	var code string
	select {
	case <-ctx.Done():
		c.finish(ctx, generation, "", ProvisioningData{}, errors.New("BoxAI sign-in cancelled or timed out"))
		return
	case code = <-result:
	}
	if code == "" {
		c.finish(ctx, generation, "", ProvisioningData{}, errors.New("BoxAI sign-in denied"))
		return
	}
	var response struct {
		AccessToken string `json:"access_token"`
		TokenType   string `json:"token_type"`
		BaseURL     string `json:"base_url"`
	}
	err = c.request(ctx, "POST", "/api/v1/connector/token", "", map[string]string{"code": code, "code_verifier": verifier, "redirect_uri": redirect}, &response)
	if err == nil && (!validToken(response.AccessToken) || response.TokenType != "Bearer" || response.BaseURL != c.origin+"/v1") {
		err = errors.New("invalid BoxAI token response")
	}
	var data ProvisioningData
	if err == nil {
		data, err = c.fetch(ctx, response.AccessToken)
	}
	if err == nil && ctx.Err() != nil {
		err = ctx.Err()
	}
	if !c.finish(ctx, generation, response.AccessToken, data, err) && validToken(response.AccessToken) {
		cleanup, done := context.WithTimeout(context.Background(), 15*time.Second)
		defer done()
		_ = c.request(cleanup, "POST", "/api/v1/connector/revoke", response.AccessToken, nil, nil)
	}
}
func (c *Client) finish(ctx context.Context, generation uint64, token string, data ProvisioningData, err error) bool {
	c.mu.Lock()
	defer c.mu.Unlock()
	if c.generation != generation {
		return false
	}
	c.cancel = nil
	if err == nil {
		err = ctx.Err()
	}
	if err == nil {
		ctx, cancel := context.WithTimeout(ctx, 15*time.Second)
		defer cancel()
		if c.vault.Set(ctx, "session", token) != nil {
			err = ErrVaultUnavailable
		} else if saved, e := c.vault.Get(ctx, "session"); e != nil || saved != token {
			err = ErrVaultUnavailable
		}
	}
	if err == nil {
		err = ctx.Err()
	}
	if err != nil {
		c.lastError = err.Error()
		return false
	}
	c.token = token
	c.loaded = true
	c.data = data
	c.validated = c.now()
	c.lastError = ""
	return true
}
