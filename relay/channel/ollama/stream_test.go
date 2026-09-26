package ollama

import (
	"io"
	"net/http"
	"net/http/httptest"
	"strings"
	"testing"

	"github.com/dev-fan-sophon/boxai/common"
	"github.com/dev-fan-sophon/boxai/constant"
	"github.com/dev-fan-sophon/boxai/dto"
	relaycommon "github.com/dev-fan-sophon/boxai/relay/common"
	"github.com/dev-fan-sophon/boxai/types"

	"github.com/gin-gonic/gin"
	"github.com/stretchr/testify/assert"
	"github.com/stretchr/testify/require"
)

func TestOllamaChatHandlerNonStreamToolCalls(t *testing.T) {
	gin.SetMode(gin.TestMode)

	tests := []struct {
		name      string
		raw       string
		wantIDs   []string
		wantNames []string
	}{
		{
			name:      "compact json per-line parse path with upstream ids",
			raw:       `{"model":"llama3.1","created_at":"2026-05-27T12:00:00Z","message":{"role":"assistant","content":"","tool_calls":[{"id":"call_weather","function":{"name":"get_weather","arguments":{"city":"Paris","days":0}}},{"id":"call_time","function":{"name":"get_time","arguments":{"zone":"UTC"}}}]},"done":true,"done_reason":"stop","prompt_eval_count":5,"eval_count":7}`,
			wantIDs:   []string{"call_weather", "call_time"},
			wantNames: []string{"get_weather", "get_time"},
		},
		{
			name: "pretty json fallback parse path",
			raw: `{
  "model": "llama3.1",
  "created_at": "2026-05-27T12:00:00Z",
  "message": {
    "role": "assistant",
    "content": "",
    "tool_calls": [
      {
        "function": {
          "name": "get_weather",
          "arguments": {
            "city": "Paris",
            "days": 0
          }
        }
      }
    ]
  },
  "done": true,
  "done_reason": "stop",
  "prompt_eval_count": 5,
  "eval_count": 7
}`,
			wantIDs:   []string{"call_0"},
			wantNames: []string{"get_weather"},
		},
	}

	for _, tt := range tests {
		t.Run(tt.name, func(t *testing.T) {
			w := httptest.NewRecorder()
			c, _ := gin.CreateTestContext(w)

			resp := &http.Response{
				StatusCode: http.StatusOK,
				Header:     make(http.Header),
				Body:       io.NopCloser(strings.NewReader(tt.raw)),
			}

			usage, apiErr := ollamaChatHandler(c, &relaycommon.RelayInfo{
				ChannelMeta: &relaycommon.ChannelMeta{UpstreamModelName: "fallback-model"},
			}, resp)
			require.Nil(t, apiErr)
			require.NotNil(t, usage)
			assert.Equal(t, 12, usage.TotalTokens)

			var out dto.OpenAITextResponse
			require.NoError(t, common.Unmarshal(w.Body.Bytes(), &out))
			require.Len(t, out.Choices, 1)
			assert.Equal(t, constant.FinishReasonToolCalls, out.Choices[0].FinishReason)

			var toolCalls []dto.ToolCallResponse
			require.NoError(t, common.Unmarshal(out.Choices[0].Message.ToolCalls, &toolCalls))
			require.Len(t, toolCalls, len(tt.wantIDs))
			for i := range toolCalls {
				assert.Equal(t, tt.wantIDs[i], toolCalls[i].ID)
				assert.Equal(t, "function", toolCalls[i].Type)
				assert.Equal(t, tt.wantNames[i], toolCalls[i].Function.Name)
				assert.Nil(t, toolCalls[i].Index)
			}

			var args map[string]any
			require.NoError(t, common.Unmarshal([]byte(toolCalls[0].Function.Arguments), &args))
			assert.Equal(t, "Paris", args["city"])
			assert.Equal(t, float64(0), args["days"])
		})
	}
}

