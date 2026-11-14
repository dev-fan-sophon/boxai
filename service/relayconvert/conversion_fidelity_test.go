package relayconvert

import (
	"encoding/base64"
	"testing"

	"github.com/dev-fan-sophon/boxai/common"
	"github.com/dev-fan-sophon/boxai/dto"
	relaycommon "github.com/dev-fan-sophon/boxai/relay/common"
	"github.com/dev-fan-sophon/boxai/types"
	"github.com/stretchr/testify/assert"
	"github.com/stretchr/testify/require"
	"github.com/tidwall/gjson"
)

func namespacedResponsesRequest(t *testing.T) *dto.OpenAIResponsesRequest {
	return &dto.OpenAIResponsesRequest{
		Model: "gpt-test",
		Input: mustRawMessage(t, []map[string]any{
			{"type": "additional_tools", "tools": []map[string]any{
				{"type": "function", "name": "late", "description": "Declared in input"},
			}},
			{"role": "user", "content": "search the docs"},
			{"type": "function_call", "call_id": "call_1", "namespace": "mcp__docs", "name": "search", "arguments": `{"q":"x"}`},
			{"type": "function_call_output", "call_id": "call_1", "output": "found"},
		}),
		Tools: mustRawMessage(t, []map[string]any{
			{"type": "function", "name": "shell"},
			{"type": "namespace", "name": "functions", "tools": []map[string]any{
				{"type": "function", "name": "read"},
			}},
			{"type": "namespace", "name": "mcp__docs", "description": "Docs server", "tools": []map[string]any{
				{"type": "function", "name": "search", "description": "Search pages"},
			}},
			{"type": "namespace", "name": "dup", "tools": []map[string]any{
				// Flattens to "dup__x", colliding with the plain tool below.
				{"type": "function", "name": "x"},
			}},
		}),
		ToolChoice: mustRawMessage(t, map[string]any{"type": "function", "namespace": "mcp__docs", "name": "search"}),
	}
}

func TestConvertResponsesNamespacedToolsToChat(t *testing.T) {
	req := namespacedResponsesRequest(t)
	tools, err := common.Marshal([]map[string]any{{"type": "function", "name": "dup__x"}})
	require.NoError(t, err)
	var all []map[string]any
	require.NoError(t, common.Unmarshal(req.Tools, &all))
	var plain []map[string]any
	require.NoError(t, common.Unmarshal(tools, &plain))
	all = append(plain, all...)
	req.Tools = mustRawMessage(t, all)
	originalTools := string(req.Tools)

	info := &relaycommon.RelayInfo{}
	result, err := ConvertRequestByID(nil, info, ConverterOpenAIResponsesToOpenAIChat, req)
	require.NoError(t, err)
	chatReq, ok := result.Value.(*dto.GeneralOpenAIRequest)
	require.True(t, ok)

	names := make([]string, 0, len(chatReq.Tools))
	for _, tool := range chatReq.Tools {
		names = append(names, tool.Function.Name)
	}
	assert.Equal(t, []string{"dup__x", "shell", "read", "mcp__docs__search", "late"}, names)
	assert.Equal(t, "Docs server\n\nSearch pages", chatReq.Tools[3].Function.Description)
	assert.Equal(t, map[string]any{"type": "function", "function": map[string]any{"name": "mcp__docs__search"}}, chatReq.ToolChoice)

	require.Len(t, chatReq.Messages, 3)
	toolCalls := chatReq.Messages[1].ParseToolCalls()
	require.Len(t, toolCalls, 1)
	assert.Equal(t, "mcp__docs__search", toolCalls[0].Function.Name)

	assert.Equal(t, "mcp__docs", info.ResponsesToolNamespace("mcp__docs__search"))
	assert.Empty(t, info.ResponsesToolNamespace("read"))
	assert.Equal(t, originalTools, string(req.Tools), "the client request is not modified")
}

