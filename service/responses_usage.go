package service

import (
	"fmt"
	"strings"

	"github.com/dev-fan-sophon/boxai/common"
	"github.com/dev-fan-sophon/boxai/constant"
	"github.com/dev-fan-sophon/boxai/dto"
	relaycommon "github.com/dev-fan-sophon/boxai/relay/common"

	"github.com/gin-gonic/gin"
)

// ResponsesUsageAccumulator owns the accounting facts of one native Responses
// event stream. HTTP SSE and WebSocket turns share this settlement contract:
//
//   - usage on a terminal event is upstream's authoritative bill, including
//     explicit zeros;
//   - usage on non-terminal events only backs interrupted streams and never
//     suppresses local estimation, even when it is a zero placeholder;
//   - an explicit upstream failure bills nothing locally;
//   - any other stream that produced events keeps its prompt and delivered
//     output, also when it was interrupted before a terminal event.
//
// Observe and Finish must be called by the single stream owner.
type ResponsesUsageAccumulator struct {
	info *relaycommon.RelayInfo

	usage              dto.Usage
	partialUsage       dto.Usage
	hasUsage           bool
	upstreamFailed     bool
	receivedEvent      bool
	receivedTerminal   bool
	outputText         strings.Builder
	terminalOutputText string

	imageCounter   relaycommon.ImageGenerationCallCounter
	imageCommitted bool
	imageQuality   string
	imageSize      string
	seenToolItems  map[string]struct{}

	finished bool
}

func NewResponsesUsageAccumulator(info *relaycommon.RelayInfo) *ResponsesUsageAccumulator {
	return &ResponsesUsageAccumulator{info: info, seenToolItems: make(map[string]struct{})}
}

// ObserveMalformed records an upstream frame that could not be decoded. Like
// the SSE handler it is a protocol error, not a billable event.
func (a *ResponsesUsageAccumulator) ObserveMalformed() {
	a.info.StreamStatus.RecordError("invalid upstream Responses event")
}

func (a *ResponsesUsageAccumulator) Observe(event *dto.ResponsesStreamResponse) {
	if event == nil || a.finished {
		return
	}
	a.receivedEvent = true
	isTerminal := false
	switch event.Type {
	case "response.completed", "response.done", "response.failed",
		"response.incomplete", "response.cancelled", "response.canceled":
		isTerminal = true
	}
	if response := event.Response; response != nil {
		if string(response.Status) == `"failed"` || response.GetOpenAIError() != nil {
			if !a.upstreamFailed {
				a.info.StreamStatus.RecordError("upstream Responses failure")
			}
			a.upstreamFailed = true
		}
		if actual := response.Usage; actual != nil && isTerminal {
			a.hasUsage = true
			a.usage.PromptTokens = actual.InputTokens
			a.usage.CompletionTokens = actual.OutputTokens
			a.usage.TotalTokens = actual.TotalTokens
			if actual.InputTokensDetails != nil {
				a.usage.PromptTokensDetails.CachedTokens = actual.InputTokensDetails.CachedTokens
				a.usage.PromptTokensDetails.CacheWriteTokens = actual.InputTokensDetails.CacheWriteTokens
			}
		} else if actual != nil {
			if actual.InputTokens > 0 {
				a.partialUsage.PromptTokens = actual.InputTokens
				if actual.InputTokensDetails != nil {
					a.partialUsage.PromptTokensDetails.CachedTokens = actual.InputTokensDetails.CachedTokens
					a.partialUsage.PromptTokensDetails.CacheWriteTokens = actual.InputTokensDetails.CacheWriteTokens
				}
			}
			a.partialUsage.CompletionTokens = max(a.partialUsage.CompletionTokens, actual.OutputTokens)
		}
		if isTerminal && a.terminalOutputText == "" {
			// Some upstreams carry the generated output only on the terminal
			// event; keep it for the missing-usage estimate.
			var terminalText strings.Builder
			terminalText.WriteString(ExtractOutputTextFromResponses(response))
			for index := range response.Output {
				if response.Output[index].Type == dto.BuildInCallFunctionCall {
					terminalText.WriteString(response.Output[index].ArgumentsString())
				} else if response.Output[index].Type == "custom_tool_call" {
					terminalText.WriteString(common.JsonRawMessageToString(response.Output[index].Input))
				}
			}
			a.terminalOutputText = terminalText.String()
		}
	}

	switch event.Type {
	case "error", "response.error", "response.failed":
		a.receivedTerminal = true
		if !a.upstreamFailed {
			a.info.StreamStatus.RecordError("upstream Responses failure")
		}
		a.upstreamFailed = true
		a.commitImages(true)
	case "response.completed", "response.done":
		a.receivedTerminal = true
		if a.imageCommitted || event.Response == nil {
			a.commitImages(false)
			return
		}
		if relaycommon.IsNonBillableResponsesStatus(event.Response.Status) {
			a.commitImages(true)
			return
		}
		for index := range event.Response.Output {
			a.observeImage(&event.Response.Output[index], &index)
		}
		a.commitImages(false)
	case "response.incomplete", "response.cancelled", "response.canceled":
		a.receivedTerminal = true
		a.info.StreamStatus.RecordError(fmt.Sprintf("upstream Responses did not complete: %s", event.Type))
		a.commitImages(true)
	case "response.output_text.delta", "response.function_call_arguments.delta",
		"response.reasoning_text.delta", "response.reasoning_summary_text.delta", "response.refusal.delta",
		"response.custom_tool_call_input.delta":
		// Only deltas: done events repeat the same content.
		a.outputText.WriteString(event.Delta)
	case dto.ResponsesOutputTypeItemDone:
		if !relaycommon.IsBillableResponsesOutput(event.Item) {
			return
		}
		if identity := responsesStreamToolIdentity(event); identity != "" {
			if _, exists := a.seenToolItems[identity]; exists {
				return
			}
			a.seenToolItems[identity] = struct{}{}
		}
		switch event.Item.Type {
		case dto.BuildInCallWebSearchCall:
			a.info.CountBillableToolCall(dto.BuildInCallWebSearchCall, "")
		case dto.BuildInCallFileSearchCall:
			a.info.CountBillableToolCall(dto.BuildInCallFileSearchCall, "")
		case dto.BuildInCallFunctionCall:
			a.info.CountBillableToolCall(dto.BuildInCallFunctionCall, event.Item.Name)
		case dto.ResponsesOutputTypeImageGenerationCall:
			if !a.imageCommitted {
				a.observeImage(event.Item, event.OutputIndex)
			}
		}
	}
}

