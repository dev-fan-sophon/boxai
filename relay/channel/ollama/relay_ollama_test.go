package ollama

import (
	"testing"

	"github.com/dev-fan-sophon/boxai/common"
	"github.com/dev-fan-sophon/boxai/dto"

	"github.com/gin-gonic/gin"
	"github.com/stretchr/testify/assert"
	"github.com/stretchr/testify/require"
)

func TestOpenAIChatToOllamaChatPlainTextDefaultsToNonStream(t *testing.T) {
	c, _ := gin.CreateTestContext(nil)
	request, err := openAIChatToOllamaChat(c, &dto.GeneralOpenAIRequest{
		Model: "llama3.1",
		Messages: []dto.Message{
			{Role: "user", Content: "hello"},
		},
	})
	require.NoError(t, err)
	require.Len(t, request.Messages, 1)
	assert.Equal(t, "user", request.Messages[0].Role)
	assert.Equal(t, "hello", request.Messages[0].Content)
	assert.Empty(t, request.Messages[0].Thinking)
	assert.Empty(t, request.Messages[0].ToolCalls)

	wire, err := common.Marshal(request)
	require.NoError(t, err)
	var fields map[string]any
	require.NoError(t, common.Unmarshal(wire, &fields))
	stream, ok := fields["stream"]
	require.True(t, ok, "Ollama defaults to streaming, so false must be sent explicitly")
	assert.Equal(t, false, stream)
}

func TestOpenAIChatToOllamaChatPreservesReasoningAndToolContext(t *testing.T) {
	c, _ := gin.CreateTestContext(nil)
	reasoning := "I need both tools"
	emptyReasoning := ""
	explicitToolName := "clock"
	toolCalls, err := common.Marshal([]dto.ToolCallRequest{
		{
			ID:   "call_weather",
			Type: "function",
			Function: dto.FunctionRequest{
				Name:      "get_weather",
				Arguments: `{"city":"Hanoi","days":0}`,
			},
		},
		{
			ID:   "call_time",
			Type: "function",
			Function: dto.FunctionRequest{
				Name:      "get_time",
				Arguments: `{"zone":"Asia/Ho_Chi_Minh"}`,
			},
		},
	})
	require.NoError(t, err)

	request, err := openAIChatToOllamaChat(c, &dto.GeneralOpenAIRequest{
		Model: "qwen3",
		Messages: []dto.Message{
			{Role: "user", Content: "Should I carry an umbrella?"},
			{
				Role:             "assistant",
				Content:          "I'll check.",
				ReasoningContent: &reasoning,
				ToolCalls:        toolCalls,
			},
			{Role: "tool", Content: `{"rain":true}`, ToolCallId: "call_weather"},
			{Role: "tool", Content: `{"time":"08:00"}`, ToolCallId: "call_time", Name: &explicitToolName},
			{Role: "assistant", Content: "Yes.", ReasoningContent: &emptyReasoning},
		},
	})
	require.NoError(t, err)
	require.Len(t, request.Messages, 5)

	var thinking string
	require.NoError(t, common.Unmarshal(request.Messages[1].Thinking, &thinking))
	assert.Equal(t, reasoning, thinking)
	require.Len(t, request.Messages[1].ToolCalls, 2)
	assert.Equal(t, "call_weather", request.Messages[1].ToolCalls[0].ID)
	assert.Equal(t, "get_weather", request.Messages[1].ToolCalls[0].Function.Name)
	assert.Equal(t, "call_time", request.Messages[1].ToolCalls[1].ID)
	assert.Equal(t, "get_time", request.Messages[1].ToolCalls[1].Function.Name)

	weatherArgs, ok := request.Messages[1].ToolCalls[0].Function.Arguments.(map[string]any)
	require.True(t, ok)
	assert.Equal(t, "Hanoi", weatherArgs["city"])
	assert.Equal(t, float64(0), weatherArgs["days"])

	assert.Equal(t, "call_weather", request.Messages[2].ToolCallID)
	assert.Equal(t, "get_weather", request.Messages[2].ToolName)
	assert.Equal(t, "call_time", request.Messages[3].ToolCallID)
	assert.Equal(t, explicitToolName, request.Messages[3].ToolName)
	var finalThinking string
	require.NoError(t, common.Unmarshal(request.Messages[4].Thinking, &finalThinking))
	assert.Empty(t, finalThinking, "an explicitly empty reasoning value must remain present")
}