func TestOllamaChatHandlerNonStreamReasoningAndAnswer(t *testing.T) {
	w := httptest.NewRecorder()
	c, _ := gin.CreateTestContext(w)
	resp := &http.Response{
		StatusCode: http.StatusOK,
		Header:     make(http.Header),
		Body: io.NopCloser(strings.NewReader(
			`{"model":"qwen3","created_at":"2026-05-27T12:00:00Z","message":{"role":"assistant","thinking":"carefully considered","content":"final answer"},"done":true,"done_reason":"stop","prompt_eval_count":4,"prompt_eval_cached_count":3,"eval_count":6}`,
		)),
	}

	usage, apiErr := ollamaChatHandler(c, &relaycommon.RelayInfo{
		ChannelMeta: &relaycommon.ChannelMeta{UpstreamModelName: "fallback-model"},
	}, resp)
	require.Nil(t, apiErr)
	require.NotNil(t, usage)
	assert.Equal(t, 4, usage.PromptTokens)
	assert.Equal(t, 3, usage.PromptTokensDetails.CachedTokens)
	assert.Equal(t, 6, usage.CompletionTokens)
	assert.Equal(t, 10, usage.TotalTokens)

	var out dto.OpenAITextResponse
	require.NoError(t, common.Unmarshal(w.Body.Bytes(), &out))
	require.Len(t, out.Choices, 1)
	assert.Equal(t, "qwen3", out.Model)
	assert.Equal(t, "stop", out.Choices[0].FinishReason)
	assert.Equal(t, "final answer", out.Choices[0].Message.StringContent())
	require.NotNil(t, out.Choices[0].Message.ReasoningContent)
	assert.Equal(t, "carefully considered", *out.Choices[0].Message.ReasoningContent)
}

func TestOllamaStreamHandlerPreservesReasoningToolCallsFinishAndUsage(t *testing.T) {
	raw := strings.Join([]string{
		`{"model":"qwen3","created_at":"2026-05-27T12:00:00Z","message":{"role":"assistant","thinking":"plan "},"done":false}`,
		`{"model":"qwen3","created_at":"2026-05-27T12:00:00Z","message":{"role":"assistant","thinking":"carefully","content":"answer"},"done":false}`,
		`{"model":"qwen3","created_at":"2026-05-27T12:00:00Z","message":{"role":"assistant","tool_calls":[{"id":"call_weather","function":{"name":"get_weather","arguments":{"city":"Hanoi"}}},{"function":{"name":"get_time","arguments":{"zone":"UTC"}}}]},"done":false}`,
		`{"model":"qwen3","created_at":"2026-05-27T12:00:00Z","done":true,"done_reason":"stop","prompt_eval_count":3,"prompt_eval_cached_count":2,"eval_count":4}`,
	}, "\n")
	w := httptest.NewRecorder()
	c, _ := gin.CreateTestContext(w)
	resp := &http.Response{
		StatusCode: http.StatusOK,
		Header:     make(http.Header),
		Body:       io.NopCloser(strings.NewReader(raw)),
	}

	usage, apiErr := ollamaStreamHandler(c, &relaycommon.RelayInfo{
		ChannelMeta: &relaycommon.ChannelMeta{UpstreamModelName: "fallback-model"},
	}, resp)
	require.Nil(t, apiErr)
	require.NotNil(t, usage)
	assert.Equal(t, 3, usage.PromptTokens)
	assert.Equal(t, 2, usage.PromptTokensDetails.CachedTokens)
	assert.Equal(t, 4, usage.CompletionTokens)
	assert.Equal(t, 7, usage.TotalTokens)

	var reasoning strings.Builder
	var content strings.Builder
	var toolCalls []dto.ToolCallResponse
	var finishReason string
	var finalUsage *dto.Usage
	seenDone := false
	for _, line := range strings.Split(w.Body.String(), "\n") {
		line = strings.TrimSpace(line)
		if !strings.HasPrefix(line, "data:") {
			continue
		}
		data := strings.TrimSpace(strings.TrimPrefix(line, "data:"))
		if data == "[DONE]" {
			seenDone = true
			continue
		}
		var chunk dto.ChatCompletionsStreamResponse
		require.NoError(t, common.Unmarshal([]byte(data), &chunk))
		if chunk.Usage != nil {
			finalUsage = chunk.Usage
		}
		for _, choice := range chunk.Choices {
			reasoning.WriteString(choice.Delta.GetReasoningContent())
			content.WriteString(choice.Delta.GetContentString())
			toolCalls = append(toolCalls, choice.Delta.ToolCalls...)
			if choice.FinishReason != nil {
				finishReason = *choice.FinishReason
			}
		}
	}

	assert.True(t, seenDone)
	assert.Equal(t, "plan carefully", reasoning.String())
	assert.Equal(t, "answer", content.String())
	assert.Equal(t, constant.FinishReasonToolCalls, finishReason)
	require.NotNil(t, finalUsage)
	assert.Equal(t, *usage, *finalUsage)
	assert.Equal(t, 2, usage.PromptTokensDetails.CachedTokens)
	require.Len(t, toolCalls, 2)
	assert.Equal(t, "call_weather", toolCalls[0].ID)
	assert.Equal(t, 0, *toolCalls[0].Index)
	assert.Equal(t, "call_1", toolCalls[1].ID)
	assert.Equal(t, 1, *toolCalls[1].Index)
	assert.Equal(t, "get_time", toolCalls[1].Function.Name)
}

