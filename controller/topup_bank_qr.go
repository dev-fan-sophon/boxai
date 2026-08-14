package controller

import (
	"crypto/rand"
	"errors"
	"math"
	"net/http"
	"strconv"
	"strings"

	"github.com/dev-fan-sophon/boxai/common"
	"github.com/dev-fan-sophon/boxai/i18n"
	"github.com/dev-fan-sophon/boxai/model"
	"github.com/dev-fan-sophon/boxai/pkg/vietqr"
	"github.com/dev-fan-sophon/boxai/setting/operation_setting"
	"github.com/gin-gonic/gin"
	"github.com/shopspring/decimal"
)

var (
	errBankQRTopUpAmountRange   = errors.New("Bank QR top-up amount out of range")
	errBankQRTopUpNotCreditable = errors.New("Bank QR top-up amount cannot be credited")
	errBankQRRateInvalid        = errors.New("Bank QR rate is invalid")
	errBankQRAmountLimit        = errors.New("Bank QR amount exceeds limit")
)

const (
	maxBankQRTopUpUSD      int64 = 100_000
	maxBankQRAmountVND     int64 = 500_000_000
	maxPendingBankQROrders       = 10
)

func bankQRMinVND() int64 {
	configuredMin := operation_setting.GetBankQRSetting().MinTopUp
	if configuredMin < model.MinTopUpFaceVND {
		return model.MinTopUpFaceVND
	}
	return configuredMin
}

func mapBankQRQuoteError(err error) error {
	switch {
	case errors.Is(err, model.ErrTopUpQuoteInvalidRate):
		return errBankQRRateInvalid
	case errors.Is(err, model.ErrTopUpQuoteNotCreditable):
		return errBankQRTopUpNotCreditable
	case errors.Is(err, model.ErrTopUpQuoteOutOfRange), errors.Is(err, model.ErrTopUpQuoteInvalidAmount):
		return errBankQRTopUpAmountRange
	default:
		return err
	}
}

func quoteBankQRTopUp(amountVND int64) (model.TopUpQuote, error) {
	if amountVND < bankQRMinVND() {
		return model.TopUpQuote{}, errBankQRTopUpAmountRange
	}
	quote, err := model.QuoteVNDTopUp(amountVND)
	if err != nil {
		return model.TopUpQuote{}, mapBankQRQuoteError(err)
	}
	return quote, nil
}

func bankQRAmountError(c *gin.Context, err error, minVND int64) string {
	switch {
	case errors.Is(err, errBankQRTopUpAmountRange):
		return i18n.T(c, i18n.MsgPaymentTopUpAmountRange, map[string]any{"Min": minVND, "Max": maxBankQRAmountVND - 1})
	case errors.Is(err, errBankQRTopUpNotCreditable):
		return i18n.T(c, i18n.MsgPaymentTopUpNotCreditable)
	case errors.Is(err, errBankQRRateInvalid):
		return i18n.T(c, i18n.MsgPaymentBankQRRateInvalid)
	case errors.Is(err, errBankQRAmountLimit):
		return i18n.T(c, i18n.MsgPaymentBankQRAmountLimit)
	default:
		return topUpPaymentError(c, err)
	}
}

func RequestBankQRAmount(c *gin.Context) {
	bankSetting := operation_setting.GetBankQRSetting()
	if !isPaymentComplianceConfirmed() || !operation_setting.IsBankQRSettingConfigured(bankSetting) {
		common.ApiErrorMsg(c, i18n.T(c, i18n.MsgPaymentBankQRTopUpDisabled))
		return
	}
	var req AmountRequest
	if err := c.ShouldBindJSON(&req); err != nil {
		common.ApiErrorMsg(c, i18n.T(c, i18n.MsgPaymentInvalidAmount))
		return
	}
	amountVND, err := model.ParseWholeVND(req.Amount)
	if err != nil {
		common.ApiErrorMsg(c, i18n.T(c, i18n.MsgPaymentInvalidAmount))
		return
	}
	quote, err := quoteBankQRTopUp(amountVND)
	if err != nil {
		c.JSON(http.StatusBadRequest, gin.H{"success": false, "message": bankQRAmountError(c, err, bankQRMinVND())})
		return
	}
	common.ApiSuccess(c, gin.H{
		"amount":     quote.FaceAmountMinor,
		"currency":   quote.FaceCurrency,
		"credit_usd": model.USDCents(quote.CreditCents).InexactFloat64(),
	})
}

