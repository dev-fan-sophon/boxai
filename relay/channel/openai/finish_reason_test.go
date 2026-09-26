package openai

import (
	"fmt"
	"net/http"
	"testing"

	"github.com/dev-fan-sophon/boxai/constant"
	relayconstant "github.com/dev-fan-sophon/boxai/relay/constant"
	"github.com/dev-fan-sophon/boxai/types"
	"github.com/stretchr/testify/assert"
	"github.com/stretchr/testify/require"
)

func TestOpenaiHandlerFinishReason(t *testing.T) {
	for _, reason := range []string{"error", "stop", "length", "content_filter", "tool_calls"} {
		t.Run(reason, func(t *testing.T) {
			// A preceding filtered choice must not hide a later failed choice.
			body := fmt.Sprintf(`{"choices":[{"index":0,"message":{"content":""},"finish_reason":"content_filter"},{"index":1,"message":{"content":"{\"partial\":"},"finish_reason":%q}],"usage":{"prompt_tokens":3,"completion_tokens":4,"total_tokens":7}}`, reason)
			c, recorder, resp, info := newImageTestContext(t, body, "application/json", false)
			info.RelayFormat = types.RelayFormatOpenAI
			usage, apiErr := OpenaiHandler(c, info, resp)
			if reason == "error" {
				require.NotNil(t, apiErr)
				assert.Equal(t, http.StatusBadGateway, apiErr.StatusCode)
				assert.False(t, types.IsSkipRetryError(apiErr))
				assert.Nil(t, usage)
				assert.False(t, c.Writer.Written())
				assert.Empty(t, recorder.Body.String())
				return
			}
			require.Nil(t, apiErr)
			require.NotNil(t, usage)
			assert.Equal(t, 7, usage.TotalTokens)
			assert.JSONEq(t, body, recorder.Body.String())
		})
	}
}

func TestOaiStreamHandlerFinishReason(t *testing.T) {
	oldTimeout := constant.StreamingTimeout
	constant.StreamingTimeout = 30
	t.Cleanup(func() { constant.StreamingTimeout = oldTimeout })
	for _, reason := range []string{"error", "stop", "length", "content_filter", "tool_calls"} {
		for _, suffix := range []string{"data: [DONE]\n\n", "data: {\"choices\":[],\"usage\":{\"prompt_tokens\":3,\"completion_tokens\":4,\"total_tokens\":7}}\n\ndata: [DONE]\n\n"} {
			t.Run(fmt.Sprintf("%s/usage=%t", reason, len(suffix) > 20), func(t *testing.T) {
				body := "data: {\"choices\":[{\"index\":0,\"delta\":{\"content\":\"partial\"}}]}\n\n" +
					"data: {\"choices\":[{\"index\":0,\"delta\":{\"content\":\" output\"}}]}\n\n" +
					fmt.Sprintf("data: {\"choices\":[{\"index\":0,\"delta\":{},\"finish_reason\":\"stop\"},{\"index\":1,\"delta\":{},\"finish_reason\":%q}],\"usage\":{\"prompt_tokens\":3,\"completion_tokens\":4,\"total_tokens\":7}}\n\n", reason) + suffix
				c, recorder, resp, info := newImageTestContext(t, body, "text/event-stream", true)
				info.RelayFormat = types.RelayFormatOpenAI
				info.RelayMode = relayconstant.RelayModeChatCompletions
				info.DisablePing = true
				usage, apiErr := OaiStreamHandler(c, info, resp)
				if reason == "error" {
					require.NotNil(t, apiErr)
					assert.Equal(t, http.StatusBadGateway, apiErr.StatusCode)
					assert.True(t, types.IsSkipRetryError(apiErr), "do not concatenate a retry after emitted output")
					assert.Nil(t, usage)
					assert.True(t, info.StreamStatus.HasErrors())
					assert.Contains(t, recorder.Body.String(), "partial", "already emitted output remains committed")
					assert.NotContains(t, recorder.Body.String(), "[DONE]")
					assert.NotContains(t, recorder.Body.String(), `"usage"`)
					return
				}
				require.Nil(t, apiErr)
				require.NotNil(t, usage)
				assert.Equal(t, 7, usage.TotalTokens)
				assert.Contains(t, recorder.Body.String(), "[DONE]")
			})
		}
	}
}
