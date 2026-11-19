package openai

import (
	"github.com/dev-fan-sophon/boxai/dto"

	"github.com/tidwall/gjson"
)

// azureResponsesToolUsage bills Azure Responses web search by the Bing request
// count the service reports (tool_usage.web_search.num_requests, $14 per 1,000
// transactions) under its own key, and silences the web_search_call items:
// Azure documents "Use tool_usage.web_search.num_requests" rather than
// counting web_search_call (upstream acb347a19). gjson truncates fractional
// values and reads non-numbers as zero; SetBillableToolCount ignores negatives
// and settlement applies MaxBillableToolCallCount.
func azureResponsesToolUsage(response *dto.OpenAIResponsesResponse) map[string]int {
	if response.ToolUsage == nil || len(response.ToolUsage.WebSearch) == 0 {
		return nil
	}
	count := gjson.GetBytes(response.ToolUsage.WebSearch, "num_requests")
	if !count.Exists() {
		return nil
	}
	return map[string]int{
		"bing_web_search":               int(count.Int()),
		dto.BuildInToolWebSearch:        0,
		dto.BuildInToolWebSearchPreview: 0,
	}
}
