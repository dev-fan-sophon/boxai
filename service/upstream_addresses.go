package service

import (
	"net/url"
	"strings"
	"sync"

	"github.com/dev-fan-sophon/boxai/common"
	"github.com/dev-fan-sophon/boxai/constant"
	"github.com/dev-fan-sophon/boxai/dto"

	"github.com/gin-gonic/gin"
	"golang.org/x/net/http/httpproxy"
)

// presetUpstreamHosts are the hosts, with any port, of the default base URLs
// preset for channel types. They are public endpoints, so errors keep them
// readable. The port keeps a configured localhost upstream apart from the
// Ollama preset.
var presetUpstreamHosts = sync.OnceValue(func() map[string]struct{} {
	hosts := make(map[string]struct{}, len(constant.ChannelBaseURLs))
	for _, baseURL := range constant.ChannelBaseURLs {
		if parsed, err := url.Parse(baseURL); err == nil && parsed.Host != "" {
			hosts[strings.ToLower(parsed.Host)] = struct{}{}
		}
	}
	return hosts
})

// isPresetUpstreamHost reports whether address points at one of the preset
// default base URL hosts.
func isPresetUpstreamHost(address string) bool {
	rawURL := strings.TrimSpace(address)
	if !strings.Contains(rawURL, "://") {
		rawURL = "//" + rawURL
	}
	parsed, err := url.Parse(rawURL)
	if err != nil {
		return false
	}
	_, preset := presetUpstreamHosts()[strings.ToLower(parsed.Host)]
	return preset
}

// UpstreamAddresses returns the addresses masked in errors shown to users: the
// upstream the admin configured for the selected channel and the proxies its
// requests may go through. Preset default base URLs are public and stay
// readable. The origin actually requested only counts for a configured base
// URL or an Advanced Custom channel, whose routes may target absolute URLs;
// other adaptors build official endpoints themselves.
func UpstreamAddresses(c *gin.Context) []string {
	if c == nil {
		return nil
	}
	// A channel without its own proxy dials through the environment proxy.
	environmentProxy := httpproxy.FromEnvironment()
	candidates := []string{environmentProxy.HTTPProxy, environmentProxy.HTTPSProxy}
	if setting, ok := common.GetContextKeyType[dto.ChannelSettings](c, constant.ContextKeyChannelSetting); ok {
		candidates = append(candidates, setting.Proxy)
	}
	baseURL := strings.TrimSpace(common.GetContextKeyString(c, constant.ContextKeyChannelBaseUrl))
	candidates = append(candidates, baseURL)
	if common.GetContextKeyInt(c, constant.ContextKeyChannelType) == constant.ChannelTypeAdvancedCustom || (baseURL != "" && !isPresetUpstreamHost(baseURL)) {
		candidates = append(candidates, common.GetContextKeyString(c, constant.ContextKeyUpstreamRequestOrigin))
	}
	addresses := make([]string, 0, len(candidates))
	for _, address := range candidates {
		if strings.TrimSpace(address) != "" && !isPresetUpstreamHost(address) {
			addresses = append(addresses, address)
		}
	}
	return addresses
}

// RecordUpstreamRequestOrigin remembers the scheme and host the gateway is
// about to dial, so errors can mask an absolute Advanced Custom route target.
func RecordUpstreamRequestOrigin(c *gin.Context, requestURL string) {
	if c == nil {
		return
	}
	if parsed, err := url.Parse(requestURL); err == nil && parsed.Host != "" {
		common.SetContextKey(c, constant.ContextKeyUpstreamRequestOrigin, parsed.Scheme+"://"+parsed.Host)
	}
}
