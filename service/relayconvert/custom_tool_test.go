package relayconvert

import (
	"net/http/httptest"
	"testing"

	"github.com/dev-fan-sophon/boxai/common"
	"github.com/dev-fan-sophon/boxai/dto"
	relaycommon "github.com/dev-fan-sophon/boxai/relay/common"
	"github.com/dev-fan-sophon/boxai/types"
	"github.com/gin-gonic/gin"
	"github.com/stretchr/testify/assert"
	"github.com/stretchr/testify/require"
	"github.com/tidwall/gjson"
)

// customToolRawInput looks like JSON but is a freeform string that must reach
// the upstream, and come back to the client, byte for byte.
const customToolRawInput = `{"cmd":["ls","-la"],"note":"a \"quoted\" <tag>"}`

func customToolResponsesRequest(t *testing.T) *dto.OpenAIResponsesRequest {
	return &dto.OpenAIResponsesRequest{
		Model: "gpt-test",
		Input: mustRawMessage(t, []map[string]any{
			{"role": "user", "content": "run things"},
			{"type": "custom_tool_call", "call_id": "call_exec", "name": "exec", "input": customToolRawInput},
			{"type": "function_call", "call_id": "call_lookup", "name": "lookup", "arguments": `{"q":"x"}`},
			{"type": "custom_tool_call", "call_id": "call_patch", "name": "apply_patch", "input": "*** Begin Patch"},
			{"type": "custom_tool_call_output", "call_id": "call_exec", "output": "exec ok"},
			{"type": "function_call_output", "call_id": "call_lookup", "output": "lookup ok"},
			{"type": "custom_tool_call_output", "call_id": "call_patch", "output": "patch ok"},
		}),
		Tools: mustRawMessage(t, []map[string]any{
			{"type": "function", "name": "lookup", "description": "Lookup data", "parameters": map[string]any{"type": "object", "properties": map[string]any{"q": map[string]any{"type": "string"}}}},
			{"type": "custom", "name": "exec", "description": "Run a shell command", "format": map[string]any{"type": "grammar", "syntax": "lark", "definition": "start: /.+/"}},
			{"type": "custom", "name": "apply_patch", "format": map[string]any{"type": "text"}},
		}),
		ToolChoice: mustRawMessage(t, map[string]any{"type": "custom", "name": "exec"}),
	}
}

func TestConvertResponsesCustomToolsToChat(t *testing.T) {
	info := &relaycommon.RelayInfo{}
	result, err := ConvertRequestByID(nil, info, ConverterOpenAIResponsesToOpenAIChat, customToolResponsesRequest(t))
	require.NoError(t, err)
	chatReq, ok := result.Value.(*dto.GeneralOpenAIRequest)
	require.True(t, ok)

	require.Len(t, chatReq.Tools, 3)
	assert.Equal(t, "lookup", chatReq.Tools[0].Function.Name)
	for i, name := range []string{"exec", "apply_patch"} {
		tool := chatReq.Tools[i+1]
		assert.Equal(t, "function", tool.Type)
		assert.Equal(t, name, tool.Function.Name)
		assert.Empty(t, tool.Custom)
		assert.Equal(t, map[string]any{
			"type": "object",
			"properties": map[string]any{
				"input": map[string]any{"type": "string", "description": "Raw input for the tool."},
			},
			"required":             []any{"input"},
			"additionalProperties": false,
		}, tool.Function.Parameters)
	}
	assert.Equal(t, "Run a shell command\n\nThis tool takes freeform text. Put the complete raw text in the \"input\" argument.\n\nThe input must match this Lark grammar:\nstart: /.+/", chatReq.Tools[1].Function.Description)
	assert.Equal(t, "This tool takes freeform text. Put the complete raw text in the \"input\" argument.", chatReq.Tools[2].Function.Description)
	assert.Equal(t, map[string]any{"type": "function", "function": map[string]any{"name": "exec"}}, chatReq.ToolChoice)

	// Parallel calls stay in one assistant message and each result pairs by call ID.
	require.Len(t, chatReq.Messages, 5)
	toolCalls := chatReq.Messages[1].ParseToolCalls()
	require.Len(t, toolCalls, 3)
	assert.Equal(t, []string{"call_exec", "call_lookup", "call_patch"}, []string{toolCalls[0].ID, toolCalls[1].ID, toolCalls[2].ID})
	for _, toolCall := range toolCalls {
		assert.Equal(t, "function", toolCall.Type)
	}
	assert.Equal(t, gjson.String, gjson.Get(toolCalls[0].Function.Arguments, "input").Type)
	assert.Equal(t, customToolRawInput, gjson.Get(toolCalls[0].Function.Arguments, "input").String())
	assert.Equal(t, `{"q":"x"}`, toolCalls[1].Function.Arguments)
	assert.Equal(t, "*** Begin Patch", gjson.Get(toolCalls[2].Function.Arguments, "input").String())
	for i, want := range []struct{ id, content string }{{"call_exec", "exec ok"}, {"call_lookup", "lookup ok"}, {"call_patch", "patch ok"}} {
		message := chatReq.Messages[i+2]
		assert.Equal(t, "tool", message.Role)
		assert.Equal(t, want.id, message.ToolCallId)
		assert.Equal(t, want.content, message.StringContent())
	}

	assert.True(t, info.IsResponsesCustomTool("exec"))
	assert.True(t, info.IsResponsesCustomTool("apply_patch"))
	assert.False(t, info.IsResponsesCustomTool("lookup"))
}

