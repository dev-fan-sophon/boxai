package gateway

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

func TestBoxAIGatewayRequiresLocalCredentialAndLiveAccount(t *testing.T) {
	secret := strings.Repeat("a", 64)
	for _, tc := range []struct {
		name, host, path, header, value, origin string
		signedIn                                bool
		want                                    int
	}{
		{name: "no credential", want: 401},
		{name: "upstream placeholder", header: "Authorization", value: "Bearer magpie", signedIn: true, want: 401},
		{name: "query credentials rejected", path: "/v1/models?key=" + secret, signedIn: true, want: 401},
		{name: "signed out with valid local key", header: "Authorization", value: "Bearer " + secret, want: 401},
		{name: "authenticated", header: "Authorization", value: "Bearer " + secret, signedIn: true, want: 204},
		{name: "anthropic", header: "X-Api-Key", value: secret, signedIn: true, want: 204},
		{name: "gemini", header: "X-Goog-Api-Key", value: secret, signedIn: true, want: 204},
		{name: "dns rebinding", host: "attacker.invalid:3425", header: "Authorization", value: "Bearer " + secret, signedIn: true, want: 403},
		{name: "browser origin", origin: "https://attacker.invalid", header: "Authorization", value: "Bearer " + secret, signedIn: true, want: 403},
		{name: "subscription bridge disabled", path: "/_magpie/claude-mcp/token", header: "Authorization", value: "Bearer " + secret, signedIn: true, want: 404},
	} {
		t.Run(tc.name, func(t *testing.T) {
			p := boxaiPolicy{credential: func() string { return secret }, require: func(context.Context) error {
				if !tc.signedIn {
					return errors.New("signed out")
				}
				return nil
			}}
			nextCalled := false
			h := p.handler(http.HandlerFunc(func(w http.ResponseWriter, _ *http.Request) { nextCalled = true; w.WriteHeader(204) }))
			path := tc.path
			if path == "" {
				path = "/v1/models"
			}
			r := httptest.NewRequest(http.MethodGet, "http://127.0.0.1:3425"+path, nil)
			if tc.host != "" {
				r.Host = tc.host
			}
			if tc.header != "" {
				r.Header.Set(tc.header, tc.value)
			}
			if tc.origin != "" {
				r.Header.Set("Origin", tc.origin)
			}
			w := httptest.NewRecorder()
			h.ServeHTTP(w, r)
			assert.Equal(t, tc.want, w.Code)
			assert.Equal(t, tc.want == 204, nextCalled)
		})
	}
}

func TestBoxAIGatewayPinsLoopbackAndDoesNotExposeAccountInHealth(t *testing.T) {
	t.Setenv("MAGPIE_ADDR", "0.0.0.0:9876")
	ConfigureBoxAI(func(context.Context) error { return errors.New("signed out") }, func() string { return "" })
	t.Cleanup(func() { boxaiAccess.Store(nil) })
	assert.Equal(t, DefaultAddr, Addr())
	s := New()
	w := httptest.NewRecorder()
	s.Handler().ServeHTTP(w, httptest.NewRequest("GET", "http://127.0.0.1:3425/", nil))
	assert.Equal(t, http.StatusOK, w.Code)
	assert.JSONEq(t, `{"name":"boxai-connect","status":"running"}`, w.Body.String())
	for _, target := range []string{"http://you-box.com/v1/models", "https://you-box.com.evil.invalid/v1/models", "https://you-box.com:8443/v1/models", "https://user:pass@you-box.com/v1/models"} {
		r, err := http.NewRequest("GET", target, nil)
		require.NoError(t, err)
		_, err = s.client.Transport.RoundTrip(r)
		require.Error(t, err)
		assert.Contains(t, err.Error(), "refuses an upstream")
	}
	assert.ErrorIs(t, s.client.CheckRedirect(nil, nil), http.ErrUseLastResponse)
}
