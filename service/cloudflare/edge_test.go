package cloudflare

import (
	"context"
	"encoding/json"
	"io"
	"net/http"
	"net/http/httptest"
	"testing"
	"time"

	"github.com/stretchr/testify/assert"
	"github.com/stretchr/testify/require"
)

func newTestClient(t *testing.T, handler http.Handler) *Client {
	t.Helper()
	server := httptest.NewServer(handler)
	t.Cleanup(server.Close)
	return &Client{
		token:      "test-token",
		zoneID:     "zone123",
		baseURL:    server.URL,
		httpClient: &http.Client{Timeout: 5 * time.Second},
	}
}

func writeResult(t *testing.T, w http.ResponseWriter, result any) {
	t.Helper()
	encoded, err := json.Marshal(result)
	require.NoError(t, err)
	w.Header().Set("Content-Type", "application/json")
	_, err = w.Write([]byte(`{"success":true,"errors":[],"result":` + string(encoded) + `}`))
	require.NoError(t, err)
}

// Applying a profile must never discard rules an operator wrote by hand in the
// Cloudflare dashboard, because the console replaces the whole entry point
// ruleset in a single PUT.
func TestApplyProtectionProfilePreservesOperatorRules(t *testing.T) {
	operatorRule := Rule{
		ID:          "operator-rule",
		Description: "block a specific abusive ASN",
		Expression:  "(ip.geoip.asnum eq 64512)",
		Action:      "block",
		Enabled:     true,
	}
	staleManagedRule := Rule{
		ID:          "stale",
		Description: managedRuleTag + " credential endpoint rate limit",
		Expression:  "(http.request.uri.path eq \"/api/user/login\")",
		Action:      "block",
		Enabled:     true,
	}

	submitted := map[string]ruleset{}
	handler := http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		switch {
		case r.Method == http.MethodGet && r.URL.Path == "/zones/zone123/rulesets/phases/http_ratelimit/entrypoint":
			writeResult(t, w, ruleset{ID: "rl", Rules: []Rule{operatorRule, staleManagedRule}})
		case r.Method == http.MethodGet && r.URL.Path == "/zones/zone123/rulesets/phases/http_request_firewall_custom/entrypoint":
			writeResult(t, w, ruleset{ID: "fw", Rules: []Rule{operatorRule}})
		case r.Method == http.MethodPut:
			body, err := io.ReadAll(r.Body)
			require.NoError(t, err)
			var payload ruleset
			require.NoError(t, json.Unmarshal(body, &payload))
			submitted[payload.Phase] = payload
			writeResult(t, w, payload)
		default:
			t.Fatalf("unexpected request %s %s", r.Method, r.URL.Path)
		}
	})

	client := newTestClient(t, handler)
	err := client.ApplyProtectionProfile(context.Background(), ProtectionProfile{
		RateLimitEnabled:  true,
		RateLimitRequests: 10,
		RateLimitPeriod:   60,
		ChallengeEnabled:  true,
		ChallengeHosts:    []string{"console.example.com"},
	})
	require.NoError(t, err)

	rateLimit := submitted[rateLimitPhase]
	require.Len(t, rateLimit.Rules, 2)
	assert.Equal(t, operatorRule.Description, rateLimit.Rules[0].Description)
	assert.Equal(t, "managed_challenge", rateLimit.Rules[1].Action)
	require.NotNil(t, rateLimit.Rules[1].RateLimit)
	assert.Equal(t, 10, rateLimit.Rules[1].RateLimit.RequestsPerPeriod)
	assert.Equal(t, 60, rateLimit.Rules[1].RateLimit.Period)

	firewall := submitted[firewallPhase]
	require.Len(t, firewall.Rules, 2)
	assert.Equal(t, operatorRule.Description, firewall.Rules[0].Description)
	assert.Contains(t, firewall.Rules[1].Expression, `http.host in {"console.example.com"}`)
	assert.Contains(t, firewall.Rules[1].Expression, `"/api/user/login"`)
}