func TestConvertResponsesCustomToolNameConflictAndUnsentChoice(t *testing.T) {
	info := &relaycommon.RelayInfo{}
	result, err := ConvertRequestByID(nil, info, ConverterOpenAIResponsesToOpenAIChat, &dto.OpenAIResponsesRequest{
		Model: "gpt-test",
		Input: mustRawMessage(t, "hi"),
		Tools: mustRawMessage(t, []map[string]any{
			{"type": "function", "name": "exec", "parameters": map[string]any{"type": "object"}},
			{"type": "custom", "name": "exec"},
		}),
		ToolChoice: mustRawMessage(t, map[string]any{"type": "custom", "name": "exec"}),
	})
	require.NoError(t, err)
	chatReq := result.Value.(*dto.GeneralOpenAIRequest)

	// The conflicting custom tool cannot be told apart from the function, so it
	// is neither sent nor restored, and a choice forcing it is dropped.
	require.Len(t, chatReq.Tools, 1)
	assert.Equal(t, map[string]any{"type": "object"}, chatReq.Tools[0].Function.Parameters)
	assert.Nil(t, chatReq.ToolChoice)
	assert.False(t, info.IsResponsesCustomTool("exec"))
}

func TestConvertResponsesCustomToolsToClaude(t *testing.T) {
	info := &relaycommon.RelayInfo{}
	result, err := ConvertRequest(nil, info, types.RelayFormatClaude, customToolResponsesRequest(t))
	require.NoError(t, err)
	claudeReq, ok := result.Value.(*dto.ClaudeRequest)
	require.True(t, ok)

	raw, err := common.Marshal(claudeReq)
	require.NoError(t, err)
	assert.Equal(t, []any{"lookup", "exec", "apply_patch"}, gjson.GetBytes(raw, "tools.#.name").Value())
	assert.Equal(t, "string", gjson.GetBytes(raw, "tools.1.input_schema.properties.input.type").String())
	assert.Equal(t, "tool", gjson.GetBytes(raw, "tool_choice.type").String())
	assert.Equal(t, "exec", gjson.GetBytes(raw, "tool_choice.name").String())

	// messages: user, assistant (three tool_use blocks), user (three tool_result blocks).
	require.Len(t, claudeReq.Messages, 3)
	assert.Equal(t, []any{"tool_use", "tool_use", "tool_use"}, gjson.GetBytes(raw, "messages.1.content.#.type").Value())
	assert.Equal(t, []any{"call_exec", "call_lookup", "call_patch"}, gjson.GetBytes(raw, "messages.1.content.#.id").Value())
	assert.Equal(t, gjson.String, gjson.GetBytes(raw, "messages.1.content.0.input.input").Type)
	assert.Equal(t, customToolRawInput, gjson.GetBytes(raw, "messages.1.content.0.input.input").String())
	assert.Equal(t, "x", gjson.GetBytes(raw, "messages.1.content.1.input.q").String())
	assert.Equal(t, []any{"call_exec", "call_lookup", "call_patch"}, gjson.GetBytes(raw, "messages.2.content.#.tool_use_id").Value())

	assert.True(t, info.IsResponsesCustomTool("exec"))
}

