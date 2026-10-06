package service

import (
	"net/http"
	"strings"

	"github.com/dev-fan-sophon/boxai/common"

	"github.com/gorilla/websocket"
)

// NewUpstreamWebSocketDialer returns a dialer for upstream WebSocket relays
// that routes through the channel proxy exactly like the HTTP relay client:
// HTTP(S) proxies use CONNECT and SOCKS5 proxies dial through the proxy.
func NewUpstreamWebSocketDialer(rawProxyURL string) (*websocket.Dialer, error) {
	dialer := *websocket.DefaultDialer
	if common.TLSInsecureSkipVerify {
		dialer.TLSClientConfig = common.InsecureTLSConfig.Clone()
	}
	if strings.TrimSpace(rawProxyURL) == "" {
		return &dialer, nil
	}
	proxyURL, legacySuffixStripped, err := common.ParseProxyURLRuntime(strings.TrimSpace(rawProxyURL))
	if err != nil {
		return nil, err
	}
	if proxyURL == nil {
		return &dialer, nil
	}
	if legacySuffixStripped {
		warnLegacyProxyURLOnce(newProxyURLConfig(proxyURL))
	}
	transport := &http.Transport{}
	if err := configureProxyTransport(transport, proxyURL); err != nil {
		return nil, err
	}
	dialer.Proxy = transport.Proxy
	if transport.DialContext != nil {
		dialer.NetDialContext = transport.DialContext
	}
	return &dialer, nil
}
