package controller

import (
	"fmt"
	"net/http/httptest"
	"path/filepath"
	"strconv"
	"strings"
	"testing"
	"time"

	"github.com/dev-fan-sophon/boxai/common"
	"github.com/dev-fan-sophon/boxai/i18n"
	"github.com/dev-fan-sophon/boxai/model"
	"github.com/dev-fan-sophon/boxai/pkg/vietqr"
	"github.com/dev-fan-sophon/boxai/setting/operation_setting"
	"github.com/dev-fan-sophon/boxai/setting/system_setting"
	"github.com/gin-gonic/gin"
	"github.com/glebarez/sqlite"
	"github.com/stretchr/testify/assert"
	"github.com/stretchr/testify/require"
	"gorm.io/gorm"
)

func sePayHTTPFixture(t *testing.T) *gin.Engine {
	t.Helper()
	require.NoError(t, i18n.Init())
	oldDB, oldRate, oldQuota := model.DB, operation_setting.USDExchangeRate, common.QuotaPerUnit
	oldConfig, oldBank := operation_setting.GetSePaySetting(), operation_setting.GetBankQRSetting()
	oldDisplay, oldAddress := operation_setting.GetGeneralSetting().QuotaDisplayType, system_setting.ServerAddress
	db, err := gorm.Open(sqlite.Open(filepath.Join(t.TempDir(), "sepay.db")), &gorm.Config{})
	require.NoError(t, err)
	require.NoError(t, db.AutoMigrate(&model.Option{}, &model.User{}, &model.TopUp{}, &model.SubscriptionOrder{}, &model.SubscriptionPlan{}, &model.UserSubscription{}, &model.SePayEvent{}, &model.SePaySettlementLock{}, &model.TopUpSubmission{}, &model.TopUpPromotion{}, &model.TopUpCoupon{}))
	model.DB, operation_setting.USDExchangeRate, common.QuotaPerUnit = db, 25000, 100
	operation_setting.GetGeneralSetting().QuotaDisplayType = operation_setting.QuotaDisplayTypeVND
	system_setting.ServerAddress = "https://you-box.com"
	operation_setting.SetBankQRSetting(operation_setting.BankQRSetting{MinTopUp: 10000, TransferPrefix: "MANUAL"})
	operation_setting.SetSePaySetting(operation_setting.SePaySetting{MinTopUp: 10000, TransferPrefix: "SEPAY"})
	t.Cleanup(func() {
		model.DB, operation_setting.USDExchangeRate, common.QuotaPerUnit = oldDB, oldRate, oldQuota
		operation_setting.SetSePaySetting(oldConfig)
		operation_setting.SetBankQRSetting(oldBank)
		operation_setting.GetGeneralSetting().QuotaDisplayType, system_setting.ServerAddress = oldDisplay, oldAddress
		sqlDB, err := db.DB()
		require.NoError(t, err)
		require.NoError(t, sqlDB.Close())
	})
	require.NoError(t, db.Create(&model.User{Id: 1, Username: "buyer", AffCode: "buyer"}).Error)
	r := gin.New()
	r.Use(func(c *gin.Context) {
		id := 1
		if c.GetHeader("Test-User") == "2" {
			id = 2
		}
		c.Set("id", id)
		c.Next()
	})
	r.GET("/settings", GetSePaySettings)
	r.PUT("/settings", UpdateSePaySettings)
	r.GET("/info", GetTopUpInfo)
	r.GET("/options", GetOptions)
	r.POST("/amount", RequestSePayAmount)
	r.POST("/pay", RequestSePayPay)
	r.POST("/subscription/pay", SubscriptionRequestSePayPay)
	r.GET("/invoice/:trade_no", SePayInvoice)
	r.POST("/invoice/:trade_no/cancel", SePayInvoice)
	r.POST("/api/sepay/webhook", SePayWebhook)
	r.GET("/events", GetSePayEvents)
	r.GET("/subscription/self", GetSubscriptionSelf)
	r.POST("/bank/pay", RequestBankQRPay)
	r.POST("/bank/subscription/pay", SubscriptionRequestBankQRPay)
	return r
}

