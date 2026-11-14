package openai

import (
	"net/http/httptest"
	"testing"

	"github.com/dev-fan-sophon/boxai/constant"
	"github.com/dev-fan-sophon/boxai/dto"
	relaycommon "github.com/dev-fan-sophon/boxai/relay/common"
	"github.com/gin-gonic/gin"
	"github.com/samber/lo"
	"github.com/stretchr/testify/assert"
	"github.com/stretchr/testify/require"
)

func TestConvertOpenAIRequestAppliesModelChatCapabilities(t *testing.T) {
	gin.SetMode(gin.TestMode)
	tests := []struct {
		name          string
		model         string
		effort        string
		wantModel     string
		wantEffort    string
		wantSampling  bool
		wantMaxTokens bool
		wantRole      string
	}{
		{name: "gpt 6 astra effort suffix", model: "gpt-6-astra-high", wantModel: "gpt-6-astra", wantEffort: "high", wantRole: "developer"},
		{name: "gpt 5.2 without reasoning keeps sampling", model: "gpt-5.2", wantModel: "gpt-5.2", wantSampling: true, wantRole: "developer"},
		{name: "gpt 5.2 with reasoning drops sampling", model: "gpt-5.2", effort: "medium", wantModel: "gpt-5.2", wantEffort: "medium", wantRole: "developer"},
		{name: "gpt 6 sol uses max_completion_tokens", model: "gpt-6-sol", wantModel: "gpt-6-sol", wantSampling: true, wantRole: "developer"},
		{name: "gpt 6 luna effort suffix drops sampling", model: "gpt-6-luna-high", wantModel: "gpt-6-luna", wantEffort: "high", wantRole: "developer"},
		{name: "unknown model keeps parameters", model: "gpt-4.1", wantModel: "gpt-4.1", wantSampling: true, wantMaxTokens: true, wantRole: "system"},
	}
	for _, tt := range tests {
		t.Run(tt.name, func(t *testing.T) {
			c, _ := gin.CreateTestContext(httptest.NewRecorder())
			info := &relaycommon.RelayInfo{
				OriginModelName: tt.model,
				ChannelMeta:     &relaycommon.ChannelMeta{ChannelType: constant.ChannelTypeOpenAI, UpstreamModelName: tt.model},
			}
			request := &dto.GeneralOpenAIRequest{
				Model:           tt.model,
				Messages:        []dto.Message{{Role: "system", Content: "rules"}, {Role: "user", Content: "hi"}},
				MaxTokens:       lo.ToPtr(uint(64)),
				Temperature:     lo.ToPtr(0.2),
				TopP:            lo.ToPtr(0.9),
				LogProbs:        lo.ToPtr(true),
				TopLogProbs:     lo.ToPtr(2),
				ReasoningEffort: tt.effort,
			}
			out, err := (&Adaptor{}).ConvertOpenAIRequest(c, info, request)
			require.NoError(t, err)
			got := out.(*dto.GeneralOpenAIRequest)

			assert.Equal(t, tt.wantModel, got.Model)
			assert.Equal(t, tt.wantEffort, got.ReasoningEffort)
			assert.Equal(t, tt.wantRole, got.Messages[0].Role)
			if tt.wantMaxTokens {
				assert.Equal(t, uint(64), lo.FromPtr(got.MaxTokens))
				assert.Nil(t, got.MaxCompletionTokens)
			} else {
				assert.Nil(t, got.MaxTokens)
				assert.Equal(t, uint(64), lo.FromPtr(got.MaxCompletionTokens))
			}
			assert.Equal(t, tt.wantSampling, got.Temperature != nil)
			assert.Equal(t, tt.wantSampling, got.TopP != nil)
			assert.Equal(t, tt.wantSampling, got.LogProbs != nil)
			assert.Equal(t, tt.wantSampling, got.TopLogProbs != nil)
		})
	}
}
