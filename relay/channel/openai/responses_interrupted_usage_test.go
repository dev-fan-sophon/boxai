package openai

import (
	"errors"
	"io"
	"strings"
	"testing"
	"testing/iotest"

	"github.com/dev-fan-sophon/boxai/common"
	"github.com/dev-fan-sophon/boxai/constant"
	relaycommon "github.com/dev-fan-sophon/boxai/relay/common"
	"github.com/dev-fan-sophon/boxai/service"
	"github.com/stretchr/testify/assert"
	"github.com/stretchr/testify/require"
)

// TestResponsesStreamInterruptedUsageSettlement pins how a Responses SSE
// stream settles when terminal usage is missing, partial or authoritative.
// The estimated prompt is 7 tokens; deltas carry "hello world".
func TestResponsesStreamInterruptedUsageSettlement(t *testing.T) {
	oldTimeout := constant.StreamingTimeout
	constant.StreamingTimeout = 30
	t.Cleanup(func() { constant.StreamingTimeout = oldTimeout })

	const model = "gpt-4o"
	text := service.CountTextToken("hello world", model)
	terminalText := service.CountTextToken("final answer"+`{"cmd":"ls"}`, model)
	sse := func(events ...string) string {
		var b strings.Builder
		for _, event := range events {
			b.WriteString("data: " + event + "\n\n")
		}
		return b.String()
	}
	const (
		created            = `{"type":"response.created","response":{"status":"in_progress"}}`
		createdZeroUsage   = `{"type":"response.created","response":{"status":"in_progress","usage":{"input_tokens":0,"output_tokens":0,"total_tokens":0}}}`
		inProgressPartial  = `{"type":"response.in_progress","response":{"status":"in_progress","usage":{"input_tokens":11,"output_tokens":2,"input_tokens_details":{"cached_tokens":5}}}}`
		delta              = `{"type":"response.output_text.delta","delta":"hello world"}`
		completedWithUsage = `{"type":"response.completed","response":{"status":"completed","usage":{"input_tokens":3,"output_tokens":4,"total_tokens":9}}}`
	)

	for _, tc := range []struct {
		name               string
		body               string
		wantPrompt         int
		wantCompletion     int
		wantCached         int
		wantProtocolErrors bool
		wantEstimated      bool
	}{
		{
			name:               "created then EOF bills estimated prompt",
			body:               sse(created),
			wantPrompt:         7,
			wantProtocolErrors: true,
			wantEstimated:      true,
		},
		{
			name:               "zero placeholder usage on created does not suppress estimation",
			body:               sse(createdZeroUsage, delta),
			wantPrompt:         7,
			wantCompletion:     text,
			wantProtocolErrors: true,
			wantEstimated:      true,
		},
		{
			name:               "running upstream totals are preferred over local estimates after cut",
			body:               sse(inProgressPartial),
			wantPrompt:         11,
			wantCompletion:     2,
			wantCached:         5,
			wantProtocolErrors: true,
			wantEstimated:      true,
		},
		{
			name:               "delivered output above stale running total is billed",
			body:               sse(inProgressPartial, delta),
			wantPrompt:         11,
			wantCompletion:     max(text, 2),
			wantCached:         5,
			wantProtocolErrors: true,
			wantEstimated:      true,
		},
		{
			name:               "explicit response.failed bills nothing",
			body:               sse(created, delta, `{"type":"response.failed","response":{"status":"failed"}}`),
			wantProtocolErrors: true,
		},
		{
			name:               "explicit response.error bills nothing",
			body:               sse(created, delta, `{"type":"response.error","code":"server_error"}`),
			wantProtocolErrors: true,
		},
		{
			name:               "flat error event bills nothing",
			body:               sse(created, delta, `{"type":"error","code":"server_error"}`),
			wantProtocolErrors: true,
		},
		{
			name:               "incomplete without usage estimates delivered output",
			body:               sse(created, delta, `{"type":"response.incomplete","response":{"status":"incomplete"}}`),
			wantPrompt:         7,
			wantCompletion:     text,
			wantProtocolErrors: true,
			wantEstimated:      true,
		},
		{
			name:               "incomplete usage is authoritative",
			body:               sse(created, delta, `{"type":"response.incomplete","response":{"status":"incomplete","usage":{"input_tokens":3,"output_tokens":4}}}`),
			wantPrompt:         3,
			wantCompletion:     4,
			wantProtocolErrors: true,
		},
		{
			name:           "completed usage is authoritative over deltas and running totals",
			body:           sse(inProgressPartial, delta, completedWithUsage),
			wantPrompt:     3,
			wantCompletion: 4,
		},
		{
			name: "completed without usage estimates output carried only on terminal",
			body: sse(created, `{"type":"response.completed","response":{"status":"completed","output":[`+
				`{"type":"message","role":"assistant","content":[{"type":"output_text","text":"final answer"}]},`+
				`{"type":"function_call","name":"shell","call_id":"c1","arguments":"{\"cmd\":\"ls\"}"}]}}`),
			wantPrompt:     7,
			wantCompletion: terminalText,
			wantEstimated:  true,
		},
		{
			name:               "malformed only event bills nothing",
			body:               "data: {not json\n\n",
			wantProtocolErrors: true,
		},
		{
			name:               "no events bills nothing",
			body:               "",
			wantProtocolErrors: true,
		},
	} {
		t.Run(tc.name, func(t *testing.T) {
			c, _, resp, info := newImageTestContext(t, tc.body, "text/event-stream", true)
			info.UpstreamModelName = model
			info.SetEstimatePromptTokens(7)

			usage, err := OaiResponsesStreamHandler(c, info, resp)
			require.Nil(t, err)
			require.NotNil(t, usage)
			assert.Equal(t, tc.wantPrompt, usage.PromptTokens)
			assert.Equal(t, tc.wantCompletion, usage.CompletionTokens)
			if tc.name == "completed usage is authoritative over deltas and running totals" {
				assert.Equal(t, 9, usage.TotalTokens, "upstream total_tokens is kept verbatim")
			} else {
				assert.Equal(t, tc.wantPrompt+tc.wantCompletion, usage.TotalTokens)
			}
			assert.Equal(t, tc.wantCached, usage.PromptTokensDetails.CachedTokens)
			assert.Equal(t, tc.wantProtocolErrors, info.StreamStatus.HasErrors())
			assert.Equal(t, tc.wantEstimated, common.GetContextKeyBool(c, constant.ContextKeyLocalCountTokens))
		})
	}
}

