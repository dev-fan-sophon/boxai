package deepseek

import (
	"github.com/dev-fan-sophon/boxai/dto"

	"github.com/tidwall/gjson"
)

// responsesToolUsage bills the Search and Fetch API calls DeepSeek runs for
// the Responses web_search tool from the web_search_call items of the whole
// response; its usage reports tokens only (upstream 6cf0d90b5). An open_page
// action is a Fetch call, any other action a Search call, and a failed call
// is free. The counts replace the web_search_call items counted while the
// stream was running. An empty output proves nothing, so those counts stay.
func responsesToolUsage(response *dto.OpenAIResponsesResponse) map[string]int {
	if len(response.Output) == 0 {
		return nil
	}
	counts := map[string]int{SearchToolPriceKey: 0, FetchToolPriceKey: 0}
	for _, item := range response.Output {
		if item.Type != dto.BuildInCallWebSearchCall || item.Status != "completed" {
			continue
		}
		if gjson.GetBytes(item.Action, "type").String() == "open_page" {
			counts[FetchToolPriceKey]++
		} else {
			counts[SearchToolPriceKey]++
		}
	}
	return counts
}
