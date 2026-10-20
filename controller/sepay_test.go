package controller

import (
	"crypto/hmac"
	"crypto/sha256"
	"encoding/hex"
	"net/http"
	"net/http/httptest"
	"strconv"
	"strings"
	"testing"
	"time"

	"github.com/dev-fan-sophon/boxai/common"
	"github.com/dev-fan-sophon/boxai/model"
	"github.com/gin-gonic/gin"
	"github.com/glebarez/sqlite"
	"github.com/stretchr/testify/assert"
	"github.com/stretchr/testify/require"
	"gorm.io/gorm"
)

func signedSePayRequest(body, timestamp, secret string) *http.Request {
	r := httptest.NewRequest(http.MethodPost, "/api/sepay/webhook", strings.NewReader(body))
	r.Header.Set("X-SePay-Timestamp", timestamp)
	mac := hmac.New(sha256.New, []byte(secret))
	_, _ = mac.Write([]byte(timestamp + "." + body))
	r.Header.Set("X-SePay-Signature", "sha256="+hex.EncodeToString(mac.Sum(nil)))
	return r
}

func TestSePayWebhookAuthentication(t *testing.T) {
	t.Setenv("SEPAY_WEBHOOK_SECRET", "test-secret")
	now := strconv.FormatInt(time.Now().Unix(), 10)
	for _, tc := range []struct {
		name, body, timestamp, secret string
		status                        int
	}{
		{"wrong signature", `{}`, now, "wrong", 401},
		{"stale", `{}`, strconv.FormatInt(time.Now().Unix()-301, 10), "test-secret", 401},
		{"future", `{}`, strconv.FormatInt(time.Now().Unix()+301, 10), "test-secret", 401},
		{"overflow", `{}`, "18446744073709551615", "test-secret", 401},
		{"invalid JSON", `{`, now, "test-secret", 400},
		{"invalid ID", `{"id":0}`, now, "test-secret", 400},
		{"oversized", strings.Repeat("x", 65537), now, "test-secret", 413},
	} {
		t.Run(tc.name, func(t *testing.T) {
			w := httptest.NewRecorder()
			c, _ := gin.CreateTestContext(w)
			c.Request = signedSePayRequest(tc.body, tc.timestamp, tc.secret)
			SePayWebhook(c)
			assert.Equal(t, tc.status, w.Code)
		})
	}
}

func TestSePaySignedSettlementAndStatusOwnership(t *testing.T) {
	t.Setenv("SEPAY_WEBHOOK_SECRET", "test-secret")
	oldDB, oldQuota := model.DB, common.QuotaPerUnit
	db, err := gorm.Open(sqlite.Open("file:"+t.Name()+"?mode=memory&cache=shared"), &gorm.Config{})
	require.NoError(t, err)
	require.NoError(t, db.AutoMigrate(&model.User{}, &model.TopUp{}, &model.SubscriptionOrder{}, &model.TopUpPromotion{}, &model.TopUpSubmission{}, &model.SePayEvent{}))
	model.DB, common.QuotaPerUnit = db, 100
	t.Cleanup(func() { model.DB, common.QuotaPerUnit = oldDB, oldQuota })
	require.NoError(t, db.Create(&model.User{Id: 1, Username: "sepay", AffCode: "sepay"}).Error)
	order := model.TopUp{UserId: 1, TradeNo: "BOXABC123", Amount: 10, Status: common.TopUpStatusPending, PaymentProvider: model.PaymentProviderBankQR, PaymentMethod: model.PaymentMethodBankQR,
		SePaySnapshot:         model.SePaySnapshot{AutomaticConfirmation: true, SePayGateway: "MBBank", SePayAccount: "12345"},
		TopUpDiscountSnapshot: model.TopUpDiscountSnapshot{PaidAmount: 90000, FaceAmount: 100000, ExpiresAt: common.GetTimestamp() + 3600}}
	require.NoError(t, db.Create(&order).Error)
	body := `{"id":123,"gateway":"MBBank","accountNumber":"12345","subAccount":null,"transferType":"in","transferAmount":90000.0,"code":null,"content":"BOXABC123","transactionDate":"2026-10-20 12:00:00"}`
	require.NoError(t, db.Model(&model.User{}).Where("id = ?", 1).Update("quota", common.MaxQuota).Error)
	w := httptest.NewRecorder()
	c, _ := gin.CreateTestContext(w)
	c.Request = signedSePayRequest(body, strconv.FormatInt(time.Now().Unix(), 10), "test-secret")
	SePayWebhook(c)
	assert.Equal(t, http.StatusInternalServerError, w.Code)
	var events int64
	require.NoError(t, db.Model(&model.SePayEvent{}).Count(&events).Error)
	assert.Zero(t, events)
	require.NoError(t, db.Model(&model.User{}).Where("id = ?", 1).Update("quota", 0).Error)
	for i := 0; i < 2; i++ {
		w := httptest.NewRecorder()
		c, _ := gin.CreateTestContext(w)
		c.Request = signedSePayRequest(body, strconv.FormatInt(time.Now().Unix(), 10), "test-secret")
		SePayWebhook(c)
		assert.Equal(t, 200, w.Code)
	}
	var user model.User
	require.NoError(t, db.First(&user, 1).Error)
	assert.Equal(t, 1000, user.Quota)
	for _, tc := range []struct {
		user   int
		trade  string
		status int
	}{{1, order.TradeNo, 200}, {2, order.TradeNo, 404}, {1, "MISSING", 404}} {
		w := httptest.NewRecorder()
		c, _ := gin.CreateTestContext(w)
		c.Set("id", tc.user)
		c.Params = gin.Params{{Key: "trade_no", Value: tc.trade}}
		BankQRPaymentStatus(c)
		assert.Equal(t, tc.status, w.Code)
		if tc.status == 200 {
			assert.Contains(t, w.Body.String(), `"status":"success"`)
			assert.Contains(t, w.Body.String(), `"automatic_confirmation":true`)
		}
	}
}

func TestSePayCheckoutRejectsIncompleteConfiguration(t *testing.T) {
	t.Setenv("SEPAY_WEBHOOK_SECRET", "test-secret")
	t.Setenv("SEPAY_BANK_GATEWAY", "")
	w := httptest.NewRecorder()
	c, _ := gin.CreateTestContext(w)
	c.Request = httptest.NewRequest(http.MethodPost, "/", strings.NewReader(`{"amount":100000}`))
	RequestBankQRPay(c)
	assert.Equal(t, http.StatusServiceUnavailable, w.Code)
}