func TestConvertChatResponseRestoresToolNamespaces(t *testing.T) {
	info := &relaycommon.RelayInfo{}
	info.SetResponsesToolNamespaces(map[string]string{"mcp__docs__search": "mcp__docs"})
	message := dto.Message{Role: "assistant"}
	message.SetToolCalls([]dto.ToolCallRequest{
		{ID: "call_1", Type: "function", Function: dto.FunctionRequest{Name: "mcp__docs__search", Arguments: `{"q":"x"}`}},
		{ID: "call_2", Type: "function", Function: dto.FunctionRequest{Name: "shell", Arguments: `{}`}},
	})
	result, err := ConvertResponse(nil, info, types.RelayFormatOpenAIResponses, &dto.OpenAITextResponse{
		Id:      "resp_1",
		Model:   "gpt-test",
		Choices: []dto.OpenAITextResponseChoice{{Message: message, FinishReason: "tool_calls"}},
	})
	require.NoError(t, err)
	raw, err := common.Marshal(result.Value)
	require.NoError(t, err)
	assert.Equal(t, "search", gjson.GetBytes(raw, "output.0.name").String())
	assert.Equal(t, "mcp__docs", gjson.GetBytes(raw, "output.0.namespace").String())
	assert.Equal(t, "shell", gjson.GetBytes(raw, "output.1.name").String())
	assert.False(t, gjson.GetBytes(raw, "output.1.namespace").Exists())

	state, err := NewResponseStreamState(types.RelayFormatOpenAI, types.RelayFormatOpenAIResponses, ResponseStreamOptions{ID: "resp_1", Model: "gpt-test"})
	require.NoError(t, err)
	index := 0
	_, err = ConvertStreamResponseChunk(nil, info, state, &dto.ChatCompletionsStreamResponse{
		Choices: []dto.ChatCompletionsStreamResponseChoice{{Delta: dto.ChatCompletionsStreamResponseChoiceDelta{ToolCalls: []dto.ToolCallResponse{
			{Index: &index, ID: "call_1", Type: "function", Function: dto.FunctionResponse{Name: "mcp__docs__search", Arguments: `{"q":"x"}`}},
		}}}},
	})
	require.NoError(t, err)
	final, err := FinalizeStreamResponse(nil, info, state)
	require.NoError(t, err)
	require.NotEmpty(t, final)
	completed, ok := final[len(final)-1].Value.(ChatToResponsesStreamEvent)
	require.True(t, ok)
	require.NotNil(t, completed.Payload.Response)
	require.Len(t, completed.Payload.Response.Output, 1)
	assert.Equal(t, "search", completed.Payload.Response.Output[0].Name)
	assert.Equal(t, "mcp__docs", completed.Payload.Response.Output[0].Namespace)
}

func TestConvertGeminiOpenAPISchemaToChatJSONSchema(t *testing.T) {
	result, err := ConvertRequest(nil, &relaycommon.RelayInfo{}, types.RelayFormatOpenAI, &dto.GeminiChatRequest{
		Contents: []dto.GeminiChatContent{{Role: "user", Parts: []dto.GeminiPart{{Text: "hi"}}}},
		Tools: mustRawMessage(t, []map[string]any{{"functionDeclarations": []map[string]any{
			{"name": "lookup", "parameters": map[string]any{
				"type":             "OBJECT",
				"propertyOrdering": []any{"q"},
				"properties": map[string]any{
					"q":     map[string]any{"type": "STRING", "nullable": true, "maxLength": "10", "example": "a"},
					"level": map[string]any{"type": "INTEGER", "enum": []any{"1", "2"}, "nullable": true},
				},
			}},
			{"name": "raw", "parametersJsonSchema": map[string]any{"type": "object", "properties": map[string]any{"a": map[string]any{"type": "string"}}}},
		}}}),
	})
	require.NoError(t, err)
	chatReq, ok := result.Value.(*dto.GeneralOpenAIRequest)
	require.True(t, ok)
	require.Len(t, chatReq.Tools, 2)
	assert.Equal(t, map[string]any{
		"type": "object",
		"properties": map[string]any{
			"q":     map[string]any{"type": []any{"string", "null"}, "maxLength": int64(10), "examples": []any{"a"}},
			"level": map[string]any{"type": []any{"integer", "null"}, "enum": []any{"1", "2", nil}},
		},
	}, chatReq.Tools[0].Function.Parameters)
	assert.Equal(t, map[string]any{"type": "object", "properties": map[string]any{"a": map[string]any{"type": "string"}}}, chatReq.Tools[1].Function.Parameters)
}