func (a *ResponsesUsageAccumulator) observeImage(item *dto.ResponsesOutput, outputIndex *int) {
	before := a.imageCounter.Count()
	a.imageCounter.Observe(item, outputIndex)
	if a.imageCounter.Count() > before {
		a.imageQuality = item.Quality
		a.imageSize = item.Size
	}
}

// commitImages settles image generation calls once, at the first terminal
// event; reset discards images of a failed or non-billable response.
func (a *ResponsesUsageAccumulator) commitImages(reset bool) {
	if a.imageCommitted {
		return
	}
	if reset {
		a.imageCounter.Reset()
	}
	a.imageCounter.Commit(a.info)
	a.imageCommitted = true
}

// Finish returns the usage to settle and publishes the per-request billing
// facts (local estimation, image calls, quota clamp) on c and the relay info.
func (a *ResponsesUsageAccumulator) Finish(c *gin.Context) *dto.Usage {
	if a.finished {
		return &a.usage
	}
	a.finished = true
	if !a.receivedTerminal {
		a.info.StreamStatus.RecordError("upstream Responses ended without a terminal event")
	}
	if a.imageCommitted && a.imageCounter.Count() > 0 {
		c.Set("image_generation_call", true)
		c.Set("image_generation_call_count", min(a.imageCounter.Count(), dto.MaxImageN))
		c.Set("image_generation_call_quality", a.imageQuality)
		c.Set("image_generation_call_size", a.imageSize)
	}

	if !a.hasUsage && !a.upstreamFailed && a.receivedEvent {
		outputText := a.outputText.String()
		if outputText == "" {
			outputText = a.terminalOutputText
		}
		if outputText != "" {
			a.usage.CompletionTokens = CountTextToken(outputText, a.info.UpstreamModelName)
		}
		// Upstream running totals are lower bounds of what was generated.
		a.usage.CompletionTokens = max(a.usage.CompletionTokens, a.partialUsage.CompletionTokens)
		if a.partialUsage.PromptTokens > 0 {
			a.usage.PromptTokens = a.partialUsage.PromptTokens
			a.usage.PromptTokensDetails.CachedTokens = a.partialUsage.PromptTokensDetails.CachedTokens
			a.usage.PromptTokensDetails.CacheWriteTokens = a.partialUsage.PromptTokensDetails.CacheWriteTokens
		} else {
			a.usage.PromptTokens = a.info.GetEstimatePromptTokens()
		}
		common.SetContextKey(c, constant.ContextKeyLocalCountTokens, true)
	}

	if !a.hasUsage || a.usage.TotalTokens == 0 {
		var clamp *common.QuotaClamp
		a.usage.TotalTokens, clamp = common.QuotaFromFloatChecked(float64(a.usage.PromptTokens) + float64(a.usage.CompletionTokens))
		if clamp != nil {
			a.info.QuotaClamp = clamp
		}
	}
	return &a.usage
}

func responsesStreamToolIdentity(event *dto.ResponsesStreamResponse) string {
	if event == nil || event.Item == nil {
		return ""
	}
	if event.Item.ID != "" {
		return "id:" + event.Item.ID
	}
	if event.Item.CallId != "" {
		return "call:" + event.Item.CallId
	}
	if event.OutputIndex != nil {
		return fmt.Sprintf("index:%d", *event.OutputIndex)
	}
	return ""
}