func TestOllamaClaudeNonStream(t *testing.T) {
	for _, tool := range []bool{false, true} {
		t.Run(map[bool]string{false: "text", true: "tool"}[tool], func(t *testing.T) {
			tools := ""
			if tool {
				tools = `,"tool_calls":[{"id":"weather","function":{"name":"get_weather","arguments":{"city":"Hanoi","days":0}}}]`
			}
			raw := `{"model":"qwen3","message":{"thinking":"plan","content":"answer"` + tools + `},"done":true,"done_reason":"stop","prompt_eval_count":10,"prompt_eval_cached_count":6,"eval_count":3}`
			w := httptest.NewRecorder()
			c, _ := gin.CreateTestContext(w)
			usage, apiErr := ollamaChatHandler(c, &relaycommon.RelayInfo{
				RelayFormat: types.RelayFormatClaude,
				ChannelMeta: &relaycommon.ChannelMeta{UpstreamModelName: "qwen3"},
			}, &http.Response{StatusCode: http.StatusOK, Header: make(http.Header), Body: io.NopCloser(strings.NewReader(raw))})
			require.Nil(t, apiErr)
			require.NotNil(t, usage)
			assert.Equal(t, 10, usage.PromptTokens)
			assert.Equal(t, 6, usage.PromptTokensDetails.CachedTokens)
			assert.Equal(t, 13, usage.TotalTokens)
			var out dto.ClaudeResponse
			require.NoError(t, common.Unmarshal(w.Body.Bytes(), &out))
			assert.Equal(t, "message", out.Type)
			assert.Equal(t, "assistant", out.Role)
			assert.Equal(t, "qwen3", out.Model)
			assert.NotContains(t, w.Body.String(), "chat.completion")
			require.GreaterOrEqual(t, len(out.Content), 2)
			assert.Equal(t, "thinking", out.Content[0].Type)
			require.NotNil(t, out.Content[0].Thinking)
			assert.Equal(t, "plan", *out.Content[0].Thinking)
			assert.Equal(t, "text", out.Content[1].Type)
			require.NotNil(t, out.Content[1].Text)
			assert.Equal(t, "answer", *out.Content[1].Text)
			if tool {
				require.Len(t, out.Content, 3)
				assert.Equal(t, "tool_use", out.StopReason)
				assert.Equal(t, "tool_use", out.Content[2].Type)
				assert.Equal(t, "weather", out.Content[2].Id)
				assert.Equal(t, "get_weather", out.Content[2].Name)
				assert.Equal(t, map[string]any{"city": "Hanoi", "days": float64(0)}, out.Content[2].Input)
			} else {
				require.Len(t, out.Content, 2)
				assert.Equal(t, "end_turn", out.StopReason)
			}
			require.NotNil(t, out.Usage)
			assert.Equal(t, 4, out.Usage.InputTokens)
			assert.Equal(t, 6, out.Usage.CacheReadInputTokens)
			assert.Equal(t, 3, out.Usage.OutputTokens)
		})
	}
}

