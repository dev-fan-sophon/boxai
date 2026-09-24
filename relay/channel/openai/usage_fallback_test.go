package openai

import (
	"fmt"
	"strings"
	"testing"

	"github.com/dev-fan-sophon/boxai/common"
	"github.com/dev-fan-sophon/boxai/constant"
	"github.com/dev-fan-sophon/boxai/service"
	"github.com/stretchr/testify/assert"
	"github.com/stretchr/testify/require"
)

func TestResponsesStreamFallbackContentAndActualUsage(t *testing.T) {
	oldTimeout := constant.StreamingTimeout
	constant.StreamingTimeout = 30
	t.Cleanup(func() { constant.StreamingTimeout = oldTimeout })
	for _, event := range []string{"output_text", "function_call_arguments", "reasoning_text", "reasoning_summary_text", "refusal"} {
		t.Run(event, func(t *testing.T) {
			body := fmt.Sprintf("data: {\"type\":\"response.%s.delta\",\"delta\":\"hello world\"}\n\ndata: {\"type\":\"response.%s.done\",\"text\":\"hello world\"}\n\n", event, event)
			c, _, resp, info := newImageTestContext(t, body, "text/event-stream", true)
			info.UpstreamModelName = "gpt-4o"
			info.SetEstimatePromptTokens(7)
			usage, err := OaiResponsesStreamHandler(c, info, resp)
			require.Nil(t, err)
			require.NotNil(t, usage)
			assert.Equal(t, service.CountTextToken("hello world", "gpt-4o"), usage.CompletionTokens)
			assert.Equal(t, 7, usage.PromptTokens)
			assert.Equal(t, 7+usage.CompletionTokens, usage.TotalTokens)
			assert.True(t, info.StreamStatus.HasErrors(), "EOF without terminal event is not protocol success")
			assert.True(t, common.GetContextKeyBool(c, constant.ContextKeyLocalCountTokens))
		})
	}
	for _, tt := range []struct {
		name, terminal            string
		prompt, completion, total int
	}{
		{"explicit error", `{"type":"error","message":"failed"}`, 0, 0, 0},
		{"failed", `{"type":"response.failed","response":{"status":"failed"}}`, 0, 0, 0},
		{"failed status", `{"type":"response.done","response":{"status":"failed"}}`, 0, 0, 0},
		{"incomplete estimates delivered output", `{"type":"response.incomplete"}`, 7, service.CountTextToken("hello world", "gpt-4o"), 7 + service.CountTextToken("hello world", "gpt-4o")},
		{"cancelled preserves fallback", `{"type":"response.cancelled"}`, 7, service.CountTextToken("hello world", "gpt-4o"), 7 + service.CountTextToken("hello world", "gpt-4o")},
		{"actual zero", `{"type":"response.completed","response":{"usage":{"input_tokens":0,"output_tokens":0,"total_tokens":0}}}`, 0, 0, 0},
		{"actual usage", `{"type":"response.completed","response":{"usage":{"input_tokens":3,"output_tokens":4,"total_tokens":9}}}`, 3, 4, 9},
		{"incomplete actual usage", `{"type":"response.incomplete","response":{"usage":{"input_tokens":3,"output_tokens":4}}}`, 3, 4, 7},
		{"failed actual usage", `{"type":"response.failed","response":{"usage":{"input_tokens":3,"output_tokens":4}}}`, 3, 4, 7},
	} {
		t.Run(tt.name, func(t *testing.T) {
			body := "data: {\"type\":\"response.function_call_arguments.delta\",\"delta\":\"hello world\"}\n\ndata: " + tt.terminal + "\n\n"
			c, _, resp, info := newImageTestContext(t, body, "text/event-stream", true)
			info.UpstreamModelName = "gpt-4o"
			info.SetEstimatePromptTokens(7)
			usage, err := OaiResponsesStreamHandler(c, info, resp)
			require.Nil(t, err)
			require.NotNil(t, usage)
			assert.Equal(t, tt.prompt, usage.PromptTokens)
			assert.Equal(t, tt.completion, usage.CompletionTokens)
			assert.Equal(t, tt.total, usage.TotalTokens)
			assert.Equal(t, !strings.HasPrefix(tt.name, "actual"), info.StreamStatus.HasErrors())
			assert.Equal(t, tt.name == "incomplete estimates delivered output" || tt.name == "cancelled preserves fallback", common.GetContextKeyBool(c, constant.ContextKeyLocalCountTokens))
		})
	}
}

func TestResponsesPromptFallbackAfterUpstreamEvent(t *testing.T) {
	oldTimeout := constant.StreamingTimeout
	constant.StreamingTimeout = 30
	t.Cleanup(func() { constant.StreamingTimeout = oldTimeout })
	for _, tc := range []struct {
		body string
		want int
	}{
		{"", 0},
		{"data: {\"type\":\"response.created\"}\n\n", 7},
		{"data: {\"type\":\"response.failed\"}\n\n", 0},
	} {
		c, _, resp, info := newImageTestContext(t, tc.body, "text/event-stream", true)
		info.SetEstimatePromptTokens(7)
		usage, err := OaiResponsesStreamHandler(c, info, resp)
		require.Nil(t, err)
		assert.Equal(t, tc.want, usage.PromptTokens)
		assert.Zero(t, usage.CompletionTokens)
	}
}

func TestImagePayloadCountAndOutputImageUsage(t *testing.T) {
	for _, stream := range []bool{false, true} {
		t.Run(fmt.Sprint(stream), func(t *testing.T) {
			body := `{"data":[{},null,{"revised_prompt":"metadata"},{"url":42},{"b64_json":" "},{"url":"https://example.com/image"},{"b64_json":"image","url":"https://example.com/image2"}],"usage":{"input_tokens":3,"output_tokens":8,"output_tokens_details":{"image_tokens":6}}}`
			c, recorder, resp, info := newImageTestContext(t, body, "application/json", stream)
			info.PriceData.UsePrice = true
			info.PriceData.AddOtherRatio("n", 7)
			handler := OpenaiImageHandler
			if stream {
				handler = OpenaiImageStreamHandler
			}
			usage, err := handler(c, info, resp)
			require.Nil(t, err)
			require.NotNil(t, usage)
			assert.Equal(t, 2.0, info.PriceData.OtherRatios()["n"])
			assert.Equal(t, 6, usage.CompletionTokenDetails.ImageTokens)
			assert.Equal(t, 8, usage.CompletionTokens)
			assert.Equal(t, 11, usage.TotalTokens)
			if stream {
				assert.Equal(t, 2, strings.Count(recorder.Body.String(), "event: image_generation.completed"))
				assert.Equal(t, 2, info.ReceivedResponseCount)
			} else {
				assert.Equal(t, body, recorder.Body.String())
			}
		})
	}
}

func TestImageSSEOutputImageUsage(t *testing.T) {
	oldTimeout := constant.StreamingTimeout
	constant.StreamingTimeout = 30
	t.Cleanup(func() { constant.StreamingTimeout = oldTimeout })
	body := "data: {\"type\":\"image_generation.completed\",\"usage\":{\"input_tokens\":3,\"output_tokens\":8,\"output_tokens_details\":{\"image_tokens\":6}}}\n\ndata: [DONE]\n\n"
	c, _, resp, info := newImageTestContext(t, body, "text/event-stream", true)
	usage, err := OpenaiImageStreamHandler(c, info, resp)
	require.Nil(t, err)
	require.NotNil(t, usage)
	assert.Equal(t, 6, usage.CompletionTokenDetails.ImageTokens)
	assert.Equal(t, 8, usage.CompletionTokens)
}
