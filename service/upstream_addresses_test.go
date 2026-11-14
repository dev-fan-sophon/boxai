package service

import (
	"errors"
	"net/http"
	"net/http/httptest"
	"testing"

	"github.com/dev-fan-sophon/boxai/common"
	"github.com/dev-fan-sophon/boxai/constant"
	"github.com/dev-fan-sophon/boxai/dto"
	"github.com/dev-fan-sophon/boxai/types"

	"github.com/gin-gonic/gin"
	"github.com/stretchr/testify/assert"
)

// Only addresses the admin configured are masked: a channel on a preset base
// URL reaches a public official endpoint, and so do adaptors that build
// official endpoints themselves.
func TestUpstreamAddressesMaskOnlyConfiguredAddresses(t *testing.T) {
	for _, tc := range []struct {
		name         string
		channelType  int
		baseURL      string
		origin       string
		channelProxy string
		proxyEnv     string
		message      string
		want         string
	}{
		{
			name:        "preset base URL stays readable",
			channelType: constant.ChannelTypeAnthropic,
			baseURL:     "https://api.anthropic.com",
			origin:      "https://api.anthropic.com",
			message:     "request to https://api.anthropic.com/v1/messages failed, see https://docs.example.org/errors",
			want:        "request to https://api.anthropic.com/v1/messages failed, see https://docs.example.org/errors",
		},
		{
			name:        "official endpoint built by the adaptor stays readable",
			channelType: constant.ChannelTypeVertexAi,
			origin:      "https://us-central1-aiplatform.googleapis.com",
			message:     "request to https://us-central1-aiplatform.googleapis.com/v1/projects failed",
			want:        "request to https://us-central1-aiplatform.googleapis.com/v1/projects failed",
		},
		{
			name:        "configured base URL is masked",
			channelType: constant.ChannelTypeOpenAI,
			baseURL:     "https://relay.private.example",
			origin:      "https://relay.private.example",
			message:     "request to https://relay.private.example/v1/chat/completions failed",
			want:        "request to https://***.example/***/***/*** failed",
		},
		{
			name:        "absolute Advanced Custom route is masked",
			channelType: constant.ChannelTypeAdvancedCustom,
			origin:      "https://route.private.example",
			message:     "dial tcp: lookup route.private.example: no such host",
			want:        "dial tcp: lookup ***.***.example: no such host",
		},
		{
			name:         "channel proxy is masked on a preset channel",
			channelType:  constant.ChannelTypeAnthropic,
			baseURL:      "https://api.anthropic.com",
			channelProxy: "socks5://egress.private.invalid:1080",
			message:      "socks connect tcp egress.private.invalid:1080->api.anthropic.com:443: EOF",
			want:         "socks connect tcp ***.***.invalid:1080->api.anthropic.com:443: EOF",
		},
		{
			name:        "environment proxy is masked on a preset channel",
			channelType: constant.ChannelTypeAnthropic,
			baseURL:     "https://api.anthropic.com",
			proxyEnv:    "http://egress.private.invalid:8080",
			message:     "proxyconnect tcp: dial tcp: lookup egress.private.invalid: no such host",
			want:        "proxyconnect tcp: dial tcp: lookup ***.***.invalid: no such host",
		},
	} {
		t.Run(tc.name, func(t *testing.T) {
			t.Setenv("HTTPS_PROXY", tc.proxyEnv)
			t.Setenv("HTTP_PROXY", "")
			c, _ := gin.CreateTestContext(httptest.NewRecorder())
			common.SetContextKey(c, constant.ContextKeyChannelType, tc.channelType)
			common.SetContextKey(c, constant.ContextKeyChannelBaseUrl, tc.baseURL)
			common.SetContextKey(c, constant.ContextKeyChannelSetting, dto.ChannelSettings{Proxy: tc.channelProxy})
			common.SetContextKey(c, constant.ContextKeyUpstreamRequestOrigin, tc.origin)
			apiErr := types.NewErrorWithStatusCode(errors.New(tc.message), types.ErrorCodeBadResponseStatusCode, http.StatusBadGateway)

			assert.Equal(t, tc.want, apiErr.ToOpenAIError(UpstreamAddresses(c)...).Message)
		})
	}
}

func TestRecordUpstreamRequestOriginKeepsOnlySchemeAndHost(t *testing.T) {
	c, _ := gin.CreateTestContext(httptest.NewRecorder())
	RecordUpstreamRequestOrigin(c, "wss://route.private.example:8443/v1/realtime?key=secret")
	assert.Equal(t, "wss://route.private.example:8443", common.GetContextKeyString(c, constant.ContextKeyUpstreamRequestOrigin))
}