func sePayHTTP(t *testing.T, r *gin.Engine, method, path, body string, status int) map[string]any {
	t.Helper()
	w := httptest.NewRecorder()
	req := httptest.NewRequest(method, path, strings.NewReader(body))
	req.Header.Set("Content-Type", "application/json")
	r.ServeHTTP(w, req)
	require.Equal(t, status, w.Code, w.Body.String())
	if status != 200 {
		return nil
	}
	var response struct {
		Success bool           `json:"success"`
		Data    map[string]any `json:"data"`
	}
	require.NoError(t, common.Unmarshal(w.Body.Bytes(), &response))
	require.True(t, response.Success, w.Body.String())
	return response.Data
}

const sePaySettingsJSON = `{"enabled":true,"bank_name":"MB","bank_bin":"970422","bank_gateway":"MBBank","account_number":"123456789","account_name":"BOXAI","sub_account":"","min_topup":10000,"transfer_prefix":"se-pay","webhook_secret":"fixture-secret"}`

func TestSePayPendingSubscriptionsAreIndependentAndOwnerScoped(t *testing.T) {
	r := sePayHTTPFixture(t)
	sePayHTTP(t, r, "PUT", "/settings", sePaySettingsJSON, 200)
	plan := model.SubscriptionPlan{Title: "Pro", PriceAmount: 4, Currency: "USD", DurationUnit: "month", DurationValue: 1, Enabled: true}
	require.NoError(t, model.DB.Create(&plan).Error)
	invoice := sePayHTTP(t, r, "POST", "/subscription/pay", fmt.Sprintf(`{"plan_id":%d}`, plan.Id), 200)
	for _, order := range []model.SubscriptionOrder{
		{UserId: 1, PlanId: plan.Id, TradeNo: "MANUAL", PaymentProvider: model.PaymentProviderBankQR, Status: common.TopUpStatusPending, CreateTime: common.GetTimestamp()},
		{UserId: 2, PlanId: plan.Id, TradeNo: "OTHER", PaymentProvider: model.PaymentProviderSePay, Status: common.TopUpStatusPending, CreateTime: common.GetTimestamp()},
		{UserId: 1, PlanId: plan.Id, TradeNo: "OLD", PaymentProvider: model.PaymentProviderSePay, Status: common.TopUpStatusPending, CreateTime: common.GetTimestamp() - model.SePayOrderLifetime},
	} {
		require.NoError(t, model.DB.Create(&order).Error)
	}
	data := sePayHTTP(t, r, "GET", "/subscription/self", "", 200)
	sepay, ok := data["pending_sepay_orders"].([]any)
	require.True(t, ok)
	require.Len(t, sepay, 1)
	assert.Equal(t, invoice["trade_no"], sepay[0].(map[string]any)["trade_no"])
	manual, ok := data["pending_bank_qr_orders"].([]any)
	require.True(t, ok)
	require.Len(t, manual, 1)
	assert.Equal(t, "MANUAL", manual[0].(map[string]any)["trade_no"])
	sePayHTTP(t, r, "POST", "/invoice/"+invoice["trade_no"].(string)+"/cancel", "", 200)
	data = sePayHTTP(t, r, "GET", "/subscription/self", "", 200)
	assert.Empty(t, data["pending_sepay_orders"])
}