func RequestBankQRPay(c *gin.Context) {
	bankSetting := operation_setting.GetBankQRSetting()
	if !isPaymentComplianceConfirmed() || !operation_setting.IsBankQRSettingConfigured(bankSetting) {
		common.ApiErrorMsg(c, i18n.T(c, i18n.MsgPaymentBankQRTopUpDisabled))
		return
	}
	var req AmountRequest
	if err := c.ShouldBindJSON(&req); err != nil {
		common.ApiErrorMsg(c, i18n.T(c, i18n.MsgPaymentInvalidAmount))
		return
	}
	amountVND, err := model.ParseWholeVND(req.Amount)
	if err != nil {
		common.ApiErrorMsg(c, i18n.T(c, i18n.MsgPaymentInvalidAmount))
		return
	}
	userID := c.GetInt("id")
	quote, err := quoteBankQRTopUp(amountVND)
	if err != nil {
		c.JSON(http.StatusBadRequest, gin.H{"success": false, "message": bankQRAmountError(c, err, bankQRMinVND())})
		return
	}

	prefix := operation_setting.NormalizeBankQRTransferPrefix(bankSetting.TransferPrefix)
	var tradeNo string
	for attempts := 0; attempts < 5; attempts++ {
		suffix, randomErr := bankQRRandomSuffix(12)
		if randomErr != nil {
			common.ApiErrorMsg(c, i18n.T(c, i18n.MsgOperationFailed))
			return
		}
		tradeNo = prefix + suffix
		if model.GetTopUpByTradeNo(tradeNo) == nil && model.GetSubscriptionOrderByTradeNo(tradeNo) == nil {
			break
		}
		tradeNo = ""
	}
	if tradeNo == "" {
		common.ApiErrorMsg(c, i18n.T(c, i18n.MsgPaymentTransferRefFailed))
		return
	}
	payload, err := vietqr.Payload(bankSetting.BankBIN, bankSetting.AccountNumber, quote.FaceAmountMinor, tradeNo)
	if err != nil {
		common.ApiErrorMsg(c, topUpPaymentError(c, err))
		return
	}

	order := &model.TopUp{
		UserId: userID, TradeNo: tradeNo,
		PaymentMethod: model.PaymentMethodBankQR, PaymentProvider: model.PaymentProviderBankQR,
		CreateTime: common.GetTimestamp(), Status: common.TopUpStatusPending,
	}
	quote.Apply(order)
	if err := model.CreatePendingBankQRTopUp(order, maxPendingBankQROrders); err != nil {
		common.ApiErrorMsg(c, topUpPaymentError(c, err))
		return
	}
	common.ApiSuccess(c, gin.H{
		"trade_no": tradeNo, "transfer_content": tradeNo, "amount": quote.FaceAmountMinor, "currency": quote.FaceCurrency,
		"payload": payload, "bank_name": strings.TrimSpace(bankSetting.BankName), "bank_bin": bankSetting.BankBIN,
		"account_number": bankSetting.AccountNumber, "account_name": strings.TrimSpace(bankSetting.AccountName),
	})
}

type SubscriptionBankQRRequest struct {
	PlanId int `json:"plan_id"`
}