func TestConvertResponsesCustomToolsToGemini(t *testing.T) {
	info := &relaycommon.RelayInfo{ChannelMeta: &relaycommon.ChannelMeta{UpstreamModelName: "gemini-test"}}
	req := customToolResponsesRequest(t)
	req.Model = "gemini-test"
	result, err := ConvertRequest(nil, info, types.RelayFormatGemini, req)
	require.NoError(t, err)
	geminiReq, ok := result.Value.(*dto.GeminiChatRequest)
	require.True(t, ok)

	assert.Equal(t, []any{"lookup", "exec", "apply_patch"}, gjson.GetBytes(geminiReq.Tools, "0.functionDeclarations.#.name").Value())
	require.NotNil(t, geminiReq.ToolConfig)
	assert.Equal(t, dto.FunctionCallingConfigMode("ANY"), geminiReq.ToolConfig.FunctionCallingConfig.Mode)
	assert.Equal(t, []string{"exec"}, geminiReq.ToolConfig.FunctionCallingConfig.AllowedFunctionNames)

	require.Len(t, geminiReq.Contents, 3)
	calls := geminiReq.Contents[1].Parts
	require.Len(t, calls, 3)
	assert.Equal(t, map[string]any{"input": customToolRawInput}, calls[0].FunctionCall.Arguments)
	assert.Equal(t, map[string]any{"q": "x"}, calls[1].FunctionCall.Arguments)
	responses := geminiReq.Contents[2].Parts
	require.Len(t, responses, 3)
	for i, name := range []string{"exec", "lookup", "apply_patch"} {
		require.NotNil(t, responses[i].FunctionResponse)
		assert.Equal(t, name, responses[i].FunctionResponse.Name)
	}
	assert.True(t, info.IsResponsesCustomTool("apply_patch"))
}

func TestConvertChatResponseRestoresCustomToolCalls(t *testing.T) {
	info := &relaycommon.RelayInfo{}
	info.SetResponsesCustomToolNames(map[string]struct{}{"exec": {}})
	message := dto.Message{Role: "assistant"}
	message.SetToolCalls([]dto.ToolCallRequest{
		{ID: "call_exec", Type: "function", Function: dto.FunctionRequest{Name: "exec", Arguments: mustArguments(t, customToolRawInput)}},
		{ID: "call_lookup", Type: "function", Function: dto.FunctionRequest{Name: "lookup", Arguments: `{"q":"x"}`}},
		{ID: "call_nameless", Type: "function", Function: dto.FunctionRequest{Arguments: `{}`}},
	})
	result, err := ConvertResponse(nil, info, types.RelayFormatOpenAIResponses, &dto.OpenAITextResponse{
		Id:      "resp_1",
		Model:   "gpt-test",
		Choices: []dto.OpenAITextResponseChoice{{Message: message, FinishReason: "tool_calls"}},
	})
	require.NoError(t, err)

	raw, err := common.Marshal(result.Value)
	require.NoError(t, err)
	assert.JSONEq(t, `[
		{"type":"custom_tool_call","id":"call_exec","status":"completed","call_id":"call_exec","name":"exec","input":`+string(mustRawMessage(t, customToolRawInput))+`},
		{"type":"function_call","id":"call_lookup","status":"completed","call_id":"call_lookup","name":"lookup","arguments":"{\"q\":\"x\"}","role":"","content":null,"quality":"","size":""}
	]`, gjson.GetBytes(raw, "output").Raw)
}

