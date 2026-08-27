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

func TestSharedPricingEndpointCapabilitiesMatchRelaySurfaces(t *testing.T) {
	tests := []struct {
		name        string
		channelType int
		model       string
		want        []constant.EndpointType
	}{
		{
			name:        "OpenAI-compatible chat also supports Responses",
			channelType: constant.ChannelTypeOpenAI,
			model:       "gpt-5.5",
			want:        []constant.EndpointType{constant.EndpointTypeOpenAI, constant.EndpointTypeOpenAIResponse},
		},
		{
			name:        "Anthropic conversion includes Chat and Responses",
			channelType: constant.ChannelTypeAnthropic,
			model:       "claude-opus-5",
			want:        []constant.EndpointType{constant.EndpointTypeAnthropic, constant.EndpointTypeOpenAI, constant.EndpointTypeOpenAIResponse},
		},
		{
			name:        "Gemini conversion includes Chat and Responses",
			channelType: constant.ChannelTypeGemini,
			model:       "gemini-3.6-flash",
			want:        []constant.EndpointType{constant.EndpointTypeGemini, constant.EndpointTypeOpenAI, constant.EndpointTypeOpenAIResponse},
		},
		{
			name:        "Grok image is not classified as chat",
			channelType: constant.ChannelTypeOpenAI,
			model:       "grok-imagine-image-2.0",
			want:        []constant.EndpointType{constant.EndpointTypeImageGeneration},
		},
		{
			name:        "Grok video is not classified as chat",
			channelType: constant.ChannelTypeOpenAI,
			model:       "grok-imagine-video-1.5",
			want:        []constant.EndpointType{constant.EndpointTypeOpenAIVideo},
		},
		{
			name:        "Gemini embedding has OpenAI and native endpoints",
			channelType: constant.ChannelTypeGemini,
			model:       "gemini-embedding-2",
			want:        []constant.EndpointType{constant.EndpointTypeEmbeddings, constant.EndpointTypeGeminiEmbedding},
		},
		{
			name:        "OpenAI embedding only exposes the embeddings endpoint",
			channelType: constant.ChannelTypeOpenAI,
			model:       "text-embedding-3-large",
			want:        []constant.EndpointType{constant.EndpointTypeEmbeddings},
		},
		{
			name:        "generic audio is not classified as chat",
			channelType: constant.ChannelTypeOpenAI,
			model:       "gpt-4o-mini-tts",
			want:        []constant.EndpointType{constant.EndpointTypeAudio},
		},
	}

	for _, test := range tests {
		t.Run(test.name, func(t *testing.T) {
			require.Equal(t, test.want, GetEndpointTypesByChannelType(test.channelType, test.model))
		})
	}
}