func SubscriptionRequestBankQRPay(c *gin.Context) {
	if !requirePaymentCompliance(c) {
		return
	}
	bankSetting := operation_setting.GetBankQRSetting()
	if !operation_setting.IsBankQRSettingConfigured(bankSetting) {
		common.ApiErrorMsg(c, i18n.T(c, i18n.MsgPaymentBankQRDisabled))
		return
	}
	var req SubscriptionBankQRRequest
	if c.ShouldBindJSON(&req) != nil || req.PlanId <= 0 {
		common.ApiErrorMsg(c, i18n.T(c, i18n.MsgPaymentPlanInvalid))
		return
	}
	plan, err := model.GetSubscriptionPlanById(req.PlanId)
	if err != nil || !plan.Enabled {
		common.ApiErrorMsg(c, i18n.T(c, i18n.MsgPaymentPlanDisabled))
		return
	}
	if !strings.EqualFold(strings.TrimSpace(plan.Currency), "USD") || plan.PriceAmount < 0.01 {
		common.ApiErrorMsg(c, i18n.T(c, i18n.MsgPaymentBankQRUSDPlanOnly))
		return
	}
	userID := c.GetInt("id")
	if plan.MaxPurchasePerUser > 0 {
		count, countErr := model.CountUserSubscriptionsByPlan(userID, plan.Id)
		if countErr != nil {
			common.ApiErrorMsg(c, i18n.T(c, i18n.MsgOperationFailed))
			return
		}
		if count >= int64(plan.MaxPurchasePerUser) {
			common.ApiErrorMsg(c, i18n.T(c, i18n.MsgSubscriptionPurchaseMax))
			return
		}
	}
	rate := operation_setting.USDExchangeRate
	if rate <= 0 || math.IsNaN(rate) || math.IsInf(rate, 0) {
		common.ApiErrorMsg(c, i18n.T(c, i18n.MsgPaymentUSDExchangeInvalid))
		return
	}
	amount := decimal.NewFromFloat(plan.PriceAmount).Mul(decimal.NewFromFloat(rate)).Round(0)
	if !amount.IsPositive() || amount.GreaterThanOrEqual(decimal.NewFromInt(maxBankQRAmountVND)) {
		common.ApiErrorMsg(c, i18n.T(c, i18n.MsgPaymentBankQRAmountLimit))
		return
	}
	prefix := operation_setting.NormalizeBankQRTransferPrefix(bankSetting.TransferPrefix)
	tradeNo := ""
	for attempts := 0; attempts < 5; attempts++ {
		suffix, randomErr := bankQRRandomSuffix(12)
		if randomErr != nil {
			common.ApiErrorMsg(c, i18n.T(c, i18n.MsgOperationFailed))
			return
		}
		candidate := prefix + suffix
		if model.GetTopUpByTradeNo(candidate) == nil && model.GetSubscriptionOrderByTradeNo(candidate) == nil {
			tradeNo = candidate
			break
		}
	}
	if tradeNo == "" {
		common.ApiErrorMsg(c, i18n.T(c, i18n.MsgPaymentTransferRefFailed))
		return
	}
	payload, err := vietqr.Payload(bankSetting.BankBIN, bankSetting.AccountNumber, amount.IntPart(), tradeNo)
	if err != nil {
		common.ApiErrorMsg(c, topUpPaymentError(c, err))
		return
	}
	providerPayload, err := common.Marshal(model.BankQRSubscriptionOrderPayload{Version: 1, Amount: amount.IntPart(), Currency: "VND", Plan: *plan})
	if err != nil {
		common.ApiErrorMsg(c, i18n.T(c, i18n.MsgOperationFailed))
		return
	}
	order := &model.SubscriptionOrder{UserId: userID, PlanId: plan.Id, Money: plan.PriceAmount, TradeNo: tradeNo, PaymentMethod: model.PaymentMethodBankQR, PaymentProvider: model.PaymentProviderBankQR, Status: common.TopUpStatusPending, CreateTime: common.GetTimestamp(), ProviderPayload: string(providerPayload)}
	if err := model.CreatePendingBankQRSubscriptionOrder(order, maxPendingBankQROrders); err != nil {
		common.ApiErrorMsg(c, topUpPaymentError(c, err))
		return
	}
	common.ApiSuccess(c, gin.H{"trade_no": tradeNo, "transfer_content": tradeNo, "amount": amount.IntPart(), "currency": "VND", "payload": payload, "bank_name": strings.TrimSpace(bankSetting.BankName), "bank_bin": bankSetting.BankBIN, "account_number": bankSetting.AccountNumber, "account_name": strings.TrimSpace(bankSetting.AccountName)})
}

func UpdateBankQRSetting(c *gin.Context) {
	var setting operation_setting.BankQRSetting
	if err := common.DecodeJson(c.Request.Body, &setting); err != nil {
		common.ApiErrorMsg(c, i18n.T(c, i18n.MsgPaymentBankQRSettingInvalid))
		return
	}
	setting.BankName = strings.TrimSpace(setting.BankName)
	setting.BankBIN = strings.TrimSpace(setting.BankBIN)
	setting.AccountNumber = strings.TrimSpace(setting.AccountNumber)
	setting.AccountName = strings.TrimSpace(setting.AccountName)
	setting.TransferPrefix = operation_setting.NormalizeBankQRTransferPrefix(setting.TransferPrefix)
	if err := operation_setting.ValidateBankQRSetting(setting); err != nil {
		c.JSON(http.StatusBadRequest, gin.H{"success": false, "message": i18n.T(c, i18n.MsgPaymentBankQRSettingInvalid)})
		return
	}

	updates := map[string]string{
		"bank_qr_setting.enabled":         strconv.FormatBool(setting.Enabled),
		"bank_qr_setting.bank_name":       setting.BankName,
		"bank_qr_setting.bank_bin":        setting.BankBIN,
		"bank_qr_setting.account_number":  setting.AccountNumber,
		"bank_qr_setting.account_name":    setting.AccountName,
		"bank_qr_setting.min_topup":       strconv.FormatInt(setting.MinTopUp, 10),
		"bank_qr_setting.transfer_prefix": setting.TransferPrefix,
	}
	err := operation_setting.WithBankQRSettingsUpdate(func() error {
		if err := model.UpdateOptionsBulk(updates); err != nil {
			return err
		}
		operation_setting.SetBankQRSetting(setting)
		return nil
	})
	if err != nil {
		common.ApiErrorMsg(c, i18n.T(c, i18n.MsgOperationFailed))
		return
	}
	common.ApiSuccess(c, setting)
}

func bankQRRandomSuffix(length int) (string, error) {
	const alphabet = "ABCDEFGHIJKLMNOPQRSTUVWXYZ0123456789"
	bytes := make([]byte, length)
	if _, err := rand.Read(bytes); err != nil {
		return "", err
	}
	for i := range bytes {
		bytes[i] = alphabet[int(bytes[i])%len(alphabet)]
	}
	return string(bytes), nil
}
