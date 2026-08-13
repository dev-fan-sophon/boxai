package common

import (
	"testing"

	"github.com/dev-fan-sophon/boxai/constant"
	"github.com/stretchr/testify/assert"
)

func TestResponsesCompactChannelSupport(t *testing.T) {
	tests := []struct {
		name        string
		channelType int
		apiType     int
		want        bool
	}{
		{name: "OpenAI", channelType: constant.ChannelTypeOpenAI, apiType: constant.APITypeOpenAI, want: true},
		{name: "Azure", channelType: constant.ChannelTypeAzure, apiType: constant.APITypeOpenAI, want: true},
		{name: "Codex", channelType: constant.ChannelTypeCodex, apiType: constant.APITypeCodex, want: true},
		{name: "Advanced Custom", channelType: constant.ChannelTypeAdvancedCustom, apiType: constant.APITypeAdvancedCustom, want: true},
		{name: "Sub2API", channelType: constant.ChannelTypeSub2API, apiType: constant.APITypeSub2API, want: true},
		{name: "New API", channelType: constant.ChannelTypeNewAPI, apiType: constant.APITypeNewAPI, want: true},
		{name: "Anthropic", channelType: constant.ChannelTypeAnthropic, apiType: constant.APITypeAnthropic, want: false},
		{name: "Gemini", channelType: constant.ChannelTypeGemini, apiType: constant.APITypeGemini, want: false},
		{name: "OpenAI channel with mismatched API type", channelType: constant.ChannelTypeOpenAI, apiType: constant.APITypeCodex, want: false},
		{name: "Codex channel with mismatched API type", channelType: constant.ChannelTypeCodex, apiType: constant.APITypeOpenAI, want: false},
		{name: "unsupported OpenAI-compatible channel", channelType: constant.ChannelTypeSora, apiType: constant.APITypeOpenAI, want: false},
	}

	for _, test := range tests {
		t.Run(test.name, func(t *testing.T) {
			assert.Equal(t, test.want, SupportsResponsesCompact(test.channelType, test.apiType))
		})
	}
}