// Disabling both controls must remove the generated rules while leaving the
// operator's own rules in place.
func TestApplyProtectionProfileRemovesManagedRulesWhenDisabled(t *testing.T) {
	operatorRule := Rule{Description: "operator", Expression: "(ip.src eq 1.2.3.4)", Action: "block", Enabled: true}

	submitted := map[string]ruleset{}
	handler := http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		if r.Method == http.MethodGet {
			writeResult(t, w, ruleset{Rules: []Rule{
				operatorRule,
				{Description: managedRuleTag + " challenge credential endpoints", Action: "managed_challenge", Enabled: true},
			}})
			return
		}
		body, err := io.ReadAll(r.Body)
		require.NoError(t, err)
		var payload ruleset
		require.NoError(t, json.Unmarshal(body, &payload))
		submitted[payload.Phase] = payload
		writeResult(t, w, payload)
	})

	client := newTestClient(t, handler)
	require.NoError(t, client.ApplyProtectionProfile(context.Background(), ProtectionProfile{}))

	for _, phase := range []string{rateLimitPhase, firewallPhase} {
		rules := submitted[phase].Rules
		require.Len(t, rules, 1, "phase %s", phase)
		assert.Equal(t, "operator", rules[0].Description)
	}
}

// A zone with no ruleset in a phase reports 404, which is a normal state rather
// than a failure the console should surface.
func TestListPhaseRulesTreatsMissingRulesetAsEmpty(t *testing.T) {
	client := newTestClient(t, http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		w.WriteHeader(http.StatusNotFound)
		_, _ = w.Write([]byte(`{"success":false,"errors":[{"code":1001,"message":"could not find ruleset"}],"result":null}`))
	}))

	rules, err := client.ListPhaseRules(context.Background(), rateLimitPhase)
	require.NoError(t, err)
	assert.Empty(t, rules)
}

// Cloudflare's own rejection text is what tells an administrator they hit a
// plan limit, so it must survive the round trip instead of becoming a generic
// failure message.
func TestAPIErrorSurfacesCloudflareMessage(t *testing.T) {
	client := newTestClient(t, http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		w.WriteHeader(http.StatusBadRequest)
		_, _ = w.Write([]byte(`{"success":false,"errors":[{"code":10001,"message":"exceeded rule quota for plan"}],"result":null}`))
	}))

	_, err := client.GetZone(context.Background())
	require.Error(t, err)
	assert.Contains(t, err.Error(), "exceeded rule quota for plan")
	assert.False(t, IsNotFound(err))
}

func TestProtectionProfileValidate(t *testing.T) {
	cases := []struct {
		name    string
		profile ProtectionProfile
		wantErr string
	}{
		{
			name:    "period outside the Cloudflare sliding windows",
			profile: ProtectionProfile{RateLimitEnabled: true, RateLimitRequests: 10, RateLimitPeriod: 45},
			wantErr: "rate limit period must be one of",
		},
		{
			name:    "zero requests would block every visitor",
			profile: ProtectionProfile{RateLimitEnabled: true, RateLimitRequests: 0, RateLimitPeriod: 60},
			wantErr: "rate limit requests must be between",
		},
		{
			name:    "challenge without a hostname matches nothing",
			profile: ProtectionProfile{ChallengeEnabled: true},
			wantErr: "select at least one hostname",
		},
		{
			name:    "hostname with a quote would break the rule expression",
			profile: ProtectionProfile{ChallengeEnabled: true, ChallengeHosts: []string{`a" or true or "`}},
			wantErr: "invalid hostname",
		},
		{
			name:    "valid profile",
			profile: ProtectionProfile{RateLimitEnabled: true, RateLimitRequests: 10, RateLimitPeriod: 60, ChallengeEnabled: true, ChallengeHosts: []string{"console.example.com"}},
		},
	}

	for _, testCase := range cases {
		t.Run(testCase.name, func(t *testing.T) {
			err := testCase.profile.Validate()
			if testCase.wantErr == "" {
				assert.NoError(t, err)
				return
			}
			require.Error(t, err)
			assert.Contains(t, err.Error(), testCase.wantErr)
		})
	}
}