func TestOpenAIChatToOllamaChatReasoningConfiguration(t *testing.T) {
	c, _ := gin.CreateTestContext(nil)
	tests := []struct {
		name      string
		request   dto.GeneralOpenAIRequest
		wantThink string
		wantError string
	}{
		{
			name: "omitted",
		},
		{
			name:      "none disables thinking",
			request:   dto.GeneralOpenAIRequest{ReasoningEffort: "none"},
			wantThink: "false",
		},
		{
			name:      "reasoning object overrides chat effort",
			request:   dto.GeneralOpenAIRequest{ReasoningEffort: "low", Reasoning: []byte(`{"effort":"high"}`)},
			wantThink: `"high"`,
		},
		{
			name:      "native think takes precedence",
			request:   dto.GeneralOpenAIRequest{Think: []byte("false"), Reasoning: []byte(`{"effort":"invalid"}`)},
			wantThink: "false",
		},
		{
			name:      "unsupported effort",
			request:   dto.GeneralOpenAIRequest{ReasoningEffort: "minimal"},
			wantError: "unsupported ollama reasoning effort",
		},
		{
			name:      "malformed reasoning",
			request:   dto.GeneralOpenAIRequest{Reasoning: []byte(`{"effort"`)},
			wantError: "invalid ollama reasoning",
		},
	}

	for _, tt := range tests {
		t.Run(tt.name, func(t *testing.T) {
			converted, err := openAIChatToOllamaChat(c, &tt.request)
			if tt.wantError != "" {
				require.ErrorContains(t, err, tt.wantError)
				return
			}
			require.NoError(t, err)
			if tt.wantThink == "" {
				assert.Empty(t, converted.Think)
				return
			}
			assert.JSONEq(t, tt.wantThink, string(converted.Think))
		})
	}
}

func TestOpenAIChatToOllamaChatRejectsMalformedToolContext(t *testing.T) {
	c, _ := gin.CreateTestContext(nil)
	toolCallWithInvalidArguments, err := common.Marshal([]dto.ToolCallRequest{
		{Type: "function", Function: dto.FunctionRequest{Name: "lookup", Arguments: `{"id"`}},
	})
	require.NoError(t, err)

	tests := []struct {
		name      string
		toolCalls []byte
		wantError string
	}{
		{name: "tool calls", toolCalls: []byte("["), wantError: "invalid ollama tool calls"},
		{name: "arguments", toolCalls: toolCallWithInvalidArguments, wantError: `invalid arguments for ollama tool "lookup"`},
	}
	for _, tt := range tests {
		t.Run(tt.name, func(t *testing.T) {
			_, err := openAIChatToOllamaChat(c, &dto.GeneralOpenAIRequest{
				Messages: []dto.Message{{Role: "assistant", ToolCalls: tt.toolCalls}},
			})
			require.ErrorContains(t, err, tt.wantError)
		})
	}
}

func TestOllamaResponseFormatConversion(t *testing.T) {
	schema, err := toOllamaResponseFormat(&dto.ResponseFormat{
		Type:       "json_schema",
		JsonSchema: []byte(`{"name":"weather","schema":{"type":"object","required":["city"]}}`),
	})
	require.NoError(t, err)
	assert.Equal(t, map[string]any{
		"type":     "object",
		"required": []any{"city"},
	}, schema)

	jsonObject, err := toOllamaResponseFormat(&dto.ResponseFormat{Type: "json_object"})
	require.NoError(t, err)
	assert.Equal(t, "json", jsonObject)

	_, err = toOllamaResponseFormat(&dto.ResponseFormat{Type: "json_schema", JsonSchema: []byte("{")})
	require.ErrorContains(t, err, "invalid ollama response format")

	generate, err := openAIToGenerate(nil, &dto.GeneralOpenAIRequest{
		ResponseFormat: &dto.ResponseFormat{Type: "json_object"},
	})
	require.NoError(t, err)
	assert.Equal(t, "json", generate.Format)
	wire, err := common.Marshal(generate)
	require.NoError(t, err)
	assert.Contains(t, string(wire), `"stream":false`)
}