func TestSePaySettingsHTTPContract(t *testing.T) {
	r := sePayHTTPFixture(t)
	initial := sePayHTTP(t, r, "GET", "/settings", "", 200)
	assert.Equal(t, false, initial["enabled"])
	assert.EqualValues(t, 10000, initial["min_topup"])
	data := sePayHTTP(t, r, "PUT", "/settings", sePaySettingsJSON, 200)
	assert.NotContains(t, data, "webhook_secret")
	assert.Equal(t, true, data["webhook_secret_configured"])
	assert.Equal(t, "SEPAY", data["transfer_prefix"])
	assert.Equal(t, "https://you-box.com/api/sepay/webhook", data["webhook_url"])
	withoutSecret := strings.ReplaceAll(sePaySettingsJSON, `,"webhook_secret":"fixture-secret"`, "")
	sePayHTTP(t, r, "PUT", "/settings", withoutSecret, 200)
	assert.Equal(t, "fixture-secret", operation_setting.GetSePaySetting().WebhookSecret)
	sePayHTTP(t, r, "PUT", "/settings", strings.ReplaceAll(sePaySettingsJSON, "fixture-secret", ""), 200)
	assert.Equal(t, "fixture-secret", operation_setting.GetSePaySetting().WebhookSecret)
	clear := strings.TrimSuffix(withoutSecret, "}") + `,"clear_webhook_secret":true}`
	sePayHTTP(t, r, "PUT", "/settings", clear, 400)
	assert.True(t, operation_setting.GetSePaySetting().Enabled)
	assert.Equal(t, "fixture-secret", operation_setting.GetSePaySetting().WebhookSecret)
	sePayHTTP(t, r, "PUT", "/settings", strings.ReplaceAll(clear, `"enabled":true`, `"enabled":false`), 200)
	assert.Empty(t, operation_setting.GetSePaySetting().WebhookSecret)
	sePayHTTP(t, r, "PUT", "/settings", withoutSecret, 400)
	for _, bad := range []string{strings.ReplaceAll(sePaySettingsJSON, "970422", "bad"), strings.ReplaceAll(sePaySettingsJSON, "10000", "0"), strings.ReplaceAll(sePaySettingsJSON, "MBBank", "")} {
		sePayHTTP(t, r, "PUT", "/settings", bad, 400)
	}
	require.Error(t, model.UpdateOption("sepay_setting.webhook_secret", "bypass"))
	require.Error(t, model.UpdateOptionsBulk(map[string]string{"sepay_setting": sePaySettingsJSON}))
	w := httptest.NewRecorder()
	r.ServeHTTP(w, httptest.NewRequest("GET", "/options", nil))
	assert.NotContains(t, w.Body.String(), "fixture-secret")
	assert.NotContains(t, w.Body.String(), "sepay_setting")
}

