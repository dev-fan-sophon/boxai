package openai

import (
	"fmt"
	"io"
	"net/http"
	"strings"

	"github.com/dev-fan-sophon/boxai/common"
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

	accumulator := service.NewResponsesUsageAccumulator(info)

	helper.StreamScannerHandler(c, resp, info, func(data string, sr *helper.StreamResult) {
		var streamResponse dto.ResponsesStreamResponse
		if err := common.UnmarshalJsonStr(data, &streamResponse); err != nil {
			logger.LogError(c, "failed to unmarshal stream response: "+err.Error())
			sr.Error(err)
			return
		}
		sendResponsesStreamData(c, streamResponse, data)
		accumulator.Observe(&streamResponse)
	})
	return accumulator.Finish(c), nil
}
