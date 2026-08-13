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
			`{"model":"qwen3","created_at":"2026-05-27T12:00:00Z","message":{"role":"assistant","thinking":"carefully considered","content":"final answer"},"done":true,"done_reason":"stop","prompt_eval_count":4,"eval_count":6}`,
		)),
	}

	usage, apiErr := ollamaChatHandler(c, &relaycommon.RelayInfo{
		ChannelMeta: &relaycommon.ChannelMeta{UpstreamModelName: "fallback-model"},
	}, resp)
	require.Nil(t, apiErr)
	require.NotNil(t, usage)
	assert.Equal(t, dto.Usage{PromptTokens: 4, CompletionTokens: 6, TotalTokens: 10}, *usage)

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
		`{"model":"qwen3","created_at":"2026-05-27T12:00:00Z","done":true,"done_reason":"stop","prompt_eval_count":3,"eval_count":4}`,
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
	assert.Equal(t, dto.Usage{PromptTokens: 3, CompletionTokens: 4, TotalTokens: 7}, *usage)

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
	require.Len(t, toolCalls, 2)
	assert.Equal(t, "call_weather", toolCalls[0].ID)
	assert.Equal(t, 0, *toolCalls[0].Index)
	assert.Equal(t, "call_1", toolCalls[1].ID)
	assert.Equal(t, 1, *toolCalls[1].Index)
	assert.Equal(t, "get_time", toolCalls[1].Function.Name)
}
