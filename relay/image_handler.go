package relay

import (
	"bytes"
	"encoding/json"
	"fmt"
	"io"
	"net/http"
	"strconv"
	"strings"

	"github.com/dev-fan-sophon/boxai/common"
	"github.com/dev-fan-sophon/boxai/constant"
	"github.com/dev-fan-sophon/boxai/dto"
	"github.com/dev-fan-sophon/boxai/logger"
	relaycommon "github.com/dev-fan-sophon/boxai/relay/common"
	relayconstant "github.com/dev-fan-sophon/boxai/relay/constant"
	"github.com/dev-fan-sophon/boxai/relay/helper"
	"github.com/dev-fan-sophon/boxai/service"
	"github.com/dev-fan-sophon/boxai/setting/model_setting"
	"github.com/dev-fan-sophon/boxai/types"

	"github.com/gin-gonic/gin"
	"github.com/tidwall/gjson"
)

func ImageHelper(c *gin.Context, info *relaycommon.RelayInfo) (newAPIError *types.NewAPIError) {
	info.InitChannelMeta(c)

	imageReq, ok := info.Request.(*dto.ImageRequest)
	if !ok {
		return types.NewErrorWithStatusCode(fmt.Errorf("invalid request type, expected dto.ImageRequest, got %T", info.Request), types.ErrorCodeInvalidRequest, http.StatusBadRequest, types.ErrOptionWithSkipRetry())
	}

	request, err := common.DeepCopy(imageReq)
	if err != nil {
		return types.NewError(fmt.Errorf("failed to copy request to ImageRequest: %w", err), types.ErrorCodeInvalidRequest, types.ErrOptionWithSkipRetry())
	}
	// `file-<id>` handles from POST /v1/files stand in for reference media.
	for _, field := range []*json.RawMessage{&request.Image, &request.Images, &request.Mask} {
		resolved, resolveErr := service.ResolveFileReferencesInJSON(c.GetInt("id"), *field)
		if resolveErr != nil {
			return types.NewErrorWithStatusCode(resolveErr, types.ErrorCodeInvalidRequest, http.StatusBadRequest, types.ErrOptionWithSkipRetry())
		}
		*field = resolved
	}

	metadata := relaycommon.ImageRequestMetadata(c, *request)
	c.Set("image_request_metadata", metadata)
	if encoded, err := common.Marshal(metadata); err == nil {
		logger.LogInfo(c, "image request metadata: "+string(encoded))
	}

	err = helper.ModelMappedHelper(c, info, request)
	if err != nil {
		return types.NewError(err, types.ErrorCodeChannelModelMappedError, types.ErrOptionWithSkipRetry())
	}

	adaptor := GetAdaptor(info.ApiType)
	if adaptor == nil {
		return types.NewError(fmt.Errorf("invalid api type: %d", info.ApiType), types.ErrorCodeInvalidApiType, types.ErrOptionWithSkipRetry())
	}
	adaptor.Init(info)
	isAli := info.ChannelType == constant.ChannelTypeAli
	imageCount, err := request.ImageCount(isAli)
	if err != nil {
		return types.NewErrorWithStatusCode(err, types.ErrorCodeInvalidRequest, http.StatusBadRequest, types.ErrOptionWithSkipRetry())
	}
	promptExtend := request.PromptExtendEnabled()

	var requestBody io.Reader

	imageViaResponses := (info.RelayMode == relayconstant.RelayModeImagesGenerations ||
		info.RelayMode == relayconstant.RelayModeImagesEdits) &&
		strings.TrimSpace(info.ChannelSetting.ImageGenerationViaResponsesModel) != ""
	if (model_setting.GetGlobalSettings().PassThroughRequestEnabled || info.ChannelSetting.PassThroughBodyEnabled) && !imageViaResponses {
		storage, err := common.GetBodyStorage(c)
		if err != nil {
			return types.NewErrorWithStatusCode(err, types.ErrorCodeReadRequestBodyFailed, http.StatusBadRequest, types.ErrOptionWithSkipRetry())
		}
		requestBody = common.NewReplayableBodyReader(storage)
	} else {
		convertedRequest, err := adaptor.ConvertImageRequest(c, info, *request)
		if err != nil {
			return types.NewError(err, types.ErrorCodeConvertRequestFailed)
		}
		relaycommon.AppendRequestConversionFromRequest(info, convertedRequest)

		switch convertedRequest.(type) {
		case *bytes.Buffer:
			requestBody = convertedRequest.(io.Reader)
		default:
			jsonData, err := common.Marshal(convertedRequest)
			if err != nil {
				return types.NewError(err, types.ErrorCodeConvertRequestFailed, types.ErrOptionWithSkipRetry())
			}

			// apply param override
			if len(info.ParamOverride) > 0 {
				jsonData, err = relaycommon.ApplyParamOverrideWithRelayInfo(jsonData, info)
				if err != nil {
					return newAPIErrorFromParamOverride(err)
				}
			}

			// This is a different trust boundary from ingress: channel overrides
			// can change the quantity actually submitted, so bill what is sent.
			imageCount, promptExtend, err = outboundImageQuantity(jsonData, imageCount, promptExtend, isAli)
			if err != nil {
				return types.NewErrorWithStatusCode(err, types.ErrorCodeInvalidRequest, http.StatusBadRequest, types.ErrOptionWithSkipRetry())
			}

			metadata["upstream_request_bytes"] = len(jsonData)
			body, closer, err := relaycommon.NewOutboundJSONBody(jsonData)
			if err != nil {
				return types.NewError(err, types.ErrorCodeConvertRequestFailed, types.ErrOptionWithSkipRetry())
			}
			defer closer.Close()
			jsonData = nil
			requestBody = body
		}
	}

	if billingErr := service.PrepareImageBillingForRequest(c, info, imageCount, promptExtend); billingErr != nil {
		return billingErr
	}

	statusCodeMappingStr := c.GetString("status_code_mapping")

	resp, err := adaptor.DoRequest(c, info, requestBody)
	if err != nil {
		return types.NewOpenAIError(err, types.ErrorCodeDoRequestFailed, http.StatusInternalServerError)
	}
	var httpResp *http.Response
	if resp != nil {
		httpResp = resp.(*http.Response)
		info.IsStream = info.IsStream || strings.HasPrefix(httpResp.Header.Get("Content-Type"), "text/event-stream")
		if httpResp.StatusCode != http.StatusOK {
			if httpResp.StatusCode == http.StatusCreated && info.ApiType == constant.APITypeReplicate {
				// replicate channel returns 201 Created when using Prefer: wait, treat it as success.
				httpResp.StatusCode = http.StatusOK
			} else {
				newAPIError = service.RelayErrorHandler(c.Request.Context(), httpResp, false)
				// reset status code 重置状态码
				service.ResetStatusCode(newAPIError, statusCodeMappingStr)
				return newAPIError
			}
		}
	}

	usage, newAPIError := adaptor.DoResponse(c, httpResp, info)
	if newAPIError != nil {
		// reset status code 重置状态码
		service.ResetStatusCode(newAPIError, statusCodeMappingStr)
		return newAPIError
	}

	imageN := uint(1)
	if request.N != nil {
		imageN = *request.N
	}

	if usage.(*dto.Usage).TotalTokens == 0 {
		usage.(*dto.Usage).TotalTokens = 1
	}
	if usage.(*dto.Usage).PromptTokens == 0 {
		usage.(*dto.Usage).PromptTokens = 1
	}

	quality := request.Quality
	if quality == "" {
		quality = "standard"
	}

	var logContent []string

	if len(request.Size) > 0 {
		logContent = append(logContent, fmt.Sprintf("大小 %s", request.Size))
	}
	if request.AspectRatio != "" {
		logContent = append(logContent, fmt.Sprintf("比例 %s", request.AspectRatio))
	}
	if request.Resolution != "" {
		logContent = append(logContent, fmt.Sprintf("分辨率 %s", request.Resolution))
	}
	if len(quality) > 0 {
		logContent = append(logContent, fmt.Sprintf("品质 %s", quality))
	}
	if imageN > 0 {
		logContent = append(logContent, fmt.Sprintf("生成数量 %d", imageN))
	}

	service.PostTextConsumeQuota(c, info, usage.(*dto.Usage), logContent)
	return nil
}

