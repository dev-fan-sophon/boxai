package openai

import (
	"encoding/json"
	"testing"

	"github.com/dev-fan-sophon/boxai/dto"
	relaycommon "github.com/dev-fan-sophon/boxai/relay/common"
	"github.com/stretchr/testify/assert"
	"github.com/stretchr/testify/require"
)

func TestAzureResponsesToolUsageReplacesWebSearchCallItems(t *testing.T) {
	info := &relaycommon.RelayInfo{ChannelMeta: &relaycommon.ChannelMeta{VendorToolUsage: azureResponsesToolUsage}}
	info.CountBillableToolCall(dto.BuildInCallWebSearchCall, "")
	info.CountBillableToolCall(dto.BuildInCallWebSearchCall, "")

	info.ApplyVendorToolUsage(&dto.OpenAIResponsesResponse{ToolUsage: &dto.ResponsesToolUsage{WebSearch: json.RawMessage(`{"num_requests":5}`)}})

	tools := info.ResponsesUsageInfo.BuiltInTools
	require.Contains(t, tools, "bing_web_search")
	assert.Equal(t, 5, tools["bing_web_search"].CallCount)
	assert.Zero(t, tools[dto.BuildInToolWebSearchPreview].CallCount)
}

func TestAzureResponsesToolUsageIgnoresMissingOrInvalidCounts(t *testing.T) {
	assert.Nil(t, azureResponsesToolUsage(&dto.OpenAIResponsesResponse{}))
	assert.Nil(t, azureResponsesToolUsage(&dto.OpenAIResponsesResponse{ToolUsage: &dto.ResponsesToolUsage{WebSearch: json.RawMessage(`{}`)}}))

	var decoded dto.OpenAIResponsesResponse
	require.NoError(t, json.Unmarshal([]byte(`{"tool_usage":{"web_search":{"num_requests":"many"}}}`), &decoded), "a malformed vendor count must not fail response decoding")
	assert.Equal(t, 0, azureResponsesToolUsage(&decoded)["bing_web_search"])
}
