package system_setting

import (
	"strings"
	"sync"
)

// CloudflareSettings holds the credentials the console uses to manage the edge
// protection of the zone that fronts this deployment. The token is stored under
// an option key ending in "Token" so the generic options endpoint never returns
// it to the browser.
type CloudflareSettings struct {
	APIToken  string
	ZoneID    string
	AccountID string
}

var (
	cloudflareMutex    sync.RWMutex
	cloudflareSettings CloudflareSettings
)

func GetCloudflareSettings() CloudflareSettings {
	cloudflareMutex.RLock()
	defer cloudflareMutex.RUnlock()
	return cloudflareSettings
}

func SetCloudflareAPIToken(token string) {
	cloudflareMutex.Lock()
	defer cloudflareMutex.Unlock()
	cloudflareSettings.APIToken = strings.TrimSpace(token)
}

func SetCloudflareZoneID(zoneID string) {
	cloudflareMutex.Lock()
	defer cloudflareMutex.Unlock()
	cloudflareSettings.ZoneID = strings.TrimSpace(zoneID)
}

func SetCloudflareAccountID(accountID string) {
	cloudflareMutex.Lock()
	defer cloudflareMutex.Unlock()
	cloudflareSettings.AccountID = strings.TrimSpace(accountID)
}

// CloudflareConfigured reports whether enough credentials exist to call the API.
// The account id is optional; only zone-scoped operations are exposed today.
func CloudflareConfigured() bool {
	settings := GetCloudflareSettings()
	return settings.APIToken != "" && settings.ZoneID != ""
}