func TestOllamaClaudeStream(t *testing.T) {
	for _, tt := range []struct {
		name, message, reason, wantStop string
		wantTypes                       []string
	}{
		{"mixed blocks", `{"thinking":"plan","content":"answer","tool_calls":[{"id":"weather","function":{"name":"get_weather","arguments":{"city":"Hanoi"}}},{"function":{"name":"get_time","arguments":{"zone":"UTC"}}}]}`, "stop", "tool_use", []string{"thinking", "text", "tool_use", "tool_use"}},
		{"text", `{"content":"answer"}`, "stop", "end_turn", []string{"text"}},
		{"thinking at limit", `{"thinking":"plan"}`, "length", "max_tokens", []string{"thinking"}},
		{"empty", "", "stop", "end_turn", nil},
	} {
		t.Run(tt.name, func(t *testing.T) {
			raw := ""
			if tt.message != "" {
				raw = `{"message":` + tt.message + `,"done":false}` + "\n"
			}
			raw += `{"done":true,"done_reason":"` + tt.reason + `","prompt_eval_count":10,"prompt_eval_cached_count":6,"eval_count":3}`
			w := httptest.NewRecorder()
			c, _ := gin.CreateTestContext(w)
			usage, apiErr := ollamaStreamHandler(c, &relaycommon.RelayInfo{
				RelayFormat: types.RelayFormatClaude,
				ChannelMeta: &relaycommon.ChannelMeta{UpstreamModelName: "qwen3"},
			}, &http.Response{StatusCode: http.StatusOK, Header: make(http.Header), Body: io.NopCloser(strings.NewReader(raw))})
			require.Nil(t, apiErr)
			assert.Equal(t, 10, usage.PromptTokens)
			assert.Equal(t, 6, usage.PromptTokensDetails.CachedTokens)
			assert.Equal(t, 13, usage.TotalTokens)
			assert.NotContains(t, w.Body.String(), "[DONE]")
			assert.NotContains(t, w.Body.String(), "chat.completion")
			var blockTypes []string
			var events []string
			openBlocks := map[int]string{}
			var thinking, text strings.Builder
			var toolArgs []string
			for _, line := range strings.Split(w.Body.String(), "\n") {
				if !strings.HasPrefix(line, "data:") {
					continue
				}
				var event dto.ClaudeResponse
				require.NoError(t, common.Unmarshal([]byte(strings.TrimSpace(strings.TrimPrefix(line, "data:"))), &event))
				events = append(events, event.Type)
				switch event.Type {
				case "content_block_start":
					require.NotNil(t, event.Index)
					require.NotNil(t, event.ContentBlock)
					assert.NotContains(t, openBlocks, *event.Index)
					openBlocks[*event.Index] = event.ContentBlock.Type
					blockTypes = append(blockTypes, event.ContentBlock.Type)
					if event.ContentBlock.Type == "tool_use" {
						assert.NotEmpty(t, event.ContentBlock.Id)
						assert.NotEmpty(t, event.ContentBlock.Name)
					}
				case "content_block_delta":
					require.NotNil(t, event.Index)
					require.Contains(t, openBlocks, *event.Index)
					require.NotNil(t, event.Delta)
					switch event.Delta.Type {
					case "thinking_delta":
						assert.Equal(t, "thinking", openBlocks[*event.Index])
						thinking.WriteString(*event.Delta.Thinking)
					case "text_delta":
						assert.Equal(t, "text", openBlocks[*event.Index])
						text.WriteString(*event.Delta.Text)
					case "input_json_delta":
						assert.Equal(t, "tool_use", openBlocks[*event.Index])
						toolArgs = append(toolArgs, *event.Delta.PartialJson)
					}
				case "content_block_stop":
					require.NotNil(t, event.Index)
					require.Contains(t, openBlocks, *event.Index)
					delete(openBlocks, *event.Index)
				case "message_delta":
					assert.Empty(t, openBlocks)
					require.NotNil(t, event.Usage)
					assert.Equal(t, 4, event.Usage.InputTokens)
					assert.Equal(t, 6, event.Usage.CacheReadInputTokens)
					assert.Equal(t, 3, event.Usage.OutputTokens)
					require.NotNil(t, event.Delta.StopReason)
					assert.Equal(t, tt.wantStop, *event.Delta.StopReason)
				}
			}
			require.GreaterOrEqual(t, len(events), 3)
			assert.Equal(t, "message_start", events[0])
			assert.Equal(t, []string{"message_delta", "message_stop"}, events[len(events)-2:])
			assert.Equal(t, 1, strings.Count(w.Body.String(), "event: message_start"))
			assert.Equal(t, 1, strings.Count(w.Body.String(), "event: message_stop"))
			assert.Equal(t, tt.wantTypes, blockTypes)
			assert.Empty(t, openBlocks)
			if strings.Contains(tt.message, "thinking") {
				assert.Equal(t, "plan", thinking.String())
			}
			if strings.Contains(tt.message, "content") {
				assert.Equal(t, "answer", text.String())
			}
			if tt.name == "mixed blocks" {
				require.Len(t, toolArgs, 2)
				assert.JSONEq(t, `{"city":"Hanoi"}`, toolArgs[0])
				assert.JSONEq(t, `{"zone":"UTC"}`, toolArgs[1])
			}
		})
	}
}
