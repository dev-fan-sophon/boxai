package openai

import (
	"fmt"
	"io"
	"net/http"
	"strings"

	"github.com/dev-fan-sophon/boxai/common"
	"github.com/dev-fan-sophon/boxai/constant"
	"github.com/dev-fan-sophon/boxai/dto"
	"github.com/dev-fan-sophon/boxai/logger"
	relaycommon "github.com/dev-fan-sophon/boxai/relay/common"
	"github.com/dev-fan-sophon/boxai/relay/helper"
	"github.com/dev-fan-sophon/boxai/service"
	"github.com/dev-fan-sophon/boxai/types"

	"github.com/gin-gonic/gin"
)

func OaiResponsesHandler(c *gin.Context, info *relaycommon.RelayInfo, resp *http.Response) (*dto.Usage, *types.NewAPIError) {
	defer service.CloseResponseBodyGracefully(resp)

	// read response body
	var responsesResponse dto.OpenAIResponsesResponse
	responseBody, err := io.ReadAll(resp.Body)
	if err != nil {
		return nil, types.NewOpenAIError(err, types.ErrorCodeReadResponseBodyFailed, http.StatusInternalServerError)
	}
	err = common.Unmarshal(responseBody, &responsesResponse)
	if err != nil {
		return nil, types.NewOpenAIError(err, types.ErrorCodeBadResponseBody, http.StatusInternalServerError)
	}
	if oaiError := responsesResponse.GetOpenAIError(); oaiError != nil && oaiError.Type != "" {
		return nil, types.WithOpenAIError(*oaiError, resp.StatusCode)
	}
	if c.GetBool("playground_managed_search") {
		c.Set("playground_search_response", &responsesResponse)
		c.Set("playground_search_response_body", responseBody)
		c.Set("playground_search_response_content_type", resp.Header.Get("Content-Type"))
	}

	// Managed Playground Search persists and validates the buffered response in
	// its controller before exposing it to the browser.
	if !c.GetBool("playground_managed_search") {
		service.IOCopyBytesGracefully(c, resp, responseBody)
	}

	// compute usage
	usage := dto.Usage{}
	if responsesResponse.Usage != nil {
		usage.PromptTokens = responsesResponse.Usage.InputTokens
		usage.CompletionTokens = responsesResponse.Usage.OutputTokens
		usage.TotalTokens = responsesResponse.Usage.TotalTokens
		if responsesResponse.Usage.InputTokensDetails != nil {
			usage.PromptTokensDetails.CachedTokens = responsesResponse.Usage.InputTokensDetails.CachedTokens
			usage.PromptTokensDetails.CacheWriteTokens = responsesResponse.Usage.InputTokensDetails.CacheWriteTokens
		}
	}
	if info == nil || info.ResponsesUsageInfo == nil || info.ResponsesUsageInfo.BuiltInTools == nil {
		return &usage, nil
	}
	if c.GetBool("playground_managed_search") {
		webCalls, xCalls := 0, 0
		if responsesResponse.Usage != nil && responsesResponse.Usage.ServerSideToolUsage != nil {
			webCalls = responsesResponse.Usage.ServerSideToolUsage.WebSearchCalls
			xCalls = responsesResponse.Usage.ServerSideToolUsage.XSearchCalls
		} else {
			for _, output := range responsesResponse.Output {
				switch output.Type {
				case dto.BuildInCallWebSearchCall:
					webCalls++
				case dto.BuildInCallXSearchCall:
					xCalls++
				case "custom_tool_call":
					if strings.HasPrefix(output.Name, "x_") {
						xCalls++
					}
				}
			}
		}
		if tool := info.ResponsesUsageInfo.BuiltInTools[dto.BuildInToolXAIWebSearch]; tool != nil {
			tool.CallCount = webCalls
		}
		if tool := info.ResponsesUsageInfo.BuiltInTools[dto.BuildInToolXAIXSearch]; tool != nil {
			tool.CallCount = xCalls
		}
		return &usage, nil
	}
	for _, output := range responsesResponse.Output {
		if !relaycommon.IsBillableResponsesOutput(&output) {
			continue
		}
		switch output.Type {
		case dto.BuildInCallWebSearchCall:
			info.CountBillableToolCall(dto.BuildInCallWebSearchCall, "")
		case dto.BuildInCallFileSearchCall:
			info.CountBillableToolCall(dto.BuildInCallFileSearchCall, "")
		case dto.BuildInCallFunctionCall:
			info.CountBillableToolCall(dto.BuildInCallFunctionCall, output.Name)
		}
	}

	imageCounter := &relaycommon.ImageGenerationCallCounter{}
	if !relaycommon.IsNonBillableResponsesStatus(responsesResponse.Status) {
		for index := range responsesResponse.Output {
			output := &responsesResponse.Output[index]
			before := imageCounter.Count()
			imageCounter.Observe(output, &index)
			if imageCounter.Count() > before {
				c.Set("image_generation_call_quality", output.Quality)
				c.Set("image_generation_call_size", output.Size)
			}
		}
	}
	imageCounter.Commit(info)
	if imageCounter.Count() > 0 {
		c.Set("image_generation_call", true)
		c.Set("image_generation_call_count", min(imageCounter.Count(), dto.MaxImageN))
	}
	return &usage, nil
}

