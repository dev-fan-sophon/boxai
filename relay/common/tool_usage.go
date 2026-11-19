package common

import (
	"cmp"
	"crypto/sha256"
	"encoding/hex"
	"fmt"
	"strings"

	basecommon "github.com/dev-fan-sophon/boxai/common"
	"github.com/dev-fan-sophon/boxai/dto"
	"github.com/dev-fan-sophon/boxai/setting/operation_setting"
)

// GoogleSearchGroundedPromptTool bills Gemini 2.5-and-older Google Search
// grounding, charged once per grounded prompt (upstream d10f11fff).
const GoogleSearchGroundedPromptTool = "google_search_grounded_prompt"

// MaxBillableToolCallCount bounds every tool count at settlement, whatever its
// source, before it becomes a surcharge multiplier (upstream acb347a19).
const MaxBillableToolCallCount = 10_000

// reservedBillableToolNames are hosted-tool price keys. A client function or
// tool_use with the same name is never counted under them.
var reservedBillableToolNames = map[string]struct{}{
	dto.BuildInToolWebSearchPreview: {},
	dto.BuildInToolWebSearch:        {},
	dto.BuildInToolFileSearch:       {},
	dto.BuildInToolGoogleSearch:     {},
	dto.BuildInToolImageGeneration:  {},
	GoogleSearchGroundedPromptTool:  {},
	"bing_web_search":               {},
	"web_fetch":                     {},
	"code_execution":                {},
	"tool_search":                   {},
	"deepseek_search":               {},
	"deepseek_fetch":                {},
}

// CountBillableToolCall is the single entry point for completed tool-call counts.
// Custom functions only count when the exact function has a positive configured price.
func (info *RelayInfo) CountBillableToolCall(itemType string, functionName string) {
	if info == nil {
		return
	}
	if info.ResponsesUsageInfo == nil {
		info.ResponsesUsageInfo = &ResponsesUsageInfo{BuiltInTools: make(map[string]*BuildInToolInfo)}
	}
	if info.ResponsesUsageInfo.BuiltInTools == nil {
		info.ResponsesUsageInfo.BuiltInTools = make(map[string]*BuildInToolInfo)
	}

	switch itemType {
	case dto.BuildInCallWebSearchCall:
		name := resolveWebSearchToolName(info.ResponsesUsageInfo.BuiltInTools)
		if info.ChannelMeta != nil && info.WebSearchBillingKey != "" {
			name = info.WebSearchBillingKey
		}
		info.incrementBillableToolCall(name)
	case dto.BuildInCallFileSearchCall:
		info.incrementBillableToolCall(dto.BuildInToolFileSearch)
	case dto.BuildInCallGoogleSearchCall:
		info.incrementBillableToolCall(dto.BuildInToolGoogleSearch)
	case dto.BuildInCallFunctionCall, dto.BuildInCallToolUse:
		if functionName == "" {
			return
		}
		if _, reserved := reservedBillableToolNames[functionName]; reserved {
			return
		}
		if operation_setting.GetToolPriceForModel(functionName, info.OriginModelName) <= 0 {
			return
		}
		info.incrementBillableToolCall(functionName)
	}
}

// SetBillableToolCount records a vendor-reported count for one tool-price key,
// replacing whatever per-item counting produced for the same key. Zero is a
// valid value: a vendor billing field that reports zero suppresses the items
// counted under that key. Negative counts are ignored; settlement caps every
// count at MaxBillableToolCallCount.
func (info *RelayInfo) SetBillableToolCount(name string, count int) {
	if info == nil || name == "" {
		return
	}
	if count < 0 {
		basecommon.SysError(fmt.Sprintf("billable tool count ignored: tool=%s count=%d", name, count))
		return
	}
	if info.ResponsesUsageInfo == nil {
		info.ResponsesUsageInfo = &ResponsesUsageInfo{}
	}
	if info.ResponsesUsageInfo.BuiltInTools == nil {
		info.ResponsesUsageInfo.BuiltInTools = make(map[string]*BuildInToolInfo)
	}
	if existing := info.ResponsesUsageInfo.BuiltInTools[name]; existing != nil {
		existing.CallCount = count
		return
	}
	info.ResponsesUsageInfo.BuiltInTools[name] = &BuildInToolInfo{ToolName: name, CallCount: count}
}

// ApplyVendorToolUsage writes the counts the channel's vendor reports for one
// Responses body. Keys the vendor does not mention are kept.
func (info *RelayInfo) ApplyVendorToolUsage(response *dto.OpenAIResponsesResponse) {
	if info == nil || info.ChannelMeta == nil || info.VendorToolUsage == nil || response == nil {
		return
	}
	for name, count := range info.VendorToolUsage(response) {
		info.SetBillableToolCount(name, count)
	}
}