func TestConvertChatStreamRestoresCustomToolCalls(t *testing.T) {
	info := &relaycommon.RelayInfo{}
	info.SetResponsesCustomToolNames(map[string]struct{}{"exec": {}})
	state, err := NewResponseStreamState(types.RelayFormatOpenAI, types.RelayFormatOpenAIResponses, ResponseStreamOptions{ID: "resp_1", Model: "gpt-test"})
	require.NoError(t, err)

	arguments := mustArguments(t, customToolRawInput)
	chunks := []dto.ChatCompletionsStreamResponse{
		// A nameless first fragment is held until its name arrives.
		{Choices: []dto.ChatCompletionsStreamResponseChoice{{Delta: dto.ChatCompletionsStreamResponseChoiceDelta{ToolCalls: []dto.ToolCallResponse{
			{Index: respPtr(0), Function: dto.FunctionResponse{Arguments: arguments[:7]}},
		}}}}},
		{Choices: []dto.ChatCompletionsStreamResponseChoice{{Delta: dto.ChatCompletionsStreamResponseChoiceDelta{ToolCalls: []dto.ToolCallResponse{
			{Index: respPtr(0), ID: "call_exec", Function: dto.FunctionResponse{Name: "exec", Arguments: arguments[7:20]}},
			{Index: respPtr(1), ID: "call_lookup", Function: dto.FunctionResponse{Name: "lookup", Arguments: `{"q":`}},
		}}}}},
		{Choices: []dto.ChatCompletionsStreamResponseChoice{{Delta: dto.ChatCompletionsStreamResponseChoiceDelta{ToolCalls: []dto.ToolCallResponse{
			{Index: respPtr(0), Function: dto.FunctionResponse{Arguments: arguments[20:]}},
			{Index: respPtr(1), Function: dto.FunctionResponse{Arguments: `"x"}`}},
			// A call whose name never arrives leaves nothing behind.
			{Index: respPtr(2), Function: dto.FunctionResponse{Arguments: `{}`}},
		}}}}},
		{Choices: []dto.ChatCompletionsStreamResponseChoice{{FinishReason: respPtr("tool_calls")}}},
	}
	var events []ChatToResponsesStreamEvent
	for i := range chunks {
		results, err := ConvertStreamResponseChunk(nil, info, state, &chunks[i])
		require.NoError(t, err)
		for _, result := range results {
			events = append(events, result.Value.(ChatToResponsesStreamEvent))
		}
	}
	finalResults, err := FinalizeStreamResponse(nil, info, state)
	require.NoError(t, err)
	for _, result := range finalResults {
		events = append(events, result.Value.(ChatToResponsesStreamEvent))
	}

	type summary struct {
		Type, ItemID, ItemType, Delta string
		OutputIndex                   int
	}
	got := make([]summary, 0, len(events))
	for _, event := range events {
		entry := summary{Type: event.Type, ItemID: event.Payload.ItemID, Delta: event.Payload.Delta, OutputIndex: -1}
		if event.Payload.OutputIndex != nil {
			entry.OutputIndex = *event.Payload.OutputIndex
		}
		if event.Payload.Item != nil {
			entry.ItemType = event.Payload.Item.Type
			entry.ItemID = event.Payload.Item.ID
		}
		got = append(got, entry)
	}
	assert.Equal(t, []summary{
		{Type: "response.created", OutputIndex: -1},
		{Type: "response.output_item.added", ItemID: "call_exec", ItemType: "custom_tool_call", OutputIndex: 0},
		{Type: "response.output_item.added", ItemID: "call_lookup", ItemType: "function_call", OutputIndex: 1},
		{Type: "response.function_call_arguments.delta", ItemID: "call_lookup", Delta: `{"q":`, OutputIndex: 1},
		{Type: "response.function_call_arguments.delta", ItemID: "call_lookup", Delta: `"x"}`, OutputIndex: 1},
		{Type: "response.custom_tool_call_input.delta", ItemID: "call_exec", Delta: customToolRawInput, OutputIndex: 0},
		{Type: "response.custom_tool_call_input.done", ItemID: "call_exec", OutputIndex: 0},
		{Type: "response.output_item.done", ItemID: "call_exec", ItemType: "custom_tool_call", OutputIndex: 0},
		{Type: "response.function_call_arguments.done", ItemID: "call_lookup", OutputIndex: 1},
		{Type: "response.output_item.done", ItemID: "call_lookup", ItemType: "function_call", OutputIndex: 1},
		{Type: "response.completed", OutputIndex: -1},
	}, got)

	require.NotNil(t, events[6].Payload.Input)
	assert.Equal(t, customToolRawInput, *events[6].Payload.Input)
	require.NotNil(t, events[8].Payload.Arguments)
	assert.Equal(t, `{"q":"x"}`, *events[8].Payload.Arguments)

	added, err := common.Marshal(events[1].Payload)
	require.NoError(t, err)
	assert.JSONEq(t, `{"type":"custom_tool_call","id":"call_exec","status":"in_progress","call_id":"call_exec","name":"exec","input":""}`, gjson.GetBytes(added, "item").Raw)
	itemDone, err := common.Marshal(events[7].Payload)
	require.NoError(t, err)
	assert.Equal(t, customToolRawInput, gjson.GetBytes(itemDone, "item.input").String())
	assert.False(t, gjson.GetBytes(itemDone, "item.arguments").Exists())

	completed, err := common.Marshal(events[len(events)-1].Payload)
	require.NoError(t, err)
	assert.Equal(t, []any{"custom_tool_call", "function_call"}, gjson.GetBytes(completed, "response.output.#.type").Value())
	assert.Equal(t, []any{"call_exec", "call_lookup"}, gjson.GetBytes(completed, "response.output.#.call_id").Value())
	assert.Equal(t, customToolRawInput, gjson.GetBytes(completed, "response.output.0.input").String())
}

