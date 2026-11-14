package dto

import (
	"testing"

	"github.com/dev-fan-sophon/boxai/common"
	"github.com/stretchr/testify/assert"
	"github.com/stretchr/testify/require"
	"github.com/tidwall/gjson"
)

func TestGeneralOpenAIRequestPreserveExplicitZeroValues(t *testing.T) {
	raw := []byte(`{
		"model":"gpt-4.1",
		"stream":false,
		"max_tokens":0,
		"max_completion_tokens":0,
		"top_p":0,
		"top_k":0,
		"n":0,
		"frequency_penalty":0,
		"presence_penalty":0,
		"seed":0,
		"logprobs":false,
		"top_logprobs":0,
		"dimensions":0,
		"return_images":false,
		"return_related_questions":false
	}`)

	var req GeneralOpenAIRequest
	err := common.Unmarshal(raw, &req)
	require.NoError(t, err)

	encoded, err := common.Marshal(req)
	require.NoError(t, err)

	require.True(t, gjson.GetBytes(encoded, "stream").Exists())
	require.True(t, gjson.GetBytes(encoded, "max_tokens").Exists())
	require.True(t, gjson.GetBytes(encoded, "max_completion_tokens").Exists())
	require.True(t, gjson.GetBytes(encoded, "top_p").Exists())
	require.True(t, gjson.GetBytes(encoded, "top_k").Exists())
	require.True(t, gjson.GetBytes(encoded, "n").Exists())
	require.True(t, gjson.GetBytes(encoded, "frequency_penalty").Exists())
	require.True(t, gjson.GetBytes(encoded, "presence_penalty").Exists())
	require.True(t, gjson.GetBytes(encoded, "seed").Exists())
	require.True(t, gjson.GetBytes(encoded, "logprobs").Exists())
	require.True(t, gjson.GetBytes(encoded, "top_logprobs").Exists())
	require.True(t, gjson.GetBytes(encoded, "dimensions").Exists())
	require.True(t, gjson.GetBytes(encoded, "return_images").Exists())
	require.True(t, gjson.GetBytes(encoded, "return_related_questions").Exists())
}

func TestOpenAIResponsesRequestPreserveExplicitZeroValues(t *testing.T) {
	raw := []byte(`{
		"model":"gpt-4.1",
		"max_output_tokens":0,
		"max_tool_calls":0,
		"stream":false,
		"top_p":0,
		"frequency_penalty":0,
		"presence_penalty":0
	}`)

	var req OpenAIResponsesRequest
	err := common.Unmarshal(raw, &req)
	require.NoError(t, err)

	encoded, err := common.Marshal(req)
	require.NoError(t, err)

	require.True(t, gjson.GetBytes(encoded, "max_output_tokens").Exists())
	require.True(t, gjson.GetBytes(encoded, "max_tool_calls").Exists())
	require.True(t, gjson.GetBytes(encoded, "stream").Exists())
	require.True(t, gjson.GetBytes(encoded, "top_p").Exists())
	require.True(t, gjson.GetBytes(encoded, "frequency_penalty").Exists())
	require.True(t, gjson.GetBytes(encoded, "presence_penalty").Exists())
}

func TestThinkingBudgetMarshallingIsLimitedToQwenModels(t *testing.T) {
	zero := 0
	positive := 128
	tests := []struct {
		name    string
		request any
		want    int64
		exists  bool
	}{
		{name: "chat qwen preserves zero", request: GeneralOpenAIRequest{Model: "qwen-plus", ThinkingBudget: &zero}, want: 0, exists: true},
		{name: "chat provider qwq preserves value", request: GeneralOpenAIRequest{Model: "provider/QwQ-32B", ThinkingBudget: &positive}, want: 128, exists: true},
		{name: "chat non-qwen drops value", request: GeneralOpenAIRequest{Model: "gpt-4.1", ThinkingBudget: &positive}, exists: false},
		{name: "responses qwen preserves zero", request: OpenAIResponsesRequest{Model: "Qwen/Qwen3-Thinking", ThinkingBudget: &zero}, want: 0, exists: true},
		{name: "responses non-qwen drops value", request: OpenAIResponsesRequest{Model: "deepseek-r1", ThinkingBudget: &positive}, exists: false},
	}

	for _, test := range tests {
		t.Run(test.name, func(t *testing.T) {
			encoded, err := common.Marshal(test.request)
			require.NoError(t, err)
			value := gjson.GetBytes(encoded, "thinking_budget")
			require.Equal(t, test.exists, value.Exists())
			if test.exists {
				require.Equal(t, test.want, value.Int())
			}
		})
	}
}

func TestIsQwenThinkingBudgetModel(t *testing.T) {
	tests := map[string]bool{
		"qwen-plus":                    true,
		"Qwen/Qwen3-235B-A22B":         true,
		"qwq-32b":                      true,
		"provider/qwq-32b":             true,
		"gpt-4.1":                      false,
		"provider/not-qwen-compatible": false,
	}
	for model, want := range tests {
		t.Run(model, func(t *testing.T) {
			require.Equal(t, want, IsQwenThinkingBudgetModel(model))
		})
	}
}

