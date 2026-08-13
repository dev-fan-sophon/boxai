package deepseek

import (
	"testing"

	"github.com/dev-fan-sophon/boxai/dto"
	relaycommon "github.com/dev-fan-sophon/boxai/relay/common"
	relayconstant "github.com/dev-fan-sophon/boxai/relay/constant"
	"github.com/dev-fan-sophon/boxai/types"
	"github.com/stretchr/testify/assert"
	"github.com/stretchr/testify/require"
)

func TestGetRequestURLSupportsNativeResponses(t *testing.T) {
	tests := []struct {
		name        string
		relayFormat types.RelayFormat
		relayMode   int
		want        string
	}{
		{name: "chat", relayFormat: types.RelayFormatOpenAI, relayMode: relayconstant.RelayModeChatCompletions, want: "https://api.deepseek.com/v1/chat/completions"},
		{name: "fim completions", relayFormat: types.RelayFormatOpenAI, relayMode: relayconstant.RelayModeCompletions, want: "https://api.deepseek.com/beta/completions"},
		{name: "responses", relayFormat: types.RelayFormatOpenAIResponses, relayMode: relayconstant.RelayModeResponses, want: "https://api.deepseek.com/responses"},
		{name: "claude", relayFormat: types.RelayFormatClaude, relayMode: relayconstant.RelayModeChatCompletions, want: "https://api.deepseek.com/anthropic/v1/messages"},
	}

	for _, tt := range tests {
		t.Run(tt.name, func(t *testing.T) {
			url, err := (&Adaptor{}).GetRequestURL(&relaycommon.RelayInfo{
				RelayFormat: tt.relayFormat,
				RelayMode:   tt.relayMode,
				ChannelMeta: &relaycommon.ChannelMeta{ChannelBaseUrl: "https://api.deepseek.com"},
			})
			require.NoError(t, err)
			assert.Equal(t, tt.want, url)
		})
	}
}

func TestConvertOpenAIResponsesRequestAppliesDeepSeekThinkingSuffix(t *testing.T) {
	tests := []struct {
		name          string
		requestModel  string
		upstreamModel string
		reasoning     *dto.Reasoning
		wantModel     string
		wantEffort    string
		wantReasoning bool
	}{
		{
			name:          "max suffix",
			requestModel:  "client-alias",
			upstreamModel: "deepseek-v4-pro-max",
			wantModel:     "deepseek-v4-pro",
			wantEffort:    "max",
			wantReasoning: true,
		},
		{
			name:          "disabled suffix",
			requestModel:  "deepseek-v4-flash-none",
			wantModel:     "deepseek-v4-flash",
			wantEffort:    "none",
			wantReasoning: true,
		},
		{
			name:          "existing reasoning without suffix",
			requestModel:  "deepseek-reasoner",
			reasoning:     &dto.Reasoning{Effort: "high"},
			wantModel:     "deepseek-reasoner",
			wantEffort:    "high",
			wantReasoning: true,
		},
		{
			name:         "no reasoning",
			requestModel: "deepseek-chat",
			wantModel:    "deepseek-chat",
		},
	}

	for _, tt := range tests {
		t.Run(tt.name, func(t *testing.T) {
			info := &relaycommon.RelayInfo{ChannelMeta: &relaycommon.ChannelMeta{UpstreamModelName: tt.upstreamModel}}
			converted, err := (&Adaptor{}).ConvertOpenAIResponsesRequest(nil, info, dto.OpenAIResponsesRequest{
				Model:     tt.requestModel,
				Input:     []byte(`"hello"`),
				Reasoning: tt.reasoning,
			})
			require.NoError(t, err)

			request, ok := converted.(dto.OpenAIResponsesRequest)
			require.True(t, ok)
			assert.Equal(t, tt.wantModel, request.Model)
			assert.Equal(t, tt.wantReasoning, request.Reasoning != nil)
			if tt.wantReasoning {
				assert.Equal(t, tt.wantEffort, request.Reasoning.Effort)
			}
			assert.Equal(t, tt.wantEffort, info.ReasoningEffort)
			if tt.upstreamModel != "" && tt.wantModel != tt.requestModel {
				assert.Equal(t, tt.wantModel, info.UpstreamModelName)
			}
		})
	}
}

func TestConvertOpenAIResponsesRequestAcceptsNilRelayInfo(t *testing.T) {
	converted, err := (&Adaptor{}).ConvertOpenAIResponsesRequest(nil, nil, dto.OpenAIResponsesRequest{
		Model: "deepseek-v4-flash-none",
	})
	require.NoError(t, err)

	request, ok := converted.(dto.OpenAIResponsesRequest)
	require.True(t, ok)
	assert.Equal(t, "deepseek-v4-flash", request.Model)
	require.NotNil(t, request.Reasoning)
	assert.Equal(t, "none", request.Reasoning.Effort)
}
