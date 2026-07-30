package common

import (
	"fmt"
	"net"
	"strings"
	"sync"

	"github.com/gin-gonic/gin"
)

const CloudflareConnectingIPHeader = "CF-Connecting-IP"

// cloudflareEdgeCIDRsFallback mirrors https://api.cloudflare.com/client/v4/ips and is
// only consulted until an administrator refreshes the live list.
var cloudflareEdgeCIDRsFallback = []string{
	"173.245.48.0/20",
	"103.21.244.0/22",
	"103.22.200.0/22",
	"103.31.4.0/22",
	"141.101.64.0/18",
	"108.162.192.0/18",
	"190.93.240.0/20",
	"188.114.96.0/20",
	"197.234.240.0/22",
	"198.41.128.0/17",
	"162.158.0.0/15",
	"104.16.0.0/13",
	"104.24.0.0/14",
	"172.64.0.0/13",
	"131.0.72.0/22",
	"2400:cb00::/32",
	"2606:4700::/32",
	"2803:f800::/32",
	"2405:b500::/32",
	"2405:8100::/32",
	"2a06:98c0::/29",
	"2c0f:f248::/32",
}

// localProxyCIDRs covers the loopback and private ranges a reverse proxy on the
// same host or network can legitimately connect from.
var localProxyCIDRs = []string{
	"127.0.0.0/8",
	"::1/128",
	"10.0.0.0/8",
	"172.16.0.0/12",
	"192.168.0.0/16",
	"fc00::/7",
	"fe80::/10",
}

var (
	trustedProxyMutex      sync.RWMutex
	operatorProxyCIDRs     []string
	cloudflareEdgeCIDRs    = cloudflareEdgeCIDRsFallback
	cloudflareProxyEnabled bool
	trustedProxyNetworks   []*net.IPNet
	operatedProxyNetworks  []*net.IPNet
	cloudflareEdgeNetworks []*net.IPNet
	trustedProxyObserver   func([]string)
)

// OnTrustedProxyChange registers the router so its own proxy list follows the
// administrator's edits. Without it gin keeps the boot-time list and its
// ClientIP, which feeds the access log, disagrees with RealClientIP as soon as
// the deployment is moved behind or away from a proxy.
func OnTrustedProxyChange(observer func([]string)) {
	trustedProxyMutex.Lock()
	trustedProxyObserver = observer
	trustedProxyMutex.Unlock()
	notifyTrustedProxyChange()
}

func notifyTrustedProxyChange() {
	trustedProxyMutex.RLock()
	observer := trustedProxyObserver
	cidrs := collectTrustedProxyCIDRs()
	trustedProxyMutex.RUnlock()
	if observer != nil {
		observer(cidrs)
	}
}

func InitTrustedProxy() {
	if err := SetTrustedProxyCIDRs(GetEnvOrDefaultString("TRUSTED_PROXY_CIDRS", "")); err != nil {
		SysError("invalid TRUSTED_PROXY_CIDRS, ignoring: " + err.Error())
	}
	SetCloudflareProxyEnabled(GetEnvOrDefaultBool("CLOUDFLARE_PROXY_ENABLED", false))
}

// ParseCIDRList accepts a comma or newline separated list of CIDRs and bare IPs.
func ParseCIDRList(raw string) ([]string, error) {
	var parsed []string
	for _, field := range strings.FieldsFunc(raw, func(r rune) bool { return r == ',' || r == '\n' || r == ' ' }) {
		entry := strings.TrimSpace(field)
		if entry == "" {
			continue
		}
		if _, _, err := net.ParseCIDR(entry); err == nil {
			parsed = append(parsed, entry)
			continue
		}
		ip := net.ParseIP(entry)
		if ip == nil {
			return nil, fmt.Errorf("invalid CIDR or IP address: %s", entry)
		}
		if ip.To4() != nil {
			parsed = append(parsed, entry+"/32")
		} else {
			parsed = append(parsed, entry+"/128")
		}
	}
	return parsed, nil
}

func SetTrustedProxyCIDRs(raw string) error {
	parsed, err := ParseCIDRList(raw)
	if err != nil {
		return err
	}
	trustedProxyMutex.Lock()
	operatorProxyCIDRs = parsed
	trustedProxyMutex.Unlock()
	rebuildTrustedProxyNetworks()
	return nil
}

func SetCloudflareProxyEnabled(enabled bool) {
	trustedProxyMutex.Lock()
	cloudflareProxyEnabled = enabled
	trustedProxyMutex.Unlock()
	rebuildTrustedProxyNetworks()
}

func CloudflareProxyEnabled() bool {
	trustedProxyMutex.RLock()
	defer trustedProxyMutex.RUnlock()
	return cloudflareProxyEnabled
}

// SetCloudflareEdgeCIDRs replaces the built-in Cloudflare address space with a
// freshly fetched one. An empty list restores the compiled-in fallback.
func SetCloudflareEdgeCIDRs(cidrs []string) error {
	if len(cidrs) == 0 {
		trustedProxyMutex.Lock()
		cloudflareEdgeCIDRs = cloudflareEdgeCIDRsFallback
		trustedProxyMutex.Unlock()
		rebuildTrustedProxyNetworks()
		return nil
	}
	parsed, err := ParseCIDRList(strings.Join(cidrs, ","))
	if err != nil {
		return err
	}
	trustedProxyMutex.Lock()
	cloudflareEdgeCIDRs = parsed
	trustedProxyMutex.Unlock()
	rebuildTrustedProxyNetworks()
	return nil
}