func TestIndependentSePayHTTPOrderLifecycle(t *testing.T) {
	for _, subscription := range []bool{false, true} {
		t.Run(fmt.Sprint("subscription=", subscription), func(t *testing.T) {
			r := sePayHTTPFixture(t)
			sePayHTTP(t, r, "PUT", "/settings", sePaySettingsJSON, 200)
			info := sePayHTTP(t, r, "GET", "/info", "", 200)
			assert.Equal(t, true, info["enable_sepay_topup"])
			assert.Equal(t, false, info["enable_bank_qr_topup"])
			quote := sePayHTTP(t, r, "POST", "/amount", `{"amount":100000,"coupon_code":"IGNORED"}`, 200)
			assert.EqualValues(t, 100000, quote["amount"])
			assert.EqualValues(t, 4, quote["credit_usd"])
			path, body := "/pay", `{"amount":100000}`
			plan := model.SubscriptionPlan{Title: "Original", PriceAmount: 4, Currency: "USD", DurationUnit: "month", DurationValue: 1, Enabled: true, TotalAmount: 777, MaxPurchasePerUser: 1}
			if subscription {
				require.NoError(t, model.DB.Create(&plan).Error)
				path, body = "/subscription/pay", fmt.Sprintf(`{"plan_id":%d}`, plan.Id)
			}
			invoice := sePayHTTP(t, r, "POST", path, body, 200)
			trade := invoice["trade_no"].(string)
			assert.EqualValues(t, 100000, invoice["amount"])
			assert.InDelta(t, common.GetTimestamp()+model.SePayOrderLifetime, invoice["expires_at"], 1)
			qr, err := vietqr.Payload("970422", "123456789", 100000, trade)
			require.NoError(t, err)
			assert.Equal(t, qr, invoice["payload"])
			if subscription {
				sePayHTTP(t, r, "POST", path, body, 400)
			}
			w := httptest.NewRecorder()
			req := httptest.NewRequest("GET", "/invoice/"+trade, nil)
			req.Header.Set("Test-User", "2")
			r.ServeHTTP(w, req)
			assert.Equal(t, 404, w.Code)
			sePayHTTP(t, r, "GET", "/invoice/MISSING", "", 404)
			// Changing and disabling checkout must not change or disable the invoice/webhook.
			changed := strings.ReplaceAll(strings.ReplaceAll(sePaySettingsJSON, "123456789", "987654321"), `"enabled":true`, `"enabled":false`)
			sePayHTTP(t, r, "PUT", "/settings", changed, 200)
			operation_setting.USDExchangeRate = 50000
			if subscription {
				require.NoError(t, model.DB.Model(&plan).Update("total_amount", 999).Error)
			}
			reopened := sePayHTTP(t, r, "GET", "/invoice/"+trade, "", 200)
			assert.Equal(t, invoice, reopened)
			transfer := fmt.Sprintf(`{"id":42,"gateway":"MBBank","accountNumber":"123456789","transferType":"in","transferAmount":100000,"content":%q}`, trade)
			for i := 0; i < 2; i++ {
				w := httptest.NewRecorder()
				r.ServeHTTP(w, signedSePayRequest(transfer, strconv.FormatInt(time.Now().Unix(), 10), "fixture-secret"))
				require.Equal(t, 200, w.Code)
			}
			settled := sePayHTTP(t, r, "GET", "/invoice/"+trade, "", 200)
			assert.Equal(t, "success", settled["status"])
			var user model.User
			require.NoError(t, model.DB.First(&user, 1).Error)
			if subscription {
				var subs []model.UserSubscription
				require.NoError(t, model.DB.Find(&subs).Error)
				require.Len(t, subs, 1)
				assert.EqualValues(t, 777, subs[0].AmountTotal)
				assert.Zero(t, user.Quota)
			} else {
				assert.Equal(t, 400, user.Quota)
			}
			var proofs int64
			require.NoError(t, model.DB.Model(&model.TopUpSubmission{}).Count(&proofs).Error)
			assert.Zero(t, proofs)
			events := sePayHTTP(t, r, "GET", "/events?page=1&page_size=1", "", 200)
			assert.EqualValues(t, 1, events["total"])
			event := events["items"].([]any)[0].(map[string]any)
			assert.Len(t, event, 4)
			assert.Equal(t, "settled", event["reason"])
			sePayHTTP(t, r, "POST", "/invoice/"+trade+"/cancel", "", 400)
		})
	}
}

