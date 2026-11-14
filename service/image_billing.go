package service

import (
	"errors"
	"fmt"
	"net/http"
	"strings"

	"github.com/dev-fan-sophon/boxai/common"
	"github.com/dev-fan-sophon/boxai/constant"
	"github.com/dev-fan-sophon/boxai/dto"
	relaycommon "github.com/dev-fan-sophon/boxai/relay/common"
	"github.com/dev-fan-sophon/boxai/types"
	"github.com/gin-gonic/gin"
)

// PrepareImageBillingForRequest reserves the effective outbound image quantity
// before each attempt, including channel retries and parameter overrides. The
// client request stays frozen; only the per-attempt quantity ratios are
// refreshed so a failed Ali attempt cannot leak its parameters.n or
// prompt_extend surcharge into another channel.
func PrepareImageBillingForRequest(c *gin.Context, info *relaycommon.RelayInfo, count int, promptExtend bool) *types.NewAPIError {
	if count < 1 || count > dto.MaxImageN {
		return types.NewErrorWithStatusCode(fmt.Errorf("image count must be an integer between 1 and %d", dto.MaxImageN), types.ErrorCodeInvalidRequest, http.StatusBadRequest, types.ErrOptionWithSkipRetry())
	}
	// Expression billing settles from tokens and ignores per-call ratios.
	if snap := info.TieredBillingSnapshot; snap != nil {
		return nil
	}
	isAli := info.ChannelMeta != nil && info.ChannelType == constant.ChannelTypeAli
	quantity := 1
	if info.PriceData.UsePrice || isAli {
		quantity = count
	}
	info.PriceData.AddOtherRatio("n", float64(quantity))
	extensionRatio := 1.0
	if isAli && promptExtend && strings.Contains(info.UpstreamModelName, "z-image") {
		extensionRatio = common.ZImagePromptExtendMultiplier
	}
	info.PriceData.AddOtherRatio("prompt_extend", extensionRatio)

	base := info.ImageQuotaBeforeGroup
	if info.PriceData.UsePrice {
		base = info.PriceData.ModelPrice * common.QuotaPerUnit
	}
	quota, err := common.QuotaFromFloatStrict(info.PriceData.ApplyOtherRatiosToFloat(base * info.PriceData.GroupRatioInfo.GroupRatio))
	if err != nil {
		return types.NewErrorWithStatusCode(err, types.ErrorCodeModelPriceError, http.StatusBadRequest, types.ErrOptionWithSkipRetry())
	}
	// Reservations only grow: a cheaper attempt keeps the earlier reservation
	// and settlement refunds the difference.
	if quota <= info.PriceData.QuotaToPreConsume {
		return nil
	}
	info.PriceData.QuotaToPreConsume = quota
	info.PriceData.FreeModel = false
	if info.Billing == nil {
		return PreConsumeBilling(c, quota, info)
	}
	if err := info.Billing.Reserve(quota); err != nil {
		var apiErr *types.NewAPIError
		if errors.As(err, &apiErr) {
			return apiErr
		}
		return types.NewErrorWithStatusCode(err, types.ErrorCodeInsufficientUserQuota, http.StatusForbidden, types.ErrOptionWithSkipRetry())
	}
	info.FinalPreConsumedQuota = info.Billing.GetPreConsumedQuota()
	return nil
}
