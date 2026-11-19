package common

import (
	"fmt"
	"testing"

	"github.com/dev-fan-sophon/boxai/dto"
	"github.com/stretchr/testify/assert"
	"github.com/stretchr/testify/require"
)

func TestCountBillableToolCallCountsOnlyCompletedObservations(t *testing.T) {
	info := &RelayInfo{ResponsesUsageInfo: &ResponsesUsageInfo{BuiltInTools: map[string]*BuildInToolInfo{
		dto.BuildInToolWebSearch: {ToolName: dto.BuildInToolWebSearch},
	}}}

	assert.Zero(t, info.ResponsesUsageInfo.BuiltInTools[dto.BuildInToolWebSearch].CallCount, "declaring a tool must not bill it")
	info.CountBillableToolCall(dto.BuildInCallWebSearchCall, "")
	info.CountBillableToolCall(dto.BuildInCallFileSearchCall, "")
	info.CountBillableToolCall(dto.BuildInCallGoogleSearchCall, "")
	info.CountBillableToolCall(dto.BuildInCallFunctionCall, dto.BuildInToolWebSearch)

	assert.Equal(t, 1, info.ResponsesUsageInfo.BuiltInTools[dto.BuildInToolWebSearch].CallCount)
	assert.Equal(t, 1, info.ResponsesUsageInfo.BuiltInTools[dto.BuildInToolFileSearch].CallCount)
	assert.Equal(t, 1, info.ResponsesUsageInfo.BuiltInTools[dto.BuildInToolGoogleSearch].CallCount)
	assert.NotContains(t, info.ResponsesUsageInfo.BuiltInTools, dto.BuildInToolWebSearchPreview)
}

func TestImageGenerationCallCounterDeduplicatesAndCapsCompletedImages(t *testing.T) {
	counter := &ImageGenerationCallCounter{}
	completed := &dto.ResponsesOutput{Type: dto.ResponsesOutputTypeImageGenerationCall, ID: "image-1", Status: "completed", Result: "base64-one"}
	index := 0
	counter.Observe(completed, &index)
	counter.Observe(completed, &index)
	counter.Observe(&dto.ResponsesOutput{Type: dto.ResponsesOutputTypeImageGenerationCall, ID: "failed", Status: "failed", Result: "base64-failed"}, nil)
	counter.Observe(&dto.ResponsesOutput{Type: dto.ResponsesOutputTypeImageGenerationCall, ID: "empty", Status: "completed"}, nil)
	assert.Equal(t, 1, counter.Count())

	for i := 0; i < dto.MaxImageN+3; i++ {
		counter.Observe(&dto.ResponsesOutput{
			Type:   dto.ResponsesOutputTypeImageGenerationCall,
			ID:     fmt.Sprintf("image-extra-%d", i),
			Status: "completed",
			Result: fmt.Sprintf("base64-extra-%d", i),
		}, nil)
	}
	info := &RelayInfo{}
	counter.Commit(info)
	require.NotNil(t, info.ResponsesUsageInfo)
	assert.Equal(t, dto.MaxImageN, info.ResponsesUsageInfo.BuiltInTools[dto.BuildInToolImageGeneration].CallCount)
}

func TestIsNonBillableResponsesStatus(t *testing.T) {
	for _, status := range []string{`"failed"`, `"incomplete"`, `"cancelled"`, `" CANCELED "`} {
		assert.True(t, IsNonBillableResponsesStatus([]byte(status)), status)
	}
	assert.False(t, IsNonBillableResponsesStatus([]byte(`"completed"`)))
	assert.False(t, IsNonBillableResponsesStatus([]byte(`not-json`)))
}

func TestIsBillableResponsesOutputRequiresTerminalSuccess(t *testing.T) {
	for _, status := range []string{"failed", "incomplete", "partial", "in_progress", "queued"} {
		assert.False(t, IsBillableResponsesOutput(&dto.ResponsesOutput{Status: status}), status)
	}
	assert.True(t, IsBillableResponsesOutput(&dto.ResponsesOutput{Status: "completed"}))
	assert.True(t, IsBillableResponsesOutput(&dto.ResponsesOutput{}), "older providers may omit status on completed output items")
}

func TestSetBillableToolCountReplacesAndIgnoresNegative(t *testing.T) {
	info := &RelayInfo{}
	info.CountBillableToolCall(dto.BuildInCallWebSearchCall, "")
	info.SetBillableToolCount(dto.BuildInToolWebSearchPreview, 4)
	assert.Equal(t, 4, info.ResponsesUsageInfo.BuiltInTools[dto.BuildInToolWebSearchPreview].CallCount)

	info.SetBillableToolCount(dto.BuildInToolWebSearchPreview, -7)
	assert.Equal(t, 4, info.ResponsesUsageInfo.BuiltInTools[dto.BuildInToolWebSearchPreview].CallCount)

	info.SetBillableToolCount(dto.BuildInToolWebSearchPreview, 0)
	assert.Zero(t, info.ResponsesUsageInfo.BuiltInTools[dto.BuildInToolWebSearchPreview].CallCount, "a vendor zero suppresses counted items")
}

func TestRecordClaudeServerToolUseUsesChannelBillingKeys(t *testing.T) {
	info := &RelayInfo{ChannelMeta: &ChannelMeta{WebSearchBillingKey: "deepseek_search", WebFetchBillingKey: "deepseek_fetch"}}
	info.RecordClaudeServerToolUse(&dto.ClaudeServerToolUse{WebSearchRequests: 2, WebFetchRequests: 1})
	assert.Equal(t, 2, info.ResponsesUsageInfo.BuiltInTools["deepseek_search"].CallCount)
	assert.Equal(t, 1, info.ResponsesUsageInfo.BuiltInTools["deepseek_fetch"].CallCount)
	assert.NotContains(t, info.ResponsesUsageInfo.BuiltInTools, dto.BuildInToolWebSearch)
}

func TestClientFunctionNamedLikeHostedSearchKeyIsNotBilled(t *testing.T) {
	info := &RelayInfo{}
	for _, name := range []string{GoogleSearchGroundedPromptTool, "bing_web_search", "deepseek_search", "web_fetch"} {
		info.CountBillableToolCall(dto.BuildInCallFunctionCall, name)
	}
	assert.Empty(t, info.ResponsesUsageInfo.BuiltInTools)
}