func TestSePayCancellationAndAmountBoundaries(t *testing.T) {
	for _, subscription := range []bool{false, true} {
		t.Run(fmt.Sprint(subscription), func(t *testing.T) {
			r := sePayHTTPFixture(t)
			sePayHTTP(t, r, "PUT", "/settings", sePaySettingsJSON, 200)
			for _, amount := range []string{"0", "9999", "10000.5", "500000000", "18446744073709551615", "1e2147483647", "1e-2147483647"} {
				sePayHTTP(t, r, "POST", "/pay", `{"amount":`+amount+`}`, 400)
				sePayHTTP(t, r, "POST", "/amount", `{"amount":`+amount+`}`, 400)
			}
			path, body := "/pay", `{"amount":100000}`
			if subscription {
				plan := model.SubscriptionPlan{Title: "Plan", PriceAmount: 4, Currency: "USD", DurationUnit: "month", DurationValue: 1, Enabled: true}
				require.NoError(t, model.DB.Create(&plan).Error)
				path, body = "/subscription/pay", fmt.Sprintf(`{"plan_id":%d}`, plan.Id)
			}
			invoice := sePayHTTP(t, r, "POST", path, body, 200)
			trade := invoice["trade_no"].(string)
			if subscription {
				require.Error(t, model.CompleteSubscriptionOrder(trade, "", "", ""))
			} else {
				require.Error(t, model.ManualCompleteTopUp(trade, ""))
			}
			for i := 0; i < 2; i++ {
				cancelled := sePayHTTP(t, r, "POST", "/invoice/"+trade+"/cancel", "", 200)
				assert.Equal(t, "cancelled", cancelled["status"])
			}
			transfer := model.SePayTransfer{ID: 1, Gateway: "MBBank", AccountNumber: "123456789", TransferType: "in", TransferAmount: "100000", Content: trade}
			require.NoError(t, model.ProcessSePayTransfer(transfer))
			require.NoError(t, model.ProcessSePayTransfer(transfer))
			var event model.SePayEvent
			require.NoError(t, model.DB.First(&event, 1).Error)
			assert.Equal(t, "order_"+common.TopUpStatusFailed, event.Reason)
			var user model.User
			require.NoError(t, model.DB.First(&user, 1).Error)
			assert.Zero(t, user.Quota)
			var count int64
			require.NoError(t, model.DB.Model(&model.UserSubscription{}).Count(&count).Error)
			assert.Zero(t, count)
		})
	}
}

func TestBankQRRemainsManualWithSePayEnabled(t *testing.T) {
	r := sePayHTTPFixture(t)
	sePayHTTP(t, r, "PUT", "/settings", sePaySettingsJSON, 200)
	t.Setenv("SEPAY_WEBHOOK_SECRET", "legacy-env-must-not-activate-bank-qr")
	t.Setenv("SEPAY_BANK_GATEWAY", "MBBank")
	operation_setting.SetBankQRSetting(operation_setting.BankQRSetting{Enabled: true, BankName: "Manual bank", BankBIN: "970422", AccountNumber: "123456789", AccountName: "MANUAL", MinTopUp: 10000, TransferPrefix: "MANUAL"})
	plan := model.SubscriptionPlan{Title: "Plan", PriceAmount: 4, Currency: "USD", DurationUnit: "month", DurationValue: 1, Enabled: true}
	require.NoError(t, model.DB.Create(&plan).Error)
	for i, req := range []struct{ path, body string }{{"/bank/pay", `{"amount":100000}`}, {"/bank/subscription/pay", fmt.Sprintf(`{"plan_id":%d}`, plan.Id)}} {
		invoice := sePayHTTP(t, r, "POST", req.path, req.body, 200)
		assert.Equal(t, false, invoice["automatic_confirmation"])
		trade := invoice["trade_no"].(string)
		require.NoError(t, model.ProcessSePayTransfer(model.SePayTransfer{ID: int64(i + 1), Gateway: "MBBank", AccountNumber: "123456789", TransferType: "in", TransferAmount: "100000", Content: trade}))
		var event model.SePayEvent
		require.NoError(t, model.DB.First(&event, i+1).Error)
		assert.Equal(t, "manual_order", event.Reason)
		status, err := model.GetBankQROrderStatus(1, trade)
		require.NoError(t, err)
		assert.Equal(t, "pending", status.Status)
	}
}

