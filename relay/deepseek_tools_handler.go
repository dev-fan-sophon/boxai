package relay

import (
	"errors"
	"fmt"
	"io"
	"net/http"

	"github.com/dev-fan-sophon/boxai/common"
	"github.com/dev-fan-sophon/boxai/constant"
	"github.com/dev-fan-sophon/boxai/dto"
	"github.com/dev-fan-sophon/boxai/logger"
	relaycommon "github.com/dev-fan-sophon/boxai/relay/common"
	relayconstant "github.com/dev-fan-sophon/boxai/relay/constant"
	"github.com/dev-fan-sophon/boxai/relay/helper"
	"github.com/dev-fan-sophon/boxai/service"
	"github.com/dev-fan-sophon/boxai/types"

	"github.com/gin-gonic/gin"
	"github.com/tidwall/gjson"
)

// DeepSeekToolsHelper relays the DeepSeek Search and Fetch APIs like
// /v1/alpha/search (upstream 6cf0d90b5): the raw body is forwarded, the
// response is returned unchanged, and the call is billed at the routing name's
// (deepseek-search / deepseek-fetch) per-request price with no tokens.
func DeepSeekToolsHelper(c *gin.Context, info *relaycommon.RelayInfo) *types.NewAPIError {
	info.InitChannelMeta(c)
	switch info.ChannelType {
	case constant.ChannelTypeDeepSeek,
		constant.ChannelTypeNewAPI,
		constant.ChannelTypeSub2API,
		constant.ChannelTypeAdvancedCustom:
	default:
		// Do not skip retries: another allocated channel may support this endpoint.
		return types.NewError(fmt.Errorf("channel does not support %s", c.Request.URL.Path), types.ErrorCodeInvalidRequest)
	}

	request, ok := info.Request.(*dto.DeepSeekToolsRequest)
	if !ok {
		return types.NewErrorWithStatusCode(
			fmt.Errorf("invalid request type, expected *dto.DeepSeekToolsRequest, got %T", info.Request),
			types.ErrorCodeInvalidRequest,
			http.StatusBadRequest,
			types.ErrOptionWithSkipRetry(),
		)
	}
	if err := helper.ModelMappedHelper(c, info, request); err != nil {
		return types.NewError(err, types.ErrorCodeChannelModelMappedError, types.ErrOptionWithSkipRetry())
	}

	// The body names no model; DeepSeek ignores one, so it is forwarded as sent.
	jsonData := []byte(request.RawBody)
	var err error
	if len(info.ParamOverride) > 0 {
		jsonData, err = relaycommon.ApplyParamOverrideWithRelayInfo(jsonData, info)
		if err != nil {
			return newAPIErrorFromParamOverride(err)
		}
	}
	logger.LogDebug(c, "deepseek tools request body: %s", common.LocalLogPreview(string(jsonData)))

	body, closer, err := relaycommon.NewOutboundJSONBody(jsonData)
	if err != nil {
		return types.NewError(err, types.ErrorCodeConvertRequestFailed, types.ErrOptionWithSkipRetry())
	}
	defer closer.Close()

	adaptor := GetAdaptor(info.ApiType)
	if adaptor == nil {
		return types.NewError(fmt.Errorf("invalid api type: %d", info.ApiType), types.ErrorCodeInvalidApiType, types.ErrOptionWithSkipRetry())
	}
	adaptor.Init(info)
	response, err := adaptor.DoRequest(c, info, body)
	if err != nil {
		return types.NewOpenAIError(err, types.ErrorCodeDoRequestFailed, http.StatusInternalServerError)
	}
	httpResponse, ok := response.(*http.Response)
	if !ok || httpResponse == nil {
		return types.NewOpenAIError(errors.New("invalid http response"), types.ErrorCodeDoRequestFailed, http.StatusInternalServerError)
	}
	defer service.CloseResponseBodyGracefully(httpResponse)

	if httpResponse.StatusCode < http.StatusOK || httpResponse.StatusCode >= http.StatusMultipleChoices {
		apiErr := service.RelayErrorHandler(c.Request.Context(), httpResponse, false)
		service.ResetStatusCode(apiErr, c.GetString("status_code_mapping"))
		return apiErr
	}
	responseBody, err := io.ReadAll(httpResponse.Body)
	if err != nil {
		return types.NewOpenAIError(err, types.ErrorCodeReadResponseBodyFailed, http.StatusInternalServerError, types.ErrOptionWithSkipRetry())
	}
	service.IOCopyBytesGracefully(c, httpResponse, responseBody)

	// DeepSeek bills a successful request only when it returns something: a
	// non-empty results array for Search, page content for Fetch. Anything
	// else releases the reservation.
	var billable bool
	if info.RelayMode == relayconstant.RelayModeToolsFetch {
		billable = gjson.GetBytes(responseBody, "content").String() != ""
	} else {
		results := gjson.GetBytes(responseBody, "results")
		billable = results.IsArray() && len(results.Array()) > 0
	}
	if !billable {
		if info.Billing != nil {
			info.Billing.Refund(c)
		}
		return nil
	}
	service.PostTextConsumeQuota(c, info, &dto.Usage{}, nil)
	return nil
}