func TestResponsesCustomToolStateIsolatedPerAttempt(t *testing.T) {
	gin.SetMode(gin.TestMode)
	info := &relaycommon.RelayInfo{}

	_, err := ConvertRequestByID(nil, info, ConverterOpenAIResponsesToOpenAIChat, customToolResponsesRequest(t))
	require.NoError(t, err)
	require.True(t, info.IsResponsesCustomTool("exec"))

	// A new attempt selects a channel before converting; the record from the
	// previous attempt must not survive into it.
	c, _ := gin.CreateTestContext(httptest.NewRecorder())
	c.Request = httptest.NewRequest("POST", "/v1/responses", nil)
	info.InitChannelMeta(c)
	assert.False(t, info.IsResponsesCustomTool("exec"))

	// A retry whose request carries no custom tools replaces the record, so an
	// upstream function named like the old custom tool stays a function call.
	_, err = ConvertRequestByID(nil, info, ConverterOpenAIResponsesToOpenAIChat, customToolResponsesRequest(t))
	require.NoError(t, err)
	require.True(t, info.IsResponsesCustomTool("exec"))
	_, err = ConvertRequestByID(nil, info, ConverterOpenAIResponsesToOpenAIChat, &dto.OpenAIResponsesRequest{
		Model: "gpt-test",
		Input: mustRawMessage(t, "hi"),
		Tools: mustRawMessage(t, []map[string]any{{"type": "function", "name": "exec", "parameters": map[string]any{"type": "object"}}}),
	})
	require.NoError(t, err)
	assert.False(t, info.IsResponsesCustomTool("exec"))

	message := dto.Message{Role: "assistant"}
	message.SetToolCalls([]dto.ToolCallRequest{{ID: "call_exec", Type: "function", Function: dto.FunctionRequest{Name: "exec", Arguments: `{"input":"ls"}`}}})
	result, err := ConvertResponse(nil, info, types.RelayFormatOpenAIResponses, &dto.OpenAITextResponse{
		Id:      "resp_2",
		Choices: []dto.OpenAITextResponseChoice{{Message: message}},
	})
	require.NoError(t, err)
	output := result.Value.(*dto.OpenAIResponsesResponse).Output
	require.Len(t, output, 1)
	assert.Equal(t, "function_call", output[0].Type)
	assert.Equal(t, `{"input":"ls"}`, output[0].ArgumentsString())
}

func mustArguments(t *testing.T, input string) string {
	t.Helper()
	raw, err := common.Marshal(map[string]string{"input": input})
	require.NoError(t, err)
	return string(raw)
}
