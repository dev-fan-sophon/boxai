/*
Copyright (C) 2023-2026 QuantumNous

This program is free software: you can redistribute it and/or modify
it under the terms of the GNU Affero General Public License as
published by the Free Software Foundation, either version 3 of the
License, or (at your option) any later version.

This program is distributed in the hope that it will be useful,
but WITHOUT ANY WARRANTY; without even the implied warranty of
MERCHANTABILITY or FITNESS FOR A PARTICULAR PURPOSE. See the
GNU Affero General Public License for more details.

You should have received a copy of the GNU Affero General Public License
along with this program. If not, see <https://www.gnu.org/licenses/>.

For commercial licensing, please contact support@quantumnous.com
*/
package cloudflare

import (
	"context"
	"encoding/json"
	"fmt"
	"net/http"
	"sort"
	"strings"

	"github.com/pkg/errors"
)

// managedRuleTag prefixes every rule this console writes. Rules created by hand
// in the Cloudflare dashboard are read but never modified or deleted, so an
// operator can keep their own rules alongside the generated ones.
const managedRuleTag = "boxai:"

const (
	rateLimitPhase = "http_ratelimit"
	firewallPhase  = "http_request_firewall_custom"
)

// credentialEndpoints are the anonymous authentication routes worth protecting
// at the edge. They mirror the routes guarded by middleware.CriticalRateLimit,
// restricted to the ones an attacker can reach without a session.
var credentialEndpoints = []string{
	"/api/user/login",
	"/api/user/login/2fa",
	"/api/user/register",
	"/api/user/reset",
	"/api/user/passkey/login/begin",
	"/api/user/passkey/login/finish",
	"/api/reset_password",
	"/api/verification",
}

// ratePeriods are the sliding windows Cloudflare accepts for a rate limit rule.
var ratePeriods = []int{10, 60, 120, 300, 600, 3600}

type Zone struct {
	Name string `json:"name"`
	Plan struct {
		Name string `json:"name"`
	} `json:"plan"`
}

type DNSRecord struct {
	ID        string `json:"id"`
	Type      string `json:"type"`
	Name      string `json:"name"`
	Proxied   bool   `json:"proxied"`
	Proxiable bool   `json:"proxiable"`
}

type ZoneSetting struct {
	ID       string          `json:"id"`
	Value    json.RawMessage `json:"value"`
	Editable bool            `json:"editable"`
}

type BotSettings struct {
	FightMode         bool   `json:"fight_mode"`
	AIBotsProtection  string `json:"ai_bots_protection"`
	CrawlerProtection string `json:"crawler_protection"`
}

type RuleRateLimit struct {
	Characteristics   []string `json:"characteristics"`
	Period            int      `json:"period"`
	RequestsPerPeriod int      `json:"requests_per_period"`
	MitigationTimeout int      `json:"mitigation_timeout"`
}

type Rule struct {
	ID          string         `json:"id,omitempty"`
	Description string         `json:"description"`
	Expression  string         `json:"expression"`
	Action      string         `json:"action"`
	Enabled     bool           `json:"enabled"`
	RateLimit   *RuleRateLimit `json:"ratelimit,omitempty"`
}

func (r Rule) Managed() bool {
	return strings.HasPrefix(r.Description, managedRuleTag)
}

type ruleset struct {
	ID    string `json:"id,omitempty"`
	Name  string `json:"name,omitempty"`
	Phase string `json:"phase,omitempty"`
	Rules []Rule `json:"rules"`
}

// ProtectionProfile is the declarative edge policy an administrator manages from
// the console. It is translated into one rate limit rule and one firewall rule.
type ProtectionProfile struct {
	RateLimitEnabled  bool     `json:"rate_limit_enabled"`
	RateLimitRequests int      `json:"rate_limit_requests"`
	RateLimitPeriod   int      `json:"rate_limit_period"`
	ChallengeEnabled  bool     `json:"challenge_enabled"`
	ChallengeHosts    []string `json:"challenge_hosts"`
}

func (p ProtectionProfile) Validate() error {
	if p.RateLimitEnabled {
		if p.RateLimitRequests < 1 || p.RateLimitRequests > 1000000 {
			return errors.New("rate limit requests must be between 1 and 1000000")
		}
		if !containsInt(ratePeriods, p.RateLimitPeriod) {
			return fmt.Errorf("rate limit period must be one of %v seconds", ratePeriods)
		}
	}
	if p.ChallengeEnabled && len(p.ChallengeHosts) == 0 {
		return errors.New("select at least one hostname to challenge")
	}
	for _, host := range p.ChallengeHosts {
		if strings.ContainsAny(host, "\"\\ ") || strings.TrimSpace(host) == "" {
			return fmt.Errorf("invalid hostname: %q", host)
		}
	}
	return nil
}

func (c *Client) GetZone(ctx context.Context) (*Zone, error) {
	var zone Zone
	if err := c.request(ctx, http.MethodGet, c.zonePath(""), nil, &zone); err != nil {
		return nil, err
	}
	return &zone, nil
}

func (c *Client) ListDNSRecords(ctx context.Context) ([]DNSRecord, error) {
	var records []DNSRecord
	if err := c.request(ctx, http.MethodGet, c.zonePath("/dns_records?per_page=200"), nil, &records); err != nil {
		return nil, err
	}
	// Only address records can sit behind the proxy; hiding the rest keeps the
	// console free of MX and TXT rows an operator can never toggle.
	proxiable := records[:0]
	for _, record := range records {
		if record.Proxiable {
			proxiable = append(proxiable, record)
		}
	}
	sort.Slice(proxiable, func(i, j int) bool { return proxiable[i].Name < proxiable[j].Name })
	return proxiable, nil
}

