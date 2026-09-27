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
const validationTTL = 30 * time.Second

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
	logoutMu   sync.Mutex
	blocked    bool
	vault      vault
	http       *http.Client
	origin     string
	now        func() time.Time
	token      string
	validated  time.Time
	data       ProvisioningData
	lastError  string
	cancel     context.CancelFunc
	generation uint64
}

func New() *Client {
	return newClient(Origin, fileVault{}, nil)
}
func newClient(origin string, v vault, transport http.RoundTripper) *Client {
	return &Client{origin: origin, vault: v, now: time.Now, http: &http.Client{
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
func CachedProvisioning() (ProvisioningData, bool)          { return defaultClient.CachedProvisioning() }
func Handler(openURL func(string)) http.Handler             { return defaultClient.Handler(openURL) }
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
	// ConnectorAuth deliberately returns 404 for an invalid/revoked session.
	if resp.StatusCode == 401 || resp.StatusCode == 403 || resp.StatusCode == 404 && (path == "/api/v1/connector/provisioning" || path == "/api/v1/connector/revoke") {
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
	err := c.request(ctx, "GET", "/api/v1/connector/provisioning", token, nil, &result)
	if err != nil {
		return ProvisioningData{}, err
	}
	if !result.Success || result.Data.Account.ID <= 0 {
		return ProvisioningData{}, errors.New("invalid BoxAI provisioning")
	}
	return result.Data, nil
}
func (c *Client) requireLocked(ctx context.Context) error {
	if c.blocked {
		return ErrLoginRequired
	}
	// The CLI and GUI share auth.json. Observe sign-out and changed/deleted
	// credentials immediately, even while remote validation is cached.
	pending, err := c.vault.Get(ctx, "signout")
	if err != nil && !errors.Is(err, errMissing) {
		c.validated = time.Time{}
		c.data = ProvisioningData{}
		return ErrVaultUnavailable
	}
	if pending != "" {
		c.validated = time.Time{}
		c.data = ProvisioningData{}
		c.lastError = "Sign-out pending: retry sign-out to revoke BoxAI session"
		return ErrLoginRequired
	}
	t, err := c.vault.Get(ctx, "session")
	if err != nil && !errors.Is(err, errMissing) {
		c.validated = time.Time{}
		c.data = ProvisioningData{}
		return ErrVaultUnavailable
	}
	if t != c.token {
		c.token = t
		c.validated = time.Time{}
		c.data = ProvisioningData{}
	}
	if !validToken(c.token) {
		return ErrLoginRequired
	}
	if !c.validated.IsZero() && c.now().Sub(c.validated) < validationTTL {
		return nil
	}
	p, err := c.fetch(ctx, c.token)
	if err != nil {
		c.validated = time.Time{}
		c.data = ProvisioningData{}
		c.lastError = err.Error()
		if errors.Is(err, errRejected) {
			c.token = ""
			_ = c.vault.Delete(ctx, "session")
		}
		return err
	}
	c.data = p
	c.validated = c.now()
	c.lastError = ""
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
	c.mu.Lock()
	defer c.mu.Unlock()
	if e := c.requireLocked(ctx); e != nil {
		return ProvisioningData{}, e
	}
	return clone(c.data), nil
}
func clone(p ProvisioningData) ProvisioningData {
	b, _ := marshal(p)
	var out ProvisioningData
	_ = unmarshal(b, &out)
	return out
}
func (c *Client) authenticated() bool {
	return !c.blocked && c.token != "" && !c.validated.IsZero() && c.now().Sub(c.validated) < validationTTL
}
func (c *Client) CachedProvisioning() (ProvisioningData, bool) {
	c.mu.Lock()
	defer c.mu.Unlock()
	if !c.authenticated() {
		return ProvisioningData{}, false
	}
	return clone(c.data), true
}
func (c *Client) Session() Session {
	c.mu.Lock()
	defer c.mu.Unlock()
	s := Session{Authenticated: c.authenticated(), Pending: c.cancel != nil, Error: c.lastError}
	if s.Authenticated {
		a := c.data.Account
		s.Account = &a
	}
	return s
}
func randomValue() (string, error) {
	var b [32]byte
	if _, e := rand.Read(b[:]); e != nil {
		return "", e
	}
	return base64.RawURLEncoding.EncodeToString(b[:]), nil
}

// CachedToken is usable only after Require has validated this session.
func CachedToken() string {
	c := defaultClient
	c.mu.Lock()
	defer c.mu.Unlock()
	if !c.authenticated() {
		return ""
	}
	return c.token
}
func (c *Client) Cancel() { c.mu.Lock(); defer c.mu.Unlock(); c.cancelLocked() }
func (c *Client) cancelLocked() {
	c.generation++
	if c.cancel != nil {
		c.cancel()
		c.cancel = nil
	}
}
func (c *Client) Logout(ctx context.Context) error {
	c.logoutMu.Lock()
	defer c.logoutMu.Unlock()
	c.mu.Lock()
	c.cancelLocked()
	c.blocked = true
	// Persist the block so failed revocation can be retried after restart.
	if c.vault.Set(ctx, "signout", "pending") != nil {
		c.lastError = ErrVaultUnavailable.Error()
		c.mu.Unlock()
		return ErrVaultUnavailable
	}
	defer c.mu.Unlock()
	t := c.token
	c.token = ""
	c.validated = time.Time{}
	c.data = ProvisioningData{}
	if t == "" {
		var e error
		t, e = c.vault.Get(ctx, "session")
		if e != nil && !errors.Is(e, errMissing) {
			return ErrVaultUnavailable
		}
	}
	// Retain the file credential on failed revocation so signout can retry.
	if t != "" {
		e := c.request(ctx, "POST", "/api/v1/connector/revoke", t, nil, nil)
		if e != nil && !errors.Is(e, errRejected) {
			c.lastError = "Sign-out pending: could not revoke BoxAI session"
			return errors.New(c.lastError)
		}
	}
	if e := c.vault.Delete(ctx, "session"); e != nil && !errors.Is(e, errMissing) {
		c.lastError = ErrVaultUnavailable.Error()
		return ErrVaultUnavailable
	}
	if e := c.vault.Delete(ctx, "signout"); e != nil && !errors.Is(e, errMissing) {
		return ErrVaultUnavailable
	}
	c.blocked = false
	c.lastError = ""
	return nil
}
