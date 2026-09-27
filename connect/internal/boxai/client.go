package boxai

import (
	"bytes"
	"context"
	"crypto/rand"
	"encoding/base64"
	"errors"
	"io"
	"net/http"
	"strings"
	"sync"
	"time"
)

const Origin = "https://you-box.com"

var ErrLoginRequired = errors.New("BoxAI sign-in required")
var ErrVaultUnavailable = errors.New("local auth.json credential storage unavailable")
var errMissing = errors.New("credential not found")
var errRejected = errors.New("BoxAI credential rejected")

type vault interface {
	Get(context.Context, string) (string, error)
	Set(context.Context, string, string) error
	Delete(context.Context, string) error
}

// Client serializes vault and session mutations. Network calls have bounded
// timeouts; cancelled login generations can never commit a credential.
type Client struct {
	mu         sync.Mutex
	vault      vault
	http       *http.Client
	origin     string
	token      string
	lastError  string
	loginURL   string
	cancel     context.CancelFunc
	generation uint64
}

func New() *Client {
	return newClient(Origin, fileVault{}, nil)
}
func newClient(origin string, v vault, transport http.RoundTripper) *Client {
	return &Client{origin: origin, vault: v, http: &http.Client{
		Transport: transport, Timeout: 15 * time.Second,
		CheckRedirect: func(*http.Request, []*http.Request) error { return errors.New("BoxAI redirects are forbidden") },
	}}
}

var defaultClient = New()

func Require(ctx context.Context) error         { return defaultClient.Require(ctx) }
func Token(ctx context.Context) (string, error) { return defaultClient.Token(ctx) }
func Provisioning(ctx context.Context) (ProvisioningData, error) {
	return defaultClient.Provisioning(ctx)
}
func Handler(openURL func(string), onAuthorized func()) http.Handler {
	return defaultClient.Handler(openURL, onAuthorized)
}
func Snapshot() Session                                     { return defaultClient.Session() }
func Logout(ctx context.Context) error                      { return defaultClient.Logout(ctx) }
func Cancel()                                               { defaultClient.Cancel() }
func Login(ctx context.Context, openURL func(string)) error { return defaultClient.Login(ctx, openURL) }

func (c *Client) request(ctx context.Context, method, path, token string, body any, out any) error {
	var payload []byte
	var err error
	if body != nil {
		payload, err = marshal(body)
		if err != nil {
			return err
		}
	}
	r, err := http.NewRequestWithContext(ctx, method, c.origin+path, bytes.NewReader(payload))
	if err != nil {
		return errors.New("invalid BoxAI request")
	}
	if token != "" {
		r.Header.Set("Authorization", "Bearer "+token)
	}
	if body != nil {
		r.Header.Set("Content-Type", "application/json")
	}
	resp, err := c.http.Do(r)
	if err != nil {
		return errors.New("BoxAI is unreachable")
	}
	defer resp.Body.Close()
	if resp.StatusCode == 401 || resp.StatusCode == 403 {
		return errRejected
	}
	if resp.StatusCode < 200 || resp.StatusCode >= 300 {
		return errors.New("BoxAI request failed")
	}
	if out == nil {
		return nil
	}
	b, err := io.ReadAll(io.LimitReader(resp.Body, 4*1024*1024+1))
	if err != nil || len(b) > 4*1024*1024 {
		return errors.New("invalid BoxAI response")
	}
	if unmarshal(b, out) != nil {
		return errors.New("invalid BoxAI response")
	}
	return nil
}

func validToken(s string) bool {
	return strings.HasPrefix(s, "sk-") && len(s) > 10 && len(s) < 1024 && !strings.ContainsAny(s, " \t\r\n")
}
func (c *Client) fetch(ctx context.Context, token string) (ProvisioningData, error) {
	var result struct {
		Success bool             `json:"success"`
		Data    ProvisioningData `json:"data"`
	}
	err := c.request(ctx, "GET", "/api/usage/account", token, nil, &result)
	if err != nil {
		return ProvisioningData{}, err
	}
	if !result.Success || result.Data.Account.ID <= 0 {
		return ProvisioningData{}, errors.New("invalid BoxAI account response")
	}
	return result.Data, nil
}
func (c *Client) requireLocked(ctx context.Context) error {
	// Reading the configured provider key is local. Account-service outages
	// must not interrupt the gateway or agent configuration.
	t, err := c.vault.Get(ctx, "session")
	if err != nil && !errors.Is(err, errMissing) {
		c.token = ""
		return ErrVaultUnavailable
	}
	c.token = t
	if !validToken(c.token) {
		return ErrLoginRequired
	}
	return nil
}
func (c *Client) Require(ctx context.Context) error {
	c.mu.Lock()
	defer c.mu.Unlock()
	return c.requireLocked(ctx)
}
func (c *Client) Token(ctx context.Context) (string, error) {
	c.mu.Lock()
	defer c.mu.Unlock()
	if e := c.requireLocked(ctx); e != nil {
		return "", e
	}
	return c.token, nil
}
func (c *Client) Provisioning(ctx context.Context) (ProvisioningData, error) {
	token, e := c.Token(ctx)
	if e != nil {
		return ProvisioningData{}, e
	}
	return c.fetch(ctx, token)
}
func (c *Client) Session() Session {
	c.mu.Lock()
	defer c.mu.Unlock()
	return Session{Authenticated: c.requireLocked(context.Background()) == nil, Pending: c.cancel != nil, Error: c.lastError, AuthorizationURL: c.loginURL}
}
func randomValue() (string, error) {
	var b [32]byte
	if _, e := rand.Read(b[:]); e != nil {
		return "", e
	}
	return base64.RawURLEncoding.EncodeToString(b[:]), nil
}

// CachedToken supplies the configured key to the ordinary provider without
// making a remote request. The file is shared with CLI and other app processes.
func CachedToken() string {
	token, _ := Token(context.Background())
	return token
}
func (c *Client) Cancel() { c.mu.Lock(); defer c.mu.Unlock(); c.cancelLocked() }
func (c *Client) cancelLocked() {
	c.generation++
	c.loginURL = ""
	if c.cancel != nil {
		c.cancel()
		c.cancel = nil
	}
}
func (c *Client) Logout(ctx context.Context) error {
	c.mu.Lock()
	defer c.mu.Unlock()
	c.cancelLocked()
	if e := c.vault.Delete(ctx, "session"); e != nil && !errors.Is(e, errMissing) {
		c.lastError = ErrVaultUnavailable.Error()
		return ErrVaultUnavailable
	}
	if e := c.vault.Delete(ctx, "signout"); e != nil && !errors.Is(e, errMissing) {
		return ErrVaultUnavailable
	}
	c.token = ""
	c.lastError = ""
	return nil
}