// TrustedProxyCIDRs returns the full set of networks whose forwarding headers are honoured.
func TrustedProxyCIDRs() []string {
	trustedProxyMutex.RLock()
	defer trustedProxyMutex.RUnlock()
	return collectTrustedProxyCIDRs()
}

func TrustedProxyCIDRsString() string {
	trustedProxyMutex.RLock()
	defer trustedProxyMutex.RUnlock()
	return strings.Join(operatorProxyCIDRs, ",")
}

func collectTrustedProxyCIDRs() []string {
	cidrs := make([]string, 0, len(localProxyCIDRs)+len(operatorProxyCIDRs)+len(cloudflareEdgeCIDRs))
	cidrs = append(cidrs, localProxyCIDRs...)
	cidrs = append(cidrs, operatorProxyCIDRs...)
	if cloudflareProxyEnabled {
		cidrs = append(cidrs, cloudflareEdgeCIDRs...)
	}
	return cidrs
}

func rebuildTrustedProxyNetworks() {
	trustedProxyMutex.Lock()
	trustedProxyNetworks = parseNetworks(collectTrustedProxyCIDRs())
	operatedProxyNetworks = parseNetworks(append(append([]string{}, localProxyCIDRs...), operatorProxyCIDRs...))
	cloudflareEdgeNetworks = parseNetworks(cloudflareEdgeCIDRs)
	trustedProxyMutex.Unlock()

	notifyTrustedProxyChange()
}

func parseNetworks(cidrs []string) []*net.IPNet {
	networks := make([]*net.IPNet, 0, len(cidrs))
	for _, cidr := range cidrs {
		if _, network, err := net.ParseCIDR(cidr); err == nil {
			networks = append(networks, network)
		}
	}
	return networks
}

func containsIP(networks []*net.IPNet, ip net.IP) bool {
	for _, network := range networks {
		if network.Contains(ip) {
			return true
		}
	}
	return false
}

func IsTrustedProxy(ip net.IP) bool {
	if ip == nil {
		return false
	}
	trustedProxyMutex.RLock()
	defer trustedProxyMutex.RUnlock()
	return containsIP(trustedProxyNetworks, ip)
}

// isOperatedProxy reports whether the address belongs to a proxy we run
// ourselves, as opposed to the Cloudflare edge. Only our own proxies may be
// skipped when locating the address that reached our infrastructure.
func isOperatedProxy(ip net.IP) bool {
	if ip == nil {
		return false
	}
	trustedProxyMutex.RLock()
	defer trustedProxyMutex.RUnlock()
	return containsIP(operatedProxyNetworks, ip)
}

func isCloudflareEdge(ip net.IP) bool {
	if ip == nil {
		return false
	}
	trustedProxyMutex.RLock()
	defer trustedProxyMutex.RUnlock()
	return containsIP(cloudflareEdgeNetworks, ip)
}

// ingressIP returns the address that connected to the outermost proxy we
// operate. Entries appended by our own proxies are skipped, so the result is
// whoever actually reached our infrastructure from the outside.
func ingressIP(peer net.IP, forwardedFor string) net.IP {
	if !isOperatedProxy(peer) {
		return peer
	}
	items := strings.Split(forwardedFor, ",")
	for i := len(items) - 1; i >= 0; i-- {
		ip := net.ParseIP(strings.TrimSpace(items[i]))
		if ip == nil {
			return nil
		}
		if !isOperatedProxy(ip) {
			return ip
		}
	}
	return nil
}

// RealClientIP resolves the originating client address, honouring forwarding
// headers only when the immediate peer is a trusted proxy. Requests arriving
// directly from an untrusted peer always report that peer's address, so a
// forged X-Forwarded-For cannot be used to escape IP-keyed rate limits.
func RealClientIP(c *gin.Context) string {
	if c == nil || c.Request == nil {
		return ""
	}
	peer := c.RemoteIP()
	peerIP := net.ParseIP(peer)
	if !IsTrustedProxy(peerIP) {
		if peerIP == nil {
			return c.ClientIP()
		}
		return peer
	}
	forwardedFor := c.GetHeader("X-Forwarded-For")
	// CF-Connecting-IP is only meaningful on a request that actually traversed
	// Cloudflare. A deployment that also answers on a hostname bypassing the
	// edge would otherwise let any client set the header and pick its own
	// address for rate limiting and token allowlists.
	if CloudflareProxyEnabled() && isCloudflareEdge(ingressIP(peerIP, forwardedFor)) {
		if ip := net.ParseIP(strings.TrimSpace(c.GetHeader(CloudflareConnectingIPHeader))); ip != nil {
			return ip.String()
		}
	}
	if ip := clientIPFromForwardedFor(forwardedFor); ip != "" {
		return ip
	}
	if ip := net.ParseIP(strings.TrimSpace(c.GetHeader("X-Real-IP"))); ip != nil {
		return ip.String()
	}
	return peer
}

// clientIPFromForwardedFor walks X-Forwarded-For from right to left and returns
// the first address that is not one of our own proxies.
func clientIPFromForwardedFor(header string) string {
	if header == "" {
		return ""
	}
	items := strings.Split(header, ",")
	for i := len(items) - 1; i >= 0; i-- {
		ip := net.ParseIP(strings.TrimSpace(items[i]))
		if ip == nil {
			return ""
		}
		if i == 0 || !IsTrustedProxy(ip) {
			return ip.String()
		}
	}
	return ""
}