func TestSePayPendingLimitAndOverflowRollback(t *testing.T) {
	r := sePayHTTPFixture(t)
	sePayHTTP(t, r, "PUT", "/settings", sePaySettingsJSON, 200)
	invoice := sePayHTTP(t, r, "POST", "/pay", `{"amount":100000}`, 200)
	trade := invoice["trade_no"].(string)
	for i := 1; i < 10; i++ {
		sePayHTTP(t, r, "POST", "/pay", `{"amount":100000}`, 200)
	}
	sePayHTTP(t, r, "POST", "/pay", `{"amount":100000}`, 400)
	require.NoError(t, model.DB.Model(&model.User{}).Where("id = ?", 1).Update("quota", common.MaxQuota-399).Error)
	transfer := model.SePayTransfer{ID: 5, Gateway: "MBBank", AccountNumber: "123456789", TransferType: "in", TransferAmount: "100000", Content: trade}
	require.ErrorIs(t, model.ProcessSePayTransfer(transfer), model.ErrTopUpCreditExceedsMaximum)
	var events int64
	require.NoError(t, model.DB.Model(&model.SePayEvent{}).Count(&events).Error)
	assert.Zero(t, events)
	assert.Equal(t, "pending", sePayHTTP(t, r, "GET", "/invoice/"+trade, "", 200)["status"])
	require.NoError(t, model.DB.Model(&model.User{}).Where("id = ?", 1).Update("quota", 0).Error)
	transfer.TransferAmount = "99999"
	require.NoError(t, model.ProcessSePayTransfer(transfer))
	var event model.SePayEvent
	require.NoError(t, model.DB.First(&event, 5).Error)
	assert.Equal(t, "amount_mismatch", event.Reason)
	transfer.TransferAmount = "100000"
	require.NoError(t, model.ProcessSePayTransfer(transfer)) // same ID cannot be repurposed
	assert.Equal(t, "pending", sePayHTTP(t, r, "GET", "/invoice/"+trade, "", 200)["status"])
	transfer.ID++
	require.NoError(t, model.ProcessSePayTransfer(transfer))
	assert.Equal(t, "success", sePayHTTP(t, r, "GET", "/invoice/"+trade, "", 200)["status"])
}

func TestSePayExpiredInvoicesAreReconciledWithoutFulfillment(t *testing.T) {
	for _, subscription := range []bool{false, true} {
		t.Run(fmt.Sprint(subscription), func(t *testing.T) {
			r := sePayHTTPFixture(t)
			sePayHTTP(t, r, "PUT", "/settings", sePaySettingsJSON, 200)
			path, body := "/pay", `{"amount":100000}`
			var table any = &model.TopUp{}
			if subscription {
				plan := model.SubscriptionPlan{Title: "Plan", PriceAmount: 4, Currency: "USD", DurationUnit: "month", DurationValue: 1, Enabled: true}
				require.NoError(t, model.DB.Create(&plan).Error)
				path, body, table = "/subscription/pay", fmt.Sprintf(`{"plan_id":%d}`, plan.Id), &model.SubscriptionOrder{}
			}
			invoice := sePayHTTP(t, r, "POST", path, body, 200)
			trade := invoice["trade_no"].(string)
			invoice["expires_at"] = common.GetTimestamp() - 1
			data, err := common.Marshal(invoice)
			require.NoError(t, err)
			require.NoError(t, model.DB.Model(table).Where("trade_no = ?", trade).Update("se_pay_invoice", string(data)).Error)
			assert.Equal(t, "expired", sePayHTTP(t, r, "GET", "/invoice/"+trade, "", 200)["status"])
			sePayHTTP(t, r, "POST", "/invoice/"+trade+"/cancel", "", 400)
			require.NoError(t, model.ProcessSePayTransfer(model.SePayTransfer{ID: 1, Gateway: "MBBank", AccountNumber: "123456789", TransferType: "in", TransferAmount: "100000", Content: trade}))
			var event model.SePayEvent
			require.NoError(t, model.DB.First(&event, 1).Error)
			assert.Equal(t, "expired", event.Reason)
			var user model.User
			require.NoError(t, model.DB.First(&user, 1).Error)
			assert.Zero(t, user.Quota)
			var count int64
			require.NoError(t, model.DB.Model(&model.UserSubscription{}).Count(&count).Error)
			assert.Zero(t, count)
		})
	}
}