// outboundImageQuantity re-reads the billable quantity from the converted
// upstream body after channel parameter overrides. Numeric n /
// parameters.n fields must be integers within dto.MaxImageN; fields of other
// types are provider-specific and keep the validated ingress quantity.
func outboundImageQuantity(body []byte, count int, promptExtend bool, useProviderParameters bool) (int, bool, error) {
	quantityRequest := dto.ImageRequest{N: common.GetPointer(uint(count))}
	for _, field := range []struct {
		path     string
		provider bool
	}{{path: "n"}, {path: "parameters.n", provider: true}} {
		value := gjson.GetBytes(body, field.path)
		if value.Type != gjson.Number {
			continue
		}
		n, err := strconv.ParseUint(value.Raw, 10, 64)
		if err != nil || n > dto.MaxImageN {
			return 0, false, fmt.Errorf("%s must be an integer between 1 and %d", field.path, dto.MaxImageN)
		}
		if field.provider {
			quantityRequest.BillingParameters = &dto.ImageBillingParameters{N: common.GetPointer(uint(n))}
		} else {
			quantityRequest.N = common.GetPointer(uint(n))
		}
	}
	if extend := gjson.GetBytes(body, "parameters.prompt_extend"); extend.IsBool() {
		promptExtend = extend.Bool()
	}
	count, err := quantityRequest.ImageCount(useProviderParameters)
	if err != nil {
		return 0, false, err
	}
	return count, promptExtend, nil
}