// RecordClaudeServerToolUse bills the server tool requests Anthropic reports
// in usage.server_tool_use. The report is cumulative, so it replaces earlier
// counts. Searches and fetches use the channel's own price keys when its
// adaptor sets them; web_fetch, code_execution and tool_search have no
// built-in price and bill only once an operator prices them.
func (info *RelayInfo) RecordClaudeServerToolUse(serverToolUse *dto.ClaudeServerToolUse) {
	if info == nil || serverToolUse == nil {
		return
	}
	searchKey, fetchKey := dto.BuildInToolWebSearch, "web_fetch"
	if info.ChannelMeta != nil {
		searchKey = cmp.Or(info.WebSearchBillingKey, searchKey)
		fetchKey = cmp.Or(info.WebFetchBillingKey, fetchKey)
	}
	for name, count := range map[string]int{
		searchKey:        serverToolUse.WebSearchRequests,
		fetchKey:         serverToolUse.WebFetchRequests,
		"code_execution": serverToolUse.CodeExecutionRequests,
		"tool_search":    serverToolUse.ToolSearchRequests,
	} {
		if count > 0 {
			info.SetBillableToolCount(name, count)
		}
	}
}

func resolveWebSearchToolName(tools map[string]*BuildInToolInfo) string {
	if _, ok := tools[dto.BuildInToolWebSearchPreview]; ok {
		return dto.BuildInToolWebSearchPreview
	}
	if _, ok := tools[dto.BuildInToolWebSearch]; ok {
		return dto.BuildInToolWebSearch
	}
	return dto.BuildInToolWebSearchPreview
}

func (info *RelayInfo) incrementBillableToolCall(name string) {
	if existing := info.ResponsesUsageInfo.BuiltInTools[name]; existing != nil {
		existing.CallCount++
		return
	}
	info.ResponsesUsageInfo.BuiltInTools[name] = &BuildInToolInfo{ToolName: name, CallCount: 1}
}

// ImageGenerationCallCounter counts completed Responses image outputs with
// stream-safe identity deduplication.
type ImageGenerationCallCounter struct {
	seen  map[string]struct{}
	count int
}

func (counter *ImageGenerationCallCounter) Observe(item *dto.ResponsesOutput, outputIndex *int) {
	if counter == nil || item == nil || item.Type != dto.ResponsesOutputTypeImageGenerationCall {
		return
	}
	if strings.TrimSpace(item.Result) == "" {
		return
	}
	if !IsBillableResponsesOutput(item) {
		return
	}

	aliases := make([]string, 0, 4)
	if item.ID != "" {
		aliases = append(aliases, "id:"+item.ID)
	}
	if item.CallId != "" {
		aliases = append(aliases, "call:"+item.CallId)
	}
	if outputIndex != nil && *outputIndex >= 0 {
		aliases = append(aliases, fmt.Sprintf("index:%d", *outputIndex))
	}
	sum := sha256.Sum256([]byte(item.Result))
	aliases = append(aliases, "result:"+hex.EncodeToString(sum[:]))

	if counter.seen == nil {
		counter.seen = make(map[string]struct{})
	}
	for _, alias := range aliases {
		if _, ok := counter.seen[alias]; ok {
			return
		}
	}
	for _, alias := range aliases {
		counter.seen[alias] = struct{}{}
	}
	counter.count++
}

func (counter *ImageGenerationCallCounter) Reset() {
	if counter == nil {
		return
	}
	counter.seen = nil
	counter.count = 0
}

func (counter *ImageGenerationCallCounter) Count() int {
	if counter == nil {
		return 0
	}
	return counter.count
}

func (counter *ImageGenerationCallCounter) Commit(info *RelayInfo) {
	if info == nil {
		return
	}
	if info.ResponsesUsageInfo == nil {
		info.ResponsesUsageInfo = &ResponsesUsageInfo{BuiltInTools: make(map[string]*BuildInToolInfo)}
	}
	if info.ResponsesUsageInfo.BuiltInTools == nil {
		info.ResponsesUsageInfo.BuiltInTools = make(map[string]*BuildInToolInfo)
	}
	count := counter.Count()
	if count > dto.MaxImageN {
		count = dto.MaxImageN
	}
	if existing := info.ResponsesUsageInfo.BuiltInTools[dto.BuildInToolImageGeneration]; existing != nil {
		existing.CallCount = count
		return
	}
	info.ResponsesUsageInfo.BuiltInTools[dto.BuildInToolImageGeneration] = &BuildInToolInfo{
		ToolName:  dto.BuildInToolImageGeneration,
		CallCount: count,
	}
}

func IsBillableResponsesOutput(item *dto.ResponsesOutput) bool {
	if item == nil {
		return false
	}
	switch strings.ToLower(strings.TrimSpace(item.Status)) {
	case "failed", "cancelled", "canceled", "incomplete", "partial", "in_progress", "queued":
		return false
	default:
		return true
	}
}

func IsNonBillableResponsesStatus(status []byte) bool {
	if len(status) == 0 {
		return false
	}
	var value string
	if err := basecommon.Unmarshal(status, &value); err != nil {
		return false
	}
	switch strings.ToLower(strings.TrimSpace(value)) {
	case "failed", "cancelled", "canceled", "incomplete":
		return true
	default:
		return false
	}
}
