package gemini

import (
	"testing"

	"github.com/dev-fan-sophon/boxai/dto"
	relaycommon "github.com/dev-fan-sophon/boxai/relay/common"
	"github.com/dev-fan-sophon/boxai/setting/model_setting"
	"github.com/stretchr/testify/assert"
	"github.com/stretchr/testify/require"
)

func TestApplyThinkingConfigMapsEffortSuffixPerModel(t *testing.T) {
	settings := model_setting.GetGeminiSettings()
	original := settings.ThinkingAdapterEnabled
	settings.ThinkingAdapterEnabled = true
	t.Cleanup(func() { settings.ThinkingAdapterEnabled = original })

	tests := []struct {
		model     string
		wantLevel string
	}{
		{model: "gemini-4-argon-minimal", wantLevel: "low"},
		{model: "gemini-4-argon-xhigh", wantLevel: "high"},
		{model: "gemini-4-argon-max", wantLevel: "max"},
		{model: "gemini-4-argon-medium", wantLevel: "medium"},
		{model: "gemini-4-hydrogen-minimal", wantLevel: "low"},
		{model: "gemini-4-hydrogen-xhigh", wantLevel: "xhigh"},
		{model: "gemini-4-hydrogen-max", wantLevel: "max"},
		{model: "gemini-3-flash-preview-minimal", wantLevel: "minimal"},
	}
	for _, tt := range tests {
		t.Run(tt.model, func(t *testing.T) {
			info := &relaycommon.RelayInfo{ChannelMeta: &relaycommon.ChannelMeta{UpstreamModelName: tt.model}}
			request := &dto.GeminiChatRequest{}

			ApplyThinkingConfig(request, info)

			require.NotNil(t, request.GenerationConfig.ThinkingConfig)
			assert.Equal(t, tt.wantLevel, request.GenerationConfig.ThinkingConfig.ThinkingLevel)
			assert.True(t, request.GenerationConfig.ThinkingConfig.IncludeThoughts)
			assert.Equal(t, tt.wantLevel, info.ReasoningEffort)
		})
	}
}
