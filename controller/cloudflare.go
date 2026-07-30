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
package controller

import (
	"net/http"
	"strings"

	"github.com/QuantumNous/new-api/common"
	"github.com/QuantumNous/new-api/service/cloudflare"
	"github.com/QuantumNous/new-api/setting/system_setting"

	"github.com/gin-gonic/gin"
	"github.com/pkg/errors"
)

// cloudflareClient resolves the shared client and reports the "not configured
// yet" state as a successful empty status so the console can show a setup form.
func cloudflareClient(c *gin.Context) (*cloudflare.Client, bool) {
	client, err := cloudflare.NewClient()
	if err == nil {
		return client, true
	}
	if errors.Is(err, cloudflare.ErrNotConfigured) {
		common.ApiSuccess(c, gin.H{"configured": false})
		return nil, false
	}
	common.ApiError(c, err)
	return nil, false
}

func GetCloudflareStatus(c *gin.Context) {
	client, ok := cloudflareClient(c)
	if !ok {
		return
	}
	ctx := c.Request.Context()

	zone, err := client.GetZone(ctx)
	if err != nil {
		common.ApiError(c, err)
		return
	}
	records, err := client.ListDNSRecords(ctx)
	if err != nil {
		common.ApiError(c, err)
		return
	}
	zoneSettings, err := client.GetZoneSettings(ctx)
	if err != nil {
		common.ApiError(c, err)
		return
	}
	rateLimitRules, err := client.ListPhaseRules(ctx, "http_ratelimit")
	if err != nil {
		common.ApiError(c, err)
		return
	}
	firewallRules, err := client.ListPhaseRules(ctx, "http_request_firewall_custom")
	if err != nil {
		common.ApiError(c, err)
		return
	}

	// Bot management is unavailable on some plans; an error there must not hide
	// the rest of the status page.
	var bot *cloudflare.BotSettings
	if settings, botErr := client.GetBotSettings(ctx); botErr == nil {
		bot = settings
	}

	common.ApiSuccess(c, gin.H{
		"configured":           true,
		"zone_id":              client.ZoneID(),
		"account_id":           system_setting.GetCloudflareSettings().AccountID,
		"zone_name":            zone.Name,
		"plan":                 zone.Plan.Name,
		"dns_records":          records,
		"zone_settings":        zoneSettings,
		"bot":                  bot,
		"rate_limit_rules":     rateLimitRules,
		"firewall_rules":       firewallRules,
		"credential_endpoints": cloudflare.CredentialEndpoints(),
		"rate_periods":         cloudflare.RatePeriods(),
		"rule_actions":         cloudflare.RuleActions(),
	})
}

func UpdateCloudflareDNSProxy(c *gin.Context) {
	var request struct {
		RecordID string `json:"record_id"`
		Proxied  bool   `json:"proxied"`
	}
	if err := c.ShouldBindJSON(&request); err != nil {
		common.ApiError(c, err)
		return
	}
	if strings.TrimSpace(request.RecordID) == "" {
		common.ApiErrorMsg(c, "record_id is required")
		return
	}
	client, ok := cloudflareClient(c)
	if !ok {
		return
	}
	if err := client.SetDNSRecordProxied(c.Request.Context(), request.RecordID, request.Proxied); err != nil {
		common.ApiError(c, err)
		return
	}
	common.ApiSuccess(c, nil)
}

// allowedZoneSettings restricts the generic setting endpoint to the security
// controls the console renders, so a crafted request cannot reconfigure
// unrelated parts of the zone.
var allowedZoneSettings = map[string]map[string]bool{
	"security_level":   {"off": true, "essentially_off": true, "low": true, "medium": true, "high": true, "under_attack": true},
	"min_tls_version":  {"1.0": true, "1.1": true, "1.2": true, "1.3": true},
	"always_use_https": {"on": true, "off": true},
	"browser_check":    {"on": true, "off": true},
	"ssl":              {"off": true, "flexible": true, "full": true, "strict": true},
}

func UpdateCloudflareZoneSetting(c *gin.Context) {
	var request struct {
		Name  string `json:"name"`
		Value string `json:"value"`
	}
	if err := c.ShouldBindJSON(&request); err != nil {
		common.ApiError(c, err)
		return
	}
	allowed, known := allowedZoneSettings[request.Name]
	if !known {
		common.ApiErrorMsg(c, "unsupported Cloudflare zone setting: "+request.Name)
		return
	}
	if !allowed[request.Value] {
		common.ApiErrorMsg(c, "unsupported value for "+request.Name+": "+request.Value)
		return
	}
	client, ok := cloudflareClient(c)
	if !ok {
		return
	}
	if err := client.PatchZoneSetting(c.Request.Context(), request.Name, request.Value); err != nil {
		common.ApiError(c, err)
		return
	}
	common.ApiSuccess(c, nil)
}

func UpdateCloudflareBotFightMode(c *gin.Context) {
	var request struct {
		FightMode bool `json:"fight_mode"`
	}
	if err := c.ShouldBindJSON(&request); err != nil {
		common.ApiError(c, err)
		return
	}
	client, ok := cloudflareClient(c)
	if !ok {
		return
	}
	if err := client.SetBotFightMode(c.Request.Context(), request.FightMode); err != nil {
		common.ApiError(c, err)
		return
	}
	common.ApiSuccess(c, nil)
}

func ApplyCloudflareProtection(c *gin.Context) {
	var profile cloudflare.ProtectionProfile
	if err := c.ShouldBindJSON(&profile); err != nil {
		common.ApiError(c, err)
		return
	}
	if err := profile.Validate(); err != nil {
		common.ApiError(c, err)
		return
	}
	client, ok := cloudflareClient(c)
	if !ok {
		return
	}
	if err := client.ApplyProtectionProfile(c.Request.Context(), profile); err != nil {
		common.ApiError(c, err)
		return
	}
	common.ApiSuccess(c, nil)
}

// TestCloudflareCredentials verifies a token without persisting it, so an
// administrator learns about a scope mistake before saving.
func TestCloudflareCredentials(c *gin.Context) {
	client, err := cloudflare.NewClient()
	if err != nil {
		if errors.Is(err, cloudflare.ErrNotConfigured) {
			c.JSON(http.StatusOK, gin.H{"success": false, "message": err.Error()})
			return
		}
		common.ApiError(c, err)
		return
	}
	zone, err := client.GetZone(c.Request.Context())
	if err != nil {
		common.ApiError(c, err)
		return
	}
	common.ApiSuccess(c, gin.H{"zone_name": zone.Name, "plan": zone.Plan.Name})
}
