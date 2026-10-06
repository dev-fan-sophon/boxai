package service

import (
	"net/http/httptest"
	"testing"

	"github.com/dev-fan-sophon/boxai/common"
	"github.com/dev-fan-sophon/boxai/constant"
	"github.com/dev-fan-sophon/boxai/dto"
	relaycommon "github.com/dev-fan-sophon/boxai/relay/common"

	"github.com/gin-gonic/gin"
	"github.com/stretchr/testify/assert"
	"github.com/stretchr/testify/require"
)

// TestResponsesUsageAccumulatorMatchesHTTPStreamSettlement pins the WebSocket
// accumulator to the Responses SSE settlement contract: authoritative terminal
// usage including zeros, non-terminal usage only as an interruption fallback,
// zero for explicit failures and retained usage for interrupted streams. The
// estimated prompt is 7 tokens; deltas carry "hello world".
func TestResponsesUsageAccumulatorMatchesHTTPStreamSettlement(t *testing.T) {
	const model = "gpt-4o"
	text := CountTextToken("hello world", model)
	terminalText := CountTextToken("final answer"+`{"cmd":"ls"}`, model)
	const (
		created            = `{"type":"response.created","response":{"status":"in_progress"}}`
		createdZeroUsage   = `{"type":"response.created","response":{"status":"in_progress","usage":{"input_tokens":0,"output_tokens":0,"total_tokens":0}}}`
		inProgressPartial  = `{"type":"response.in_progress","response":{"status":"in_progress","usage":{"input_tokens":11,"output_tokens":2,"input_tokens_details":{"cached_tokens":5}}}}`
		delta              = `{"type":"response.output_text.delta","delta":"hello world"}`
		completedWithUsage = `{"type":"response.completed","response":{"status":"completed","usage":{"input_tokens":3,"output_tokens":4,"total_tokens":9}}}`
		completedZeroUsage = `{"type":"response.completed","response":{"status":"completed","usage":{"input_tokens":0,"output_tokens":0,"total_tokens":0}}}`
	)
	for _, tc := range []struct {
		name               string
		events             []string
		wantPrompt         int
		wantCompletion     int
		wantTotal          int
		wantCached         int
		wantProtocolErrors bool
		wantEstimated      bool
	}{
		{name: "created then interruption bills estimated prompt", events: []string{created},
			wantPrompt: 7, wantTotal: 7, wantProtocolErrors: true, wantEstimated: true},
		{name: "zero placeholder usage on created does not suppress estimation", events: []string{createdZeroUsage, delta},
			wantPrompt: 7, wantCompletion: text, wantTotal: 7 + text, wantProtocolErrors: true, wantEstimated: true},
		{name: "custom tool input deltas count once despite done payload", events: []string{created,
			`{"type":"response.custom_tool_call_input.delta","delta":"hello world"}`,
			`{"type":"response.custom_tool_call_input.done","input":"hello world"}`},
			wantPrompt: 7, wantCompletion: text, wantTotal: 7 + text, wantProtocolErrors: true, wantEstimated: true},
		{name: "terminal-only custom tool input is counted", events: []string{created,
			`{"type":"response.completed","response":{"status":"completed","output":[{"type":"custom_tool_call","name":"exec","call_id":"c1","input":"hello world"}]}}`},
			wantPrompt: 7, wantCompletion: text, wantTotal: 7 + text, wantEstimated: true},
		{name: "running upstream totals are preferred after interruption", events: []string{inProgressPartial},
			wantPrompt: 11, wantCompletion: 2, wantTotal: 13, wantCached: 5, wantProtocolErrors: true, wantEstimated: true},
		{name: "delivered output above stale running total is billed", events: []string{inProgressPartial, delta},
			wantPrompt: 11, wantCompletion: max(text, 2), wantTotal: 11 + max(text, 2), wantCached: 5, wantProtocolErrors: true, wantEstimated: true},
		{name: "explicit response.failed bills nothing", events: []string{created, delta, `{"type":"response.failed","response":{"status":"failed"}}`},
			wantProtocolErrors: true},
		{name: "explicit error event bills nothing", events: []string{created, delta, `{"type":"error","code":"server_error"}`},
			wantProtocolErrors: true},
		{name: "incomplete without usage estimates delivered output", events: []string{created, delta, `{"type":"response.incomplete","response":{"status":"incomplete"}}`},
			wantPrompt: 7, wantCompletion: text, wantTotal: 7 + text, wantProtocolErrors: true, wantEstimated: true},
		{name: "incomplete usage is authoritative", events: []string{created, delta, `{"type":"response.incomplete","response":{"status":"incomplete","usage":{"input_tokens":3,"output_tokens":4}}}`},
			wantPrompt: 3, wantCompletion: 4, wantTotal: 7, wantProtocolErrors: true},
		{name: "completed usage is authoritative over deltas and running totals", events: []string{inProgressPartial, delta, completedWithUsage},
			wantPrompt: 3, wantCompletion: 4, wantTotal: 9},
		{name: "completed zero usage is authoritative", events: []string{created, delta, completedZeroUsage}},
		{name: "completed without usage estimates output carried only on terminal", events: []string{created, `{"type":"response.completed","response":{"status":"completed","output":[` +
			`{"type":"message","role":"assistant","content":[{"type":"output_text","text":"final answer"}]},` +
			`{"type":"function_call","name":"shell","call_id":"c1","arguments":"{\"cmd\":\"ls\"}"}]}}`},
			wantPrompt: 7, wantCompletion: terminalText, wantTotal: 7 + terminalText, wantEstimated: true},
		{name: "no events bills nothing", wantProtocolErrors: true},
	} {
		t.Run(tc.name, func(t *testing.T) {
			c, _ := gin.CreateTestContext(httptest.NewRecorder())
			info := &relaycommon.RelayInfo{StreamStatus: relaycommon.NewStreamStatus()}
			info.ChannelMeta = &relaycommon.ChannelMeta{UpstreamModelName: model}
			info.SetEstimatePromptTokens(7)
			accumulator := NewResponsesUsageAccumulator(info)
			for _, raw := range tc.events {
				var event dto.ResponsesStreamResponse
				require.NoError(t, common.UnmarshalJsonStr(raw, &event))
				accumulator.Observe(&event)
			}
			usage := accumulator.Finish(c)
			assert.Equal(t, tc.wantPrompt, usage.PromptTokens)
			assert.Equal(t, tc.wantCompletion, usage.CompletionTokens)
			assert.Equal(t, tc.wantTotal, usage.TotalTokens)
			assert.Equal(t, tc.wantCached, usage.PromptTokensDetails.CachedTokens)
			assert.Equal(t, tc.wantProtocolErrors, info.StreamStatus.HasErrors())
			assert.Equal(t, tc.wantEstimated, common.GetContextKeyBool(c, constant.ContextKeyLocalCountTokens))
			assert.Nil(t, info.QuotaClamp)
		})
	}
}