func TestGeneralOpenAIRequestGetSystemRoleName(t *testing.T) {
	tests := []struct {
		name  string
		model string
		want  string
	}{
		{name: "o1 uses developer", model: "o1", want: "developer"},
		{name: "o3 family uses developer", model: "o3-mini-high", want: "developer"},
		{name: "o4 family uses developer", model: "o4-mini", want: "developer"},
		{name: "o1 mini stays system", model: "o1-mini", want: "system"},
		{name: "o1 preview stays system", model: "o1-preview", want: "system"},
		{name: "gpt 5 uses developer", model: "gpt-5", want: "developer"},
		{name: "gpt 5.6 uses developer", model: "gpt-5.6-luna", want: "developer"},
		{name: "gpt 6 uses developer", model: "gpt-6-astra", want: "developer"},
		{name: "gpt 6 snapshot uses developer", model: "gpt-6-astra-2026-09-03", want: "developer"},
		{name: "unknown gpt 6 variant stays system", model: "gpt-6-astra-pro", want: "system"},
		{name: "invalid gpt 6 snapshot stays system", model: "gpt-6-astra-2026-99-03", want: "system"},
		{name: "unknown generation stays system", model: "gpt-7", want: "system"},
		{name: "gpt 4.1 stays system", model: "gpt-4.1-nano", want: "system"},
		{name: "omni is not o series", model: "omni-moderation-latest", want: "system"},
	}

	for _, tt := range tests {
		t.Run(tt.name, func(t *testing.T) {
			req := GeneralOpenAIRequest{Model: tt.model}

			require.Equal(t, tt.want, req.GetSystemRoleName())
		})
	}
}

func TestIsOpenAIGPT5Model(t *testing.T) {
	tests := []struct {
		model string
		want  bool
	}{
		{model: "gpt-5", want: true},
		{model: "gpt-5-mini", want: true},
		{model: "gpt-5-chat-latest", want: true},
		{model: "gpt-5.6-luna", want: true},
		{model: "gpt-5.4-nano", want: true},
		{model: "gpt-5.2-2025-12-11", want: true},
		{model: "gpt-6-astra", want: false},
		{model: "gpt-50", want: false},
		{model: "gpt-5custom", want: false},
		{model: " GPT-5 ", want: false},
		{model: "gpt-4.1", want: false},
		{model: "gpt-4o", want: false},
		{model: "gpt-oss-120b", want: false},
		{model: "o3-mini", want: false},
		{model: "", want: false},
	}

	for _, tt := range tests {
		t.Run(tt.model, func(t *testing.T) {
			assert.Equal(t, tt.want, IsOpenAIGPT5Model(tt.model))
		})
	}
}

func TestGetOpenAIChatCapabilities(t *testing.T) {
	restricted := OpenAIChatCapabilities{UseMaxCompletionTokens: true, UseDeveloperRole: true}
	sampling := OpenAIChatCapabilities{UseMaxCompletionTokens: true, UseDeveloperRole: true, SupportsTemperature: true, SupportsTopP: true, SupportsLogProbs: true}
	tests := []struct {
		name   string
		model  string
		effort string
		want   OpenAIChatCapabilities
	}{
		{name: "o series drops temperature", model: "o3", want: OpenAIChatCapabilities{UseMaxCompletionTokens: true, UseDeveloperRole: true, SupportsTopP: true, SupportsLogProbs: true}},
		{name: "o1 mini keeps system role", model: "o1-mini", want: OpenAIChatCapabilities{UseMaxCompletionTokens: true, SupportsTopP: true, SupportsLogProbs: true}},
		{name: "gpt 5 drops sampling", model: "gpt-5", want: restricted},
		{name: "gpt 5.2 without reasoning keeps sampling", model: "gpt-5.2", want: sampling},
		{name: "gpt 5.2 none keeps sampling", model: "gpt-5.2-2025-12-11", effort: "none", want: sampling},
		{name: "gpt 5.2 with reasoning drops sampling", model: "gpt-5.2", effort: "high", want: restricted},
		{name: "gpt 5.2 pro drops sampling", model: "gpt-5.2-pro", want: restricted},
		{name: "gpt 6 astra drops sampling", model: "gpt-6-astra", effort: "none", want: restricted},
		{name: "gpt 6 sol without reasoning keeps sampling", model: "gpt-6-sol", want: sampling},
		{name: "gpt 6 luna with reasoning drops sampling", model: "gpt-6-luna-2026-09-30", effort: "high", want: restricted},
		{name: "unknown model keeps everything", model: "gpt-4.1", want: OpenAIChatCapabilities{SupportsTemperature: true, SupportsTopP: true, SupportsLogProbs: true}},
	}
	for _, tt := range tests {
		t.Run(tt.name, func(t *testing.T) {
			assert.Equal(t, tt.want, GetOpenAIChatCapabilities(tt.model, tt.effort))
		})
	}
}
