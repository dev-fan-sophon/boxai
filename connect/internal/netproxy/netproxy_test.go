package netproxy

import (
	"net/http"
	"net/url"
	"testing"
	"time"

	"github.com/stretchr/testify/assert"
	"github.com/stretchr/testify/require"
	"github.com/yetone/magpie/internal/settings"
)

func TestParseScutil(t *testing.T) {
	out := `<dictionary> {
  ExceptionsList : <array> {
    0 : 127.0.0.1
    1 : *.local
  }
  HTTPEnable : 1
  HTTPPort : 7890
  HTTPProxy : 127.0.0.1
  HTTPSEnable : 1
  HTTPSPort : 7891
  HTTPSProxy : 127.0.0.1
  SOCKSEnable : 1
  SOCKSPort : 7892
  SOCKSProxy : 127.0.0.1
}`
	p := parseScutil(out)
	if p.URL != "http://127.0.0.1:7891" || len(p.Bypass) != 2 || p.Bypass[1] != "*.local" {
		t.Fatalf("%+v", p)
	}
	if p := parseScutil("<dictionary> {\n  SOCKSEnable : 1\n  SOCKSPort : 1080\n  SOCKSProxy : 10.0.0.2\n}"); p.URL != "socks5://10.0.0.2:1080" {
		t.Fatalf("socks: %+v", p)
	}
	if p := parseScutil("<dictionary> {\n  HTTPEnable : 0\n  HTTPProxy : x\n}"); p.URL != "" {
		t.Fatalf("off: %+v", p)
	}
}

func TestParseWindows(t *testing.T) {
	for server, want := range map[string]string{
		"127.0.0.1:7890":                     "http://127.0.0.1:7890",
		"http=127.0.0.1:1;https=127.0.0.1:2": "http://127.0.0.1:2",
		"socks=127.0.0.1:1080":               "socks5://127.0.0.1:1080",
		"":                                   "",
	} {
		if got := parseWindows(server, "").URL; got != want {
			t.Errorf("%q: %q, want %q", server, got, want)
		}
	}
	p := parseWindows("127.0.0.1:7890", "*.corp;<local>")
	if !bypassed("git.corp", p.Bypass) || !bypassed("intranet", p.Bypass) || bypassed("chatgpt.com", p.Bypass) {
		t.Fatalf("bypass: %+v", p.Bypass)
	}
}

func TestFor(t *testing.T) {
	t.Setenv("XDG_CONFIG_HOME", t.TempDir())
	for _, k := range []string{"HTTPS_PROXY", "https_proxy", "HTTP_PROXY", "http_proxy", "ALL_PROXY", "all_proxy"} {
		t.Setenv(k, "http://127.0.0.1:7891")
	}
	sysCache.at, sysCache.p = farFuture, Proxy{URL: "http://127.0.0.1:7890", Bypass: []string{"*.corp"}}
	t.Cleanup(func() { sysCache.at = zero })

	// Neither system nor environment proxies may divert BoxAI traffic.
	for _, target := range []string{"https://you-box.com/api/desktop/session", "https://git.corp/x", "http://127.0.0.1:3425"} {
		u, err := url.Parse(target)
		require.NoError(t, err)
		p, err := For(u)
		require.NoError(t, err)
		assert.Nil(t, p, target)
		p, err = Func(&http.Request{URL: u})
		require.NoError(t, err)
		assert.Nil(t, p, target)
	}
	for _, proxy := range []string{"socks5://127.0.0.1:1080", "ftp://x", "127.0.0.1:7890"} {
		require.Error(t, settings.Save(settings.Settings{Proxy: proxy}))
	}
	require.NoError(t, settings.Save(settings.Settings{Proxy: "direct"}))
}

func TestEnv(t *testing.T) {
	t.Setenv("XDG_CONFIG_HOME", t.TempDir())
	sysCache.at, sysCache.p = farFuture, Proxy{URL: "http://127.0.0.1:7890", Bypass: []string{"*.corp", "<local>"}}
	t.Cleanup(func() { sysCache.at = zero })
	assert.Equal(t, []string{"PATH=/bin", "HOME=/h"}, Env([]string{"PATH=/bin", "HOME=/h"}), "system proxy must not be injected")
	input := []string{"HTTPS_PROXY=http://10.0.0.1:1", "https_proxy=http://10.0.0.2:2", "HTTP_PROXY=http://x", "http_proxy=http://y", "ALL_PROXY=socks5://x", "all_proxy=socks5://y", "NO_PROXY=x", "no_proxy=y", "PATH=/bin", "HOME=/h", "CUSTOM_PROXY=preserved"}
	original := append([]string(nil), input...)
	assert.Equal(t, []string{"PATH=/bin", "HOME=/h", "CUSTOM_PROXY=preserved"}, Env(input), "strip standard proxies and preserve unrelated environment")
	assert.Equal(t, original, input, "caller environment must remain intact")
}

var farFuture = time.Now().Add(time.Hour)
var zero time.Time