func TestConvertClaudeImageAndDocumentSourcesToChat(t *testing.T) {
	result, err := ConvertRequest(nil, &relaycommon.RelayInfo{}, types.RelayFormatOpenAI, &dto.ClaudeRequest{
		Model: "claude-test",
		Messages: []dto.ClaudeMessage{{Role: "user", Content: []dto.ClaudeMediaMessage{
			{Type: "image", Source: &dto.ClaudeMessageSource{Type: "url", Url: "https://example.test/a.png"}},
			{Type: "image", Source: &dto.ClaudeMessageSource{Type: "file"}},
			{Type: "document", Source: &dto.ClaudeMessageSource{Type: "base64", MediaType: "application/pdf", Data: "JVBERi0="}},
			{Type: "document", Source: &dto.ClaudeMessageSource{Type: "text", MediaType: "text/plain", Data: "plain notes"}},
			{Type: "document", Source: &dto.ClaudeMessageSource{Type: "url", Url: "https://example.test/a.pdf"}},
		}}},
	})
	require.NoError(t, err)
	chatReq, ok := result.Value.(*dto.GeneralOpenAIRequest)
	require.True(t, ok)
	require.Len(t, chatReq.Messages, 1)
	wire, err := common.Marshal(chatReq.Messages[0])
	require.NoError(t, err)
	assert.JSONEq(t, `[
		{"type":"image_url","image_url":{"url":"https://example.test/a.png"}},
		{"type":"file","file":{"filename":"document.pdf","file_data":"data:application/pdf;base64,JVBERi0="}},
		{"type":"text","text":"plain notes"}
	]`, gjson.GetBytes(wire, "content").Raw)
}

func TestConvertChatToClaudeToolControls(t *testing.T) {
	tests := []struct {
		name       string
		tools      []dto.ToolCallRequest
		effort     string
		toolChoice any
		want       any
	}{
		{name: "no tools omits tool_choice", toolChoice: "required", want: nil},
		{name: "forced choice with manual thinking becomes auto", tools: []dto.ToolCallRequest{{Type: "function", Function: dto.FunctionRequest{Name: "lookup", Parameters: map[string]any{"type": "object"}}}},
			effort: "low", toolChoice: map[string]any{"type": "function", "function": map[string]any{"name": "lookup"}}, want: &dto.ClaudeToolChoice{Type: "auto"}},
		{name: "forced choice without thinking is kept", tools: []dto.ToolCallRequest{{Type: "function", Function: dto.FunctionRequest{Name: "lookup", Parameters: map[string]any{"type": "object"}}}},
			toolChoice: "required", want: &dto.ClaudeToolChoice{Type: "any"}},
	}
	for _, tt := range tests {
		t.Run(tt.name, func(t *testing.T) {
			result, err := ConvertRequest(nil, &relaycommon.RelayInfo{}, types.RelayFormatClaude, &dto.GeneralOpenAIRequest{
				Model:           "claude-test",
				Messages:        []dto.Message{{Role: "user", Content: "hi"}},
				Tools:           tt.tools,
				ToolChoice:      tt.toolChoice,
				ReasoningEffort: tt.effort,
			})
			require.NoError(t, err)
			claudeReq, ok := result.Value.(*dto.ClaudeRequest)
			require.True(t, ok)
			if tt.want == nil {
				assert.Nil(t, claudeReq.ToolChoice)
				return
			}
			assert.Equal(t, tt.want, claudeReq.ToolChoice)
		})
	}
}

func TestChatFilePartReachesResponsesAsInputFile(t *testing.T) {
	result, err := ConvertRequest(nil, &relaycommon.RelayInfo{}, types.RelayFormatOpenAIResponses, &dto.GeneralOpenAIRequest{
		Model: "gpt-test",
		Messages: []dto.Message{{Role: "user", Content: []any{
			map[string]any{"type": "file", "file": map[string]any{"filename": "a.pdf", "file_data": "data:application/pdf;base64," + base64.StdEncoding.EncodeToString([]byte("%PDF"))}},
		}}},
	})
	require.NoError(t, err)
	responsesReq, ok := result.Value.(*dto.OpenAIResponsesRequest)
	require.True(t, ok)
	part := gjson.GetBytes(responsesReq.Input, "0.content.0")
	assert.Equal(t, "input_file", part.Get("type").String())
	assert.Equal(t, "a.pdf", part.Get("filename").String())
	assert.Equal(t, "data:application/pdf;base64,JVBERg==", part.Get("file_data").String())
	assert.False(t, part.Get("file").Exists())
}