func OaiResponsesStreamHandler(c *gin.Context, info *relaycommon.RelayInfo, resp *http.Response) (*dto.Usage, *types.NewAPIError) {
	if resp == nil || resp.Body == nil {
		logger.LogError(c, "invalid response or response body")
		return nil, types.NewError(fmt.Errorf("invalid response"), types.ErrorCodeBadResponse)
	}

	defer service.CloseResponseBodyGracefully(resp)

	var usage = &dto.Usage{}
	var responseTextBuilder strings.Builder
	hasUsage := false
	upstreamFailed := false
	receivedEvent := false
	receivedTerminal := false
	imageCounter := &relaycommon.ImageGenerationCallCounter{}
	imageCommitted := false
	imageQuality := ""
	imageSize := ""
	seenToolItems := make(map[string]struct{})

	helper.StreamScannerHandler(c, resp, info, func(data string, sr *helper.StreamResult) {

		// 检查当前数据是否包含 completed 状态和 usage 信息
		var streamResponse dto.ResponsesStreamResponse
		if err := common.UnmarshalJsonStr(data, &streamResponse); err != nil {
			logger.LogError(c, "failed to unmarshal stream response: "+err.Error())
			sr.Error(err)
			return
		}
		receivedEvent = true
		sendResponsesStreamData(c, streamResponse, data)
		if response := streamResponse.Response; response != nil {
			if string(response.Status) == `"failed"` || response.GetOpenAIError() != nil {
				upstreamFailed = true
				sr.Error(fmt.Errorf("upstream Responses failure"))
			}
			if actual := response.Usage; actual != nil {
				hasUsage = true
				usage.PromptTokens = actual.InputTokens
				usage.CompletionTokens = actual.OutputTokens
				usage.TotalTokens = actual.TotalTokens
				if actual.InputTokensDetails != nil {
					usage.PromptTokensDetails.CachedTokens = actual.InputTokensDetails.CachedTokens
					usage.PromptTokensDetails.CacheWriteTokens = actual.InputTokensDetails.CacheWriteTokens
				}
			}
		}
		switch streamResponse.Type {
		case "error", "response.failed":
			receivedTerminal = true
			if !upstreamFailed {
				sr.Error(fmt.Errorf("upstream Responses failure"))
			}
			upstreamFailed = true
			if !imageCommitted {
				imageCounter.Reset()
				imageCounter.Commit(info)
				imageCommitted = true
			}
		case "response.completed", "response.done":
			receivedTerminal = true
			if streamResponse.Response != nil {
				if !imageCommitted {
					if relaycommon.IsNonBillableResponsesStatus(streamResponse.Response.Status) {
						imageCounter.Reset()
					} else {
						for index := range streamResponse.Response.Output {
							output := &streamResponse.Response.Output[index]
							before := imageCounter.Count()
							imageCounter.Observe(output, &index)
							if imageCounter.Count() > before {
								imageQuality = output.Quality
								imageSize = output.Size
							}
						}
					}
					imageCounter.Commit(info)
					imageCommitted = true
				}
			} else if !imageCommitted {
				imageCounter.Commit(info)
				imageCommitted = true
			}
		case "response.incomplete", "response.cancelled", "response.canceled":
			receivedTerminal = true
			sr.Error(fmt.Errorf("upstream Responses did not complete: %s", streamResponse.Type))
			if !imageCommitted {
				imageCounter.Reset()
				imageCounter.Commit(info)
				imageCommitted = true
			}
		case "response.output_text.delta", "response.function_call_arguments.delta",
			"response.reasoning_text.delta", "response.reasoning_summary_text.delta", "response.refusal.delta":
			// Only deltas: done events repeat the same content.
			responseTextBuilder.WriteString(streamResponse.Delta)
		case dto.ResponsesOutputTypeItemDone:
			if relaycommon.IsBillableResponsesOutput(streamResponse.Item) {
				identity := responsesStreamToolIdentity(&streamResponse)
				if identity != "" {
					if _, exists := seenToolItems[identity]; exists {
						break
					}
					seenToolItems[identity] = struct{}{}
				}
				switch streamResponse.Item.Type {
				case dto.BuildInCallWebSearchCall:
					info.CountBillableToolCall(dto.BuildInCallWebSearchCall, "")
				case dto.BuildInCallFileSearchCall:
					info.CountBillableToolCall(dto.BuildInCallFileSearchCall, "")
				case dto.BuildInCallFunctionCall:
					info.CountBillableToolCall(dto.BuildInCallFunctionCall, streamResponse.Item.Name)
				case dto.ResponsesOutputTypeImageGenerationCall:
					if !imageCommitted {
						before := imageCounter.Count()
						imageCounter.Observe(streamResponse.Item, streamResponse.OutputIndex)
						if imageCounter.Count() > before {
							imageQuality = streamResponse.Item.Quality
							imageSize = streamResponse.Item.Size
						}
					}
				}
			}
		}
	})
	if !receivedTerminal {
		info.StreamStatus.RecordError("upstream Responses ended without a terminal event")
	}
	if imageCommitted && imageCounter.Count() > 0 {
		c.Set("image_generation_call", true)
		c.Set("image_generation_call_count", min(imageCounter.Count(), dto.MaxImageN))
		c.Set("image_generation_call_quality", imageQuality)
		c.Set("image_generation_call_size", imageSize)
	}

	if !hasUsage && !upstreamFailed {
		// 计算输出文本的 token 数量
		tempStr := responseTextBuilder.String()
		if len(tempStr) > 0 {
			// 非正常结束，使用输出文本的 token 数量
			completionTokens := service.CountTextToken(tempStr, info.UpstreamModelName)
			usage.CompletionTokens = completionTokens
		}
	}

	if !hasUsage && !upstreamFailed && receivedEvent {
		usage.PromptTokens = info.GetEstimatePromptTokens()
		common.SetContextKey(c, constant.ContextKeyLocalCountTokens, true)
	}

	if !hasUsage || usage.TotalTokens == 0 {
		var clamp *common.QuotaClamp
		usage.TotalTokens, clamp = common.QuotaFromFloatChecked(float64(usage.PromptTokens) + float64(usage.CompletionTokens))
		if clamp != nil {
			info.QuotaClamp = clamp
		}
	}

	return usage, nil
}

func responsesStreamToolIdentity(response *dto.ResponsesStreamResponse) string {
	if response == nil || response.Item == nil {
		return ""
	}
	if response.Item.ID != "" {
		return "id:" + response.Item.ID
	}
	if response.Item.CallId != "" {
		return "call:" + response.Item.CallId
	}
	if response.OutputIndex != nil {
		return fmt.Sprintf("index:%d", *response.OutputIndex)
	}
	return ""
}
