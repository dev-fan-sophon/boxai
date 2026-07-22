package controller

import (
	"crypto/rand"
	"errors"
	"fmt"
	"math"
	"net/http"
	"strconv"
	"strings"

	"github.com/QuantumNous/new-api/common"
	"github.com/QuantumNous/new-api/i18n"
	"github.com/QuantumNous/new-api/model"
	"github.com/QuantumNous/new-api/pkg/vietqr"
	"github.com/QuantumNous/new-api/setting/operation_setting"
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

func bankQRAmount(amountUSD int64, group string, setting operation_setting.BankQRSetting) (int64, error) {
	if amountUSD < setting.MinTopUp || amountUSD > maxBankQRTopUpUSD {
		return 0, errBankQRTopUpAmountRange
	}
	if _, err := model.BankQRQuota(amountUSD); err != nil {
		return 0, fmt.Errorf("%w: %v", errBankQRTopUpNotCreditable, err)
	}
	rate := operation_setting.USDExchangeRate
	ratio := common.GetTopupGroupRatio(group)
	discount := 1.0
	if configured, ok := operation_setting.GetPaymentSetting().AmountDiscount[int(amountUSD)]; ok {
		discount = configured
	}
	if rate <= 0 || ratio <= 0 || discount <= 0 || math.IsNaN(rate) || math.IsInf(rate, 0) ||
		math.IsNaN(ratio) || math.IsInf(ratio, 0) || math.IsNaN(discount) || math.IsInf(discount, 0) {
		return 0, errBankQRRateInvalid
	}
	amount := decimal.NewFromInt(amountUSD).Mul(decimal.NewFromFloat(rate)).
		Mul(decimal.NewFromFloat(ratio)).Mul(decimal.NewFromFloat(discount)).Round(0)
	if !amount.IsPositive() || amount.GreaterThanOrEqual(decimal.NewFromInt(maxBankQRAmountVND)) {
		return 0, errBankQRAmountLimit
	}
	return amount.IntPart(), nil
}

func bankQRAmountError(c *gin.Context, err error, minTopUp int64) string {
	switch {
	case errors.Is(err, errBankQRTopUpAmountRange):
		return i18n.T(c, i18n.MsgPaymentTopUpAmountRange, map[string]any{"Min": minTopUp, "Max": maxBankQRTopUpUSD})
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
	group, err := model.GetUserGroup(c.GetInt("id"), true)
	if err != nil {
		common.ApiErrorMsg(c, i18n.T(c, i18n.MsgOperationFailed))
		return
	}
	amountVND, err := bankQRAmount(req.Amount, group, bankSetting)
	if err != nil {
		c.JSON(http.StatusBadRequest, gin.H{"success": false, "message": bankQRAmountError(c, err, bankSetting.MinTopUp)})
		return
	}
	common.ApiSuccess(c, gin.H{"amount": amountVND, "currency": "VND"})
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
	userID := c.GetInt("id")
	group, err := model.GetUserGroup(userID, true)
	if err != nil {
		common.ApiErrorMsg(c, i18n.T(c, i18n.MsgOperationFailed))
		return
	}
	amountVND, err := bankQRAmount(req.Amount, group, bankSetting)
	if err != nil {
		c.JSON(http.StatusBadRequest, gin.H{"success": false, "message": bankQRAmountError(c, err, bankSetting.MinTopUp)})
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
	payload, err := vietqr.Payload(bankSetting.BankBIN, bankSetting.AccountNumber, amountVND, tradeNo)
	if err != nil {
		common.ApiErrorMsg(c, topUpPaymentError(c, err))
		return
	}

	order := &model.TopUp{
		UserId: userID, Amount: req.Amount, Money: float64(amountVND), TradeNo: tradeNo,
		PaymentMethod: model.PaymentMethodBankQR, PaymentProvider: model.PaymentProviderBankQR,
		CreateTime: common.GetTimestamp(), Status: common.TopUpStatusPending,
	}
	if err := model.CreatePendingBankQRTopUp(order, maxPendingBankQROrders); err != nil {
		common.ApiErrorMsg(c, topUpPaymentError(c, err))
		return
	}
	common.ApiSuccess(c, gin.H{
		"trade_no": tradeNo, "transfer_content": tradeNo, "amount": amountVND, "currency": "VND",
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
