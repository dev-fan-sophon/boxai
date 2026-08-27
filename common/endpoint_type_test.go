package common

import (
	"testing"

	"github.com/dev-fan-sophon/boxai/constant"
	"github.com/stretchr/testify/require"
)

func TestCodexProxyEndpointCapabilitiesStayProtocolSpecific(t *testing.T) {
	apiType, ok := ChannelType2APIType(constant.ChannelTypeCodexProxy)
	require.True(t, ok)
	require.Equal(t, constant.APITypeCodexProxy, apiType)
	require.False(t, SupportsResponsesCompact(constant.ChannelTypeCodexProxy, apiType))
	require.Equal(t, "Codex Proxy", constant.GetChannelTypeName(constant.ChannelTypeCodexProxy))

	require.Equal(t, []constant.EndpointType{
		constant.EndpointTypeOpenAI,
		constant.EndpointTypeOpenAIResponse,
		constant.EndpointTypeAnthropic,
		constant.EndpointTypeGemini,
	}, GetEndpointTypesByChannelType(constant.ChannelTypeCodexProxy, "gpt-5.6-luna"))
	require.Equal(t,
		[]constant.EndpointType{constant.EndpointTypeImageGeneration},
		GetEndpointTypesByChannelType(constant.ChannelTypeCodexProxy, "gpt-image-2"),
	)
	require.Equal(t,
		[]constant.EndpointType{constant.EndpointTypeEmbeddings},
		GetEndpointTypesByChannelType(constant.ChannelTypeCodexProxy, "text-embedding-3-small"),
	)
	require.Empty(t, GetEndpointTypesByChannelType(constant.ChannelTypeCodexProxy, "gpt-audio-preview"))
	require.Empty(t, GetEndpointTypesByChannelType(constant.ChannelTypeCodexProxy, "grok-imagine-video"))
}