func (c *Client) SetDNSRecordProxied(ctx context.Context, recordID string, proxied bool) error {
	payload := map[string]any{"proxied": proxied}
	return c.request(ctx, http.MethodPatch, c.zonePath("/dns_records/"+recordID), payload, nil)
}

// GetZoneSettings returns the subset of zone settings the console manages,
// keyed by Cloudflare's setting id.
func (c *Client) GetZoneSettings(ctx context.Context) (map[string]any, error) {
	var settings []ZoneSetting
	if err := c.request(ctx, http.MethodGet, c.zonePath("/settings"), nil, &settings); err != nil {
		return nil, err
	}
	managed := map[string]bool{
		"security_level":   true,
		"min_tls_version":  true,
		"always_use_https": true,
		"browser_check":    true,
		"challenge_ttl":    true,
		"ssl":              true,
	}
	result := make(map[string]any, len(managed))
	for _, setting := range settings {
		if !managed[setting.ID] {
			continue
		}
		var value any
		if err := json.Unmarshal(setting.Value, &value); err != nil {
			continue
		}
		result[setting.ID] = value
	}
	return result, nil
}

func (c *Client) PatchZoneSetting(ctx context.Context, name string, value any) error {
	payload := map[string]any{"value": value}
	return c.request(ctx, http.MethodPatch, c.zonePath("/settings/"+name), payload, nil)
}

func (c *Client) GetBotSettings(ctx context.Context) (*BotSettings, error) {
	var settings BotSettings
	if err := c.request(ctx, http.MethodGet, c.zonePath("/bot_management"), nil, &settings); err != nil {
		return nil, err
	}
	return &settings, nil
}

func (c *Client) SetBotFightMode(ctx context.Context, enabled bool) error {
	payload := map[string]any{"fight_mode": enabled}
	return c.request(ctx, http.MethodPut, c.zonePath("/bot_management"), payload, nil)
}

// ListPhaseRules returns the rules of a phase entry point ruleset. A zone with
// no ruleset in that phase yet reports an empty list rather than an error.
func (c *Client) ListPhaseRules(ctx context.Context, phase string) ([]Rule, error) {
	var entrypoint ruleset
	err := c.request(ctx, http.MethodGet, c.zonePath("/rulesets/phases/"+phase+"/entrypoint"), nil, &entrypoint)
	if IsNotFound(err) {
		return nil, nil
	}
	if err != nil {
		return nil, err
	}
	return entrypoint.Rules, nil
}

// ApplyProtectionProfile rewrites the rules this console owns while preserving
// every rule an operator created by hand.
func (c *Client) ApplyProtectionProfile(ctx context.Context, profile ProtectionProfile) error {
	if err := profile.Validate(); err != nil {
		return err
	}
	pathExpression := "http.request.uri.path in {" + quoteList(credentialEndpoints) + "}"

	var rateLimitRules []Rule
	if profile.RateLimitEnabled {
		rateLimitRules = append(rateLimitRules, Rule{
			Description: managedRuleTag + " credential endpoint rate limit",
			Expression:  "(" + pathExpression + ")",
			Action:      "managed_challenge",
			Enabled:     true,
			RateLimit: &RuleRateLimit{
				Characteristics:   []string{"ip.src", "cf.colo.id"},
				Period:            profile.RateLimitPeriod,
				RequestsPerPeriod: profile.RateLimitRequests,
				MitigationTimeout: profile.RateLimitPeriod,
			},
		})
	}
	if err := c.replaceManagedRules(ctx, rateLimitPhase, rateLimitRules); err != nil {
		return err
	}

	var firewallRules []Rule
	if profile.ChallengeEnabled {
		firewallRules = append(firewallRules, Rule{
			Description: managedRuleTag + " challenge credential endpoints",
			Expression: fmt.Sprintf("(http.host in {%s} and %s)",
				quoteList(profile.ChallengeHosts), pathExpression),
			Action:  "managed_challenge",
			Enabled: true,
		})
	}
	return c.replaceManagedRules(ctx, firewallPhase, firewallRules)
}

func (c *Client) replaceManagedRules(ctx context.Context, phase string, managed []Rule) error {
	existing, err := c.ListPhaseRules(ctx, phase)
	if err != nil {
		return err
	}

	kept := make([]Rule, 0, len(existing)+len(managed))
	for _, rule := range existing {
		if rule.Managed() {
			continue
		}
		kept = append(kept, rule)
	}
	if len(kept) == 0 && len(managed) == 0 && len(existing) == 0 {
		return nil
	}
	kept = append(kept, managed...)

	// The entry point endpoint derives the ruleset identity from the URL and
	// rejects a body that restates it, so only the rules may be sent.
	payload := map[string]any{"rules": kept}
	return c.request(ctx, http.MethodPut, c.zonePath("/rulesets/phases/"+phase+"/entrypoint"), payload, nil)
}

// CredentialEndpoints exposes the protected paths so the console can show an
// administrator exactly which routes a generated rule will cover.
func CredentialEndpoints() []string {
	return append([]string(nil), credentialEndpoints...)
}

func RatePeriods() []int {
	return append([]int(nil), ratePeriods...)
}

func quoteList(values []string) string {
	quoted := make([]string, 0, len(values))
	for _, value := range values {
		quoted = append(quoted, `"`+value+`"`)
	}
	return strings.Join(quoted, " ")
}

func containsInt(values []int, target int) bool {
	for _, value := range values {
		if value == target {
			return true
		}
	}
	return false
}
