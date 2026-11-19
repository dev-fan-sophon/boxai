package deepseek

import (
	"encoding/json"
	"testing"

	"github.com/dev-fan-sophon/boxai/dto"
	relaycommon "github.com/dev-fan-sophon/boxai/relay/common"
	"github.com/stretchr/testify/assert"
	"github.com/stretchr/testify/require"
)

func TestDeepSeekEffortNoneTurnsThinkingOff(t *testing.T) {
	info := &relaycommon.RelayInfo{ChannelMeta: &relaycommon.ChannelMeta{UpstreamModelName: "deepseek-v4-pro"}}
	request := &dto.GeneralOpenAIRequest{Model: "deepseek-v4-pro", ReasoningEffort: "none"}
	require.NoError(t, applyDeepSeekV4OpenAIThinkingSuffix(info, request))
	assert.JSONEq(t, `{"type":"disabled"}`, string(request.THINKING))
	assert.Empty(t, request.ReasoningEffort)
	assert.Equal(t, "deepseek-v4-pro", request.Model)
}

func TestDeepSeekLegacySuffixStillWins(t *testing.T) {
	info := &relaycommon.RelayInfo{ChannelMeta: &relaycommon.ChannelMeta{UpstreamModelName: "deepseek-v4-pro-max"}}
	request := &dto.GeneralOpenAIRequest{Model: "deepseek-v4-pro-max"}
	require.NoError(t, applyDeepSeekV4OpenAIThinkingSuffix(info, request))
	assert.JSONEq(t, `{"type":"enabled"}`, string(request.THINKING))
	assert.Equal(t, "max", request.ReasoningEffort)
	assert.Equal(t, "deepseek-v4-pro", info.UpstreamModelName)
}

func TestDeepSeekResponsesToolUsageSplitsSearchAndFetch(t *testing.T) {
	response := &dto.OpenAIResponsesResponse{Output: []dto.ResponsesOutput{
		{Type: dto.BuildInCallWebSearchCall, Status: "completed", Action: json.RawMessage(`{"type":"search"}`)},
		{Type: dto.BuildInCallWebSearchCall, Status: "completed", Action: json.RawMessage(`{"type":"open_page"}`)},
		{Type: dto.BuildInCallWebSearchCall, Status: "failed", Action: json.RawMessage(`{"type":"search"}`)},
		{Type: "message", Status: "completed"},
	}}
	info := &relaycommon.RelayInfo{ChannelMeta: &relaycommon.ChannelMeta{}}
	(&Adaptor{}).Init(info)
	info.RelayMode = 0
	info.CountBillableToolCall(dto.BuildInCallWebSearchCall, "")
	info.CountBillableToolCall(dto.BuildInCallWebSearchCall, "")
	info.CountBillableToolCall(dto.BuildInCallWebSearchCall, "")
	info.VendorToolUsage = responsesToolUsage
	info.ApplyVendorToolUsage(response)

	tools := info.ResponsesUsageInfo.BuiltInTools
	assert.Equal(t, 1, tools[SearchToolPriceKey].CallCount, "vendor count replaces the three counted items")
	assert.Equal(t, 1, tools[FetchToolPriceKey].CallCount)
	assert.NotContains(t, tools, dto.BuildInToolWebSearchPreview)
	assert.Nil(t, responsesToolUsage(&dto.OpenAIResponsesResponse{}), "an empty output proves nothing")
}