// TestResponsesUsageAccumulatorSaturatesEstimatedTotal protects billing from
// upstream running totals that would overflow the 32-bit quota columns.
func TestResponsesUsageAccumulatorSaturatesEstimatedTotal(t *testing.T) {
	c, _ := gin.CreateTestContext(httptest.NewRecorder())
	info := &relaycommon.RelayInfo{StreamStatus: relaycommon.NewStreamStatus()}
	accumulator := NewResponsesUsageAccumulator(info)
	var event dto.ResponsesStreamResponse
	require.NoError(t, common.UnmarshalJsonStr(`{"type":"response.in_progress","response":{"usage":{"input_tokens":2147483647,"output_tokens":2147483647}}}`, &event))
	accumulator.Observe(&event)

	usage := accumulator.Finish(c)
	assert.Equal(t, 2147483647, usage.TotalTokens)
	require.NotNil(t, info.QuotaClamp)
}

// TestResponsesUsageAccumulatorBillsCompletedImagesOnce counts completed image
// calls once and discards them when the response fails.
func TestResponsesUsageAccumulatorBillsCompletedImagesOnce(t *testing.T) {
	image := `{"type":"response.output_item.done","output_index":0,"item":{"id":"ig_1","type":"image_generation_call","status":"completed","result":"aGk=","quality":"high","size":"1024x1024"}}`
	for _, tc := range []struct {
		name      string
		terminal  string
		wantCount int
	}{
		{name: "completed", terminal: `{"type":"response.completed","response":{"status":"completed","usage":{"input_tokens":1,"output_tokens":1,"total_tokens":2}}}`, wantCount: 1},
		{name: "failed", terminal: `{"type":"response.failed","response":{"status":"failed"}}`, wantCount: 0},
	} {
		t.Run(tc.name, func(t *testing.T) {
			c, _ := gin.CreateTestContext(httptest.NewRecorder())
			info := &relaycommon.RelayInfo{StreamStatus: relaycommon.NewStreamStatus()}
			accumulator := NewResponsesUsageAccumulator(info)
			for _, raw := range []string{image, image, tc.terminal} {
				var event dto.ResponsesStreamResponse
				require.NoError(t, common.UnmarshalJsonStr(raw, &event))
				accumulator.Observe(&event)
			}
			accumulator.Finish(c)
			require.NotNil(t, info.ResponsesUsageInfo)
			assert.Equal(t, tc.wantCount, info.ResponsesUsageInfo.BuiltInTools[dto.BuildInToolImageGeneration].CallCount)
			assert.Equal(t, tc.wantCount > 0, c.GetBool("image_generation_call"))
		})
	}
}
