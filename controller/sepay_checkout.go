package controller

import (
	"errors"
	"net/http"
	"strconv"
	"strings"

	"github.com/dev-fan-sophon/boxai/common"
	"github.com/dev-fan-sophon/boxai/model"
	"github.com/dev-fan-sophon/boxai/pkg/sepay"
	"github.com/dev-fan-sophon/boxai/setting/operation_setting"
	"github.com/dev-fan-sophon/boxai/setting/system_setting"
	"github.com/gin-gonic/gin"
	"gorm.io/gorm"
)

func GetSePaySettings(c *gin.Context) {
	s := operation_setting.GetSePaySetting()
	common.ApiSuccess(c, gin.H{"enabled": s.Enabled, "bank_account_id": s.BankAccountID, "bank_name": s.BankName, "account_number": s.AccountNumber, "account_name": s.AccountName, "api_token_configured": s.APIToken != "", "webhook_secret_configured": s.WebhookSecret != "", "webhook_url": strings.TrimRight(system_setting.ServerAddress, "/") + "/api/sepay/webhook"})
}

// POST keeps replacement tokens out of query strings and access logs. Loading
// accounts never saves a token or changes the selected receiving account.
func ListSePayAccounts(c *gin.Context) {
	var req struct {
		APIToken string `json:"api_token"`
	}
	if c.ShouldBindJSON(&req) != nil {
		c.AbortWithStatus(http.StatusBadRequest)
		return
	}
	if req.APIToken == "" {
		req.APIToken = operation_setting.GetSePaySetting().APIToken
	}
	accounts, err := sepay.ListBankAccounts(c.Request.Context(), req.APIToken)
	if err != nil {
		c.JSON(http.StatusBadGateway, gin.H{"success": false, "message": "Unable to load SePay accounts; check API token and permissions"})
		return
	}
	supported := make([]sepay.BankAccount, 0, len(accounts))
	for _, account := range accounts {
		if account.SupportsCheckout() {
			supported = append(supported, account)
		}
	}
	common.ApiSuccess(c, supported)
}

func UpdateSePaySettings(c *gin.Context) {
	var req struct {
		Enabled            bool   `json:"enabled"`
		APIToken           string `json:"api_token"`
		BankAccountID      string `json:"bank_account_id"`
		WebhookSecret      string `json:"webhook_secret"`
		ClearWebhookSecret bool   `json:"clear_webhook_secret"`
	}
	if c.ShouldBindJSON(&req) != nil || model.SaveSePaySetting(operation_setting.SePaySetting{Enabled: req.Enabled, APIToken: req.APIToken, BankAccountID: req.BankAccountID, WebhookSecret: req.WebhookSecret}, req.ClearWebhookSecret) != nil {
		c.JSON(http.StatusBadRequest, gin.H{"success": false, "message": "Unable to save SePay settings; check configuration"})
		return
	}
	GetSePaySettings(c)
}

func isSePayTopUpEnabled() bool {
	s := operation_setting.GetSePaySetting()
	if !s.Enabled || !isPaymentComplianceConfirmed() || operation_setting.GetQuotaDisplayType() != operation_setting.QuotaDisplayTypeVND || operation_setting.ValidateSePaySetting(s) != nil {
		return false
	}
	_, err := model.QuoteVNDTopUp(s.MinTopUp)
	return err == nil
}

func RequestSePayAmount(c *gin.Context) {
	if !isSePayTopUpEnabled() {
		c.JSON(400, gin.H{"success": false, "message": "SePay is unavailable"})
		return
	}
	var req AmountRequest
	if c.ShouldBindJSON(&req) != nil || req.Amount.Exponent() < -32 || req.Amount.Exponent() > 18 {
		c.AbortWithStatus(400)
		return
	}
	amount, err := model.ParseWholeVND(req.Amount)
	if err != nil || amount < operation_setting.GetSePaySetting().MinTopUp {
		c.AbortWithStatus(400)
		return
	}
	quote, err := model.QuoteVNDTopUp(amount)
	if err != nil {
		c.AbortWithStatus(400)
		return
	}
	common.ApiSuccess(c, gin.H{"amount": amount, "currency": "VND", "credit_usd": model.USDCents(quote.CreditCents).InexactFloat64()})
}

func RequestSePayPay(c *gin.Context)             { requestSePayCheckout(c, false) }
func SubscriptionRequestSePayPay(c *gin.Context) { requestSePayCheckout(c, true) }

func requestSePayCheckout(c *gin.Context, subscription bool) {
	if !isSePayTopUpEnabled() {
		c.JSON(400, gin.H{"success": false, "message": "SePay is unavailable"})
		return
	}
	s := operation_setting.GetSePaySetting()
	var amount int64
	var planID int
	if subscription {
		var req struct {
			PlanID int `json:"plan_id"`
		}
		if c.ShouldBindJSON(&req) != nil || req.PlanID <= 0 {
			c.AbortWithStatus(400)
			return
		}
		planID = req.PlanID
	} else {
		var req AmountRequest
		if c.ShouldBindJSON(&req) != nil || req.Amount.Exponent() < -32 || req.Amount.Exponent() > 18 {
			c.AbortWithStatus(400)
			return
		}
		var err error
		amount, err = model.ParseWholeVND(req.Amount)
		if err != nil {
			c.AbortWithStatus(400)
			return
		}
	}
	suffix, err := bankQRRandomSuffix(25 - len(s.TransferPrefix))
	if err != nil {
		c.AbortWithStatus(500)
		return
	}
	invoice, err := model.CreateSePayCheckout(c.GetInt("id"), s.TransferPrefix+suffix, amount, planID, s)
	if err != nil {
		c.JSON(400, gin.H{"success": false, "message": "Unable to create SePay order; check amount, plan and pending orders"})
		return
	}
	common.ApiSuccess(c, invoice)
}

func SePayInvoice(c *gin.Context) {
	invoice, err := model.GetSePayInvoice(c.GetInt("id"), c.Param("trade_no"), c.Request.Method == http.MethodPost)
	if errors.Is(err, gorm.ErrRecordNotFound) {
		c.AbortWithStatus(404)
		return
	}
	if err != nil {
		c.JSON(400, gin.H{"success": false, "message": "SePay order is unavailable"})
		return
	}
	common.ApiSuccess(c, invoice)
}

func GetSePayEvents(c *gin.Context) {
	page, _ := strconv.Atoi(c.DefaultQuery("page", "1"))
	size, _ := strconv.Atoi(c.DefaultQuery("page_size", "20"))
	if page < 1 || page > 1000000 || size < 1 || size > 100 {
		c.AbortWithStatus(400)
		return
	}
	items := []struct {
		ID         int64  `json:"id"`
		TradeNo    string `json:"trade_no"`
		Reason     string `json:"reason"`
		ReceivedAt int64  `json:"received_at"`
	}{}
	var total int64
	if model.DB.Model(&model.SePayEvent{}).Count(&total).Error != nil || model.DB.Model(&model.SePayEvent{}).Select("id", "trade_no", "reason", "received_at").Order("received_at DESC, id DESC").Offset((page-1)*size).Limit(size).Scan(&items).Error != nil {
		c.AbortWithStatus(500)
		return
	}
	common.ApiSuccess(c, gin.H{"items": items, "total": total})
}
