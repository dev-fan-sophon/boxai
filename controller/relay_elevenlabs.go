package controller

import (
	"fmt"
	"net/http"

	"github.com/dev-fan-sophon/boxai/common"
	"github.com/dev-fan-sophon/boxai/dto"
	"github.com/dev-fan-sophon/boxai/logger"
	"github.com/dev-fan-sophon/boxai/relay/channel/elevenlabs"
	relaycommon "github.com/dev-fan-sophon/boxai/relay/common"
	"github.com/dev-fan-sophon/boxai/relay/helper"
	"github.com/dev-fan-sophon/boxai/service"
	"github.com/dev-fan-sophon/boxai/types"

	"github.com/gin-gonic/gin"
)

func RelayElevenLabs(c *gin.Context) {
	requestID := c.GetString(common.RequestIdKey)
	var newAPIError *types.NewAPIError
	defer func() {
		if newAPIError == nil {
			return
		}
		logger.LogError(c, fmt.Sprintf("ElevenLabs relay error: %s", common.LocalLogPreview(newAPIError.Error())))
		newAPIError.SetMessage(common.MessageWithRequestId(newAPIError.Error(), requestID))
		c.JSON(newAPIError.StatusCode, gin.H{"error": newAPIError.ToOpenAIError()})
	}()

	upstreamPath := elevenlabs.UpstreamPathFromProxyPath(c.Request.URL.Path)
	endpoint, ok := elevenlabs.MatchNativeEndpoint(c.Request.Method, upstreamPath)
	if !ok {
		newAPIError = types.NewOpenAIError(
			fmt.Errorf("ElevenLabs endpoint is not allowed: %s %s", c.Request.Method, upstreamPath),
			types.ErrorCodeInvalidRequest,
			http.StatusNotFound,
		)
		return
	}

	relayInfo, err := relaycommon.GenRelayInfo(c, types.RelayFormatOpenAI, &dto.BaseRequest{}, nil)
	if err != nil {
		newAPIError = types.NewError(err, types.ErrorCodeGenRelayInfoFailed)
		return
	}
	relayInfo.InitChannelMeta(c)
	// ElevenLabs stream endpoints return raw audio, not SSE. Keeping IsStream
	// false prevents the generic SSE pinger from corrupting the audio body.
	relayInfo.IsStream = false
	if err := helper.ModelMappedHelper(c, relayInfo, &dto.BaseRequest{}); err != nil {
		newAPIError = types.NewError(err, types.ErrorCodeChannelModelMappedError, types.ErrOptionWithSkipRetry())
		return
	}

	usage, err := elevenlabs.EstimateNativeUsage(c, endpoint, relayInfo.OriginModelName)
	if err != nil {
		newAPIError = types.NewError(err, types.ErrorCodeInvalidRequest, types.ErrOptionWithSkipRetry())
		return
	}
	if _, err := elevenlabs.NativePriceData(c, relayInfo); err != nil {
		newAPIError = types.NewError(err, types.ErrorCodeModelPriceError, types.ErrOptionWithStatusCode(http.StatusBadRequest))
		return
	}
	usageDTO := elevenlabs.UsageDTO(usage)
	quota := 0
	if usage.BillingKind != elevenlabs.BillingNone {
		quota, err = service.CalculateAudioQuotaForUsage(relayInfo, usageDTO)
		if err != nil {
			newAPIError = types.NewError(err, types.ErrorCodeModelPriceError, types.ErrOptionWithStatusCode(http.StatusBadRequest), types.ErrOptionWithSkipRetry())
			return
		}
	}

	preConsumed := false
	if quota > 0 && !relayInfo.PriceData.FreeModel {
		newAPIError = service.PreConsumeBilling(c, quota, relayInfo)
		if newAPIError != nil {
			return
		}
		preConsumed = true
	}
	succeeded := false
	defer func() {
		if !succeeded && preConsumed && relayInfo.Billing != nil {
			relayInfo.Billing.Refund(c)
		}
	}()

	resp, err := elevenlabs.NativeProxy(c, relayInfo, upstreamPath)
	if err != nil {
		newAPIError = types.NewOpenAIError(err, types.ErrorCodeDoRequestFailed, http.StatusInternalServerError)
		return
	}
	statusCode := resp.StatusCode
	usage = elevenlabs.UpdateUsageFromResponseHeaders(usage, resp.Header)
	usageDTO = elevenlabs.UsageDTO(usage)
	if usage.BillingKind != elevenlabs.BillingNone {
		if _, err := service.CalculateAudioQuotaForUsage(relayInfo, usageDTO); err != nil {
			service.CloseResponseBodyGracefully(resp)
			newAPIError = types.NewError(err, types.ErrorCodeModelPriceError, types.ErrOptionWithStatusCode(http.StatusBadRequest), types.ErrOptionWithSkipRetry())
			return
		}
	}
	if err := elevenlabs.CopyNativeResponse(c, resp); err != nil {
		newAPIError = types.NewOpenAIError(err, types.ErrorCodeReadResponseBodyFailed, http.StatusInternalServerError)
		return
	}
	if statusCode < http.StatusOK || statusCode >= http.StatusBadRequest {
		return
	}

	succeeded = true
	if usage.BillingKind != elevenlabs.BillingNone {
		service.PostAudioConsumeQuota(c, relayInfo, usageDTO, usage.ExtraContent)
	}
}