// TestResponsesStreamTransportFailureKeepsEstimate separates an upstream
// transport failure from an explicit upstream failure: a read error after
// generation started still owes the delivered prompt and output.
func TestResponsesStreamTransportFailureKeepsEstimate(t *testing.T) {
	oldTimeout := constant.StreamingTimeout
	constant.StreamingTimeout = 30
	t.Cleanup(func() { constant.StreamingTimeout = oldTimeout })

	body := "data: {\"type\":\"response.created\"}\n\ndata: {\"type\":\"response.output_text.delta\",\"delta\":\"hello world\"}\n\n"
	c, _, resp, info := newImageTestContext(t, "", "text/event-stream", true)
	resp.Body = io.NopCloser(io.MultiReader(strings.NewReader(body), iotest.ErrReader(errors.New("connection reset"))))
	info.UpstreamModelName = "gpt-4o"
	info.SetEstimatePromptTokens(7)

	usage, err := OaiResponsesStreamHandler(c, info, resp)
	require.Nil(t, err)
	require.NotNil(t, usage)
	assert.Equal(t, relaycommon.StreamEndReasonScannerErr, info.StreamStatus.EndReason)
	assert.Equal(t, 7, usage.PromptTokens)
	assert.Equal(t, service.CountTextToken("hello world", "gpt-4o"), usage.CompletionTokens)
	assert.Equal(t, usage.PromptTokens+usage.CompletionTokens, usage.TotalTokens)
	assert.True(t, info.StreamStatus.HasErrors())
}
