package relayconvert

import (
	"net/http/httptest"
	"testing"

	"github.com/dev-fan-sophon/boxai/common"
	"github.com/dev-fan-sophon/boxai/constant"
	"github.com/dev-fan-sophon/boxai/dto"
	"github.com/dev-fan-sophon/boxai/setting/reasoning"
	"github.com/gin-gonic/gin"
	"github.com/stretchr/testify/assert"
	"github.com/stretchr/testify/require"
)

func modifierContext(base string, modifiers reasoning.ModelModifiers) *gin.Context {
	ctx, _ := gin.CreateTestContext(httptest.NewRecorder())
	common.SetContextKey(ctx, constant.ContextKeyOriginalModel, base)
	common.SetContextKey(ctx, constant.ContextKeyModelModifiers, modifiers)
	return ctx
}

func TestApplyModelModifiersWithoutModifiersLeavesRequest(t *testing.T) {
	ctx, _ := gin.CreateTestContext(httptest.NewRecorder())
	request := &dto.GeneralOpenAIRequest{Model: "gpt-5-high", ReasoningEffort: "low"}
	require.NoError(t, ApplyModelModifiers(ctx, request))
	assert.Equal(t, "gpt-5-high", request.Model)
	assert.Equal(t, "low", request.ReasoningEffort)
}

func TestApplyModelModifiersOpenAIOverridesRequestEffort(t *testing.T) {
	ctx := modifierContext("gpt-5", reasoning.ModelModifiers{Effort: "xhigh", Thinking: "on"})
	chat := &dto.GeneralOpenAIRequest{Model: "gpt-5@effort:xhigh", ReasoningEffort: "low"}
	require.NoError(t, ApplyModelModifiers(ctx, chat))
	assert.Equal(t, "gpt-5", chat.Model)
	assert.Equal(t, "xhigh", chat.ReasoningEffort)

	ctx = modifierContext("gpt-5", reasoning.ModelModifiers{Effort: "none", Thinking: "off"})
	responses := &dto.OpenAIResponsesRequest{Model: "gpt-5@thinking:off"}
	require.NoError(t, ApplyModelModifiers(ctx, responses))
	require.NotNil(t, responses.Reasoning)
	assert.Equal(t, "none", responses.Reasoning.Effort)
}

func TestApplyModelModifiersClaudeEffortPerModel(t *testing.T) {
	tests := []struct {
		model, effort, wantEffort, wantThinking string
	}{
		{model: "claude-opus-4-7", effort: "xhigh", wantEffort: "xhigh", wantThinking: "adaptive"},
		{model: "claude-opus-4-6", effort: "xhigh", wantEffort: "max", wantThinking: "adaptive"},
		{model: "claude-opus-4-5-20251101", effort: "max", wantEffort: "high", wantThinking: ""},
		{model: "claude-opus-4-7", effort: "minimal", wantEffort: "low", wantThinking: "adaptive"},
	}
	for _, tt := range tests {
		ctx := modifierContext(tt.model, reasoning.ModelModifiers{Effort: tt.effort, Thinking: "on"})
		request := &dto.ClaudeRequest{Model: tt.model + "@effort:" + tt.effort, OutputConfig: []byte(`{"effort":"low","format":"x"}`)}
		require.NoError(t, ApplyModelModifiers(ctx, request), tt.model)
		assert.Equal(t, tt.wantEffort, request.GetEfforts(), tt.model)
		assert.Contains(t, string(request.OutputConfig), `"format":"x"`, "other output_config members stay")
		if tt.wantThinking == "" {
			assert.Nil(t, request.Thinking, tt.model)
		} else {
			require.NotNil(t, request.Thinking, tt.model)
			assert.Equal(t, tt.wantThinking, request.Thinking.Type, tt.model)
		}
	}
}

func TestApplyModelModifiersClaudeManualBudgetAndOff(t *testing.T) {
	maxTokens := uint(8000)
	ctx := modifierContext("claude-sonnet-4-5", reasoning.ModelModifiers{Effort: "medium", Thinking: "on"})
	request := &dto.ClaudeRequest{Model: "claude-sonnet-4-5@effort:medium", MaxTokens: &maxTokens}
	require.NoError(t, ApplyModelModifiers(ctx, request))
	require.NotNil(t, request.Thinking)
	assert.Equal(t, "enabled", request.Thinking.Type)
	assert.Equal(t, 4000, *request.Thinking.BudgetTokens)
	assert.Empty(t, request.GetEfforts(), "models without effort support receive none")

	ctx = modifierContext("claude-opus-4-7", reasoning.ModelModifiers{Effort: "none", Thinking: "off"})
	request = &dto.ClaudeRequest{Model: "claude-opus-4-7@thinking:off", OutputConfig: []byte(`{"effort":"high"}`)}
	require.NoError(t, ApplyModelModifiers(ctx, request))
	assert.Equal(t, "disabled", request.Thinking.Type)
	assert.Nil(t, request.OutputConfig)
}

func TestApplyModelModifiersGeminiBudgetsAndLevels(t *testing.T) {
	ctx := modifierContext("gemini-2.5-pro", reasoning.ModelModifiers{Effort: "max", Thinking: "on"})
	request := &dto.GeminiChatRequest{}
	require.NoError(t, ApplyModelModifiers(ctx, request))
	assert.Equal(t, 32768, *request.GenerationConfig.ThinkingConfig.ThinkingBudget, "2.5 Pro gets its own largest budget")

	ctx = modifierContext("gemini-2.5-flash", reasoning.ModelModifiers{Effort: "max", Thinking: "on"})
	request = &dto.GeminiChatRequest{}
	require.NoError(t, ApplyModelModifiers(ctx, request))
	assert.Equal(t, 24576, *request.GenerationConfig.ThinkingConfig.ThinkingBudget)

	ctx = modifierContext("gemini-2.5-pro", reasoning.ModelModifiers{Effort: "none", Thinking: "off"})
	request = &dto.GeminiChatRequest{}
	require.NoError(t, ApplyModelModifiers(ctx, request))
	assert.Equal(t, 128, *request.GenerationConfig.ThinkingConfig.ThinkingBudget, "2.5 Pro cannot disable thinking")

	ctx = modifierContext("gemini-3-pro-preview", reasoning.ModelModifiers{Effort: "medium", Thinking: "on"})
	request = &dto.GeminiChatRequest{}
	require.NoError(t, ApplyModelModifiers(ctx, request))
	assert.Equal(t, "medium", request.GenerationConfig.ThinkingConfig.ThinkingLevel)
}
