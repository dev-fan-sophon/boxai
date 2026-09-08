package controller

import (
	"net/http"
	"net/http/httptest"
	"path/filepath"
	"strings"
	"testing"

	"github.com/dev-fan-sophon/boxai/common"
	"github.com/dev-fan-sophon/boxai/model"
	"github.com/dev-fan-sophon/boxai/pkg/vietqr"
	"github.com/dev-fan-sophon/boxai/setting/operation_setting"
	"github.com/gin-gonic/gin"
	"github.com/glebarez/sqlite"
	"github.com/stretchr/testify/assert"
	"github.com/stretchr/testify/require"
	"gorm.io/gorm"
)

func TestBankQRDiscountHTTPContract(t *testing.T) {
	oldDB, oldRate, oldBank := model.DB, operation_setting.USDExchangeRate, operation_setting.GetBankQRSetting()
	oldDisplay := operation_setting.GetGeneralSetting().QuotaDisplayType
	db, err := gorm.Open(sqlite.Open(filepath.Join(t.TempDir(), "api.db")), &gorm.Config{})
	require.NoError(t, err)
	require.NoError(t, db.AutoMigrate(&model.User{}, &model.TopUp{}, &model.TopUpPromotion{}, &model.TopUpCoupon{}, &model.TopUpSubmission{}, &model.SubscriptionOrder{}))
	model.DB, operation_setting.USDExchangeRate = db, 25000
	operation_setting.GetGeneralSetting().QuotaDisplayType = operation_setting.QuotaDisplayTypeVND
	bank := operation_setting.BankQRSetting{Enabled: true, BankName: "Test Bank", BankBIN: "970422", AccountNumber: "123456789", AccountName: "TEST", MinTopUp: 10000, TransferPrefix: "BOXAI"}
	operation_setting.SetBankQRSetting(bank)
	t.Cleanup(func() {
		model.DB, operation_setting.USDExchangeRate = oldDB, oldRate
		operation_setting.SetBankQRSetting(oldBank)
		operation_setting.GetGeneralSetting().QuotaDisplayType = oldDisplay
		sqlDB, e := db.DB()
		if e == nil {
			_ = sqlDB.Close()
		}
	})
	require.NoError(t, db.Create(&model.User{Id: 1, Username: "buyer", AffCode: "buyer"}).Error)
	r := gin.New()
	r.Use(func(c *gin.Context) { c.Set("id", 1); c.Next() })
	r.GET("/promotion", GetTopUpPromotion)
	r.PUT("/promotion", UpdateTopUpPromotion)
	r.GET("/coupons", ListTopUpCoupons)
	r.POST("/coupons", SaveTopUpCoupon)
	r.PUT("/coupons/:id", SaveTopUpCoupon)
	r.POST("/amount", RequestBankQRAmount)
	r.POST("/pay", RequestBankQRPay)
	r.POST("/cancel/:trade_no", CancelBankQRTopUp)
	request := func(method, path, body string) map[string]any {
		t.Helper()
		req := httptest.NewRequest(method, path, strings.NewReader(body))
		req.Header.Set("Content-Type", "application/json")
		w := httptest.NewRecorder()
		r.ServeHTTP(w, req)
		require.Equal(t, http.StatusOK, w.Code, w.Body.String())
		var response map[string]any
		require.NoError(t, common.Unmarshal(w.Body.Bytes(), &response))
		require.Equal(t, true, response["success"], w.Body.String())
		if response["data"] == nil {
			return nil
		}
		return response["data"].(map[string]any)
	}
	p := request(http.MethodGet, "/promotion", "")
	assert.Equal(t, false, p["enabled"])
	assert.Equal(t, "console_top", p["banner_position"])
	p = request(http.MethodPut, "/promotion", `{"enabled":true,"min_amount":100000,"percent_off":30,"max_discount":100000,"banner_enabled":true,"banner_position":"both"}`)
	assert.Equal(t, true, p["enabled"])
	c := request(http.MethodPost, "/coupons", `{"code":"ten","enabled":true,"discount_type":"percent","discount_value":10,"stackable":true}`)
	assert.Equal(t, "TEN", c["code"])
	list := request(http.MethodGet, "/coupons?page=1&pagesize=1", "")
	assert.EqualValues(t, 1, list["total"])
	assert.Len(t, list["items"], 1)
	quote := request(http.MethodPost, "/amount", `{"amount":100000,"coupon_code":"ten"}`)
	assert.EqualValues(t, 63000, quote["amount"])
	assert.EqualValues(t, 100000, quote["face_amount"])
	assert.EqualValues(t, 30000, quote["activity_discount"])
	assert.EqualValues(t, 7000, quote["coupon_discount"])
	assert.EqualValues(t, 4, quote["credit_usd"])
	pay := request(http.MethodPost, "/pay", `{"amount":100000,"coupon_code":"TEN"}`)
	assert.EqualValues(t, 63000, pay["amount"])
	assert.EqualValues(t, 4, pay["credit_usd"])
	trade := pay["trade_no"].(string)
	expected, err := vietqr.Payload(bank.BankBIN, bank.AccountNumber, 63000, trade)
	require.NoError(t, err)
	assert.Equal(t, expected, pay["payload"])
	order := model.GetTopUpByTradeNo(trade)
	require.NotNil(t, order)
	assert.EqualValues(t, 63000, order.Money)
	assert.EqualValues(t, 400, order.Amount)
	assert.EqualValues(t, order.ExpiresAt, pay["expires_at"])
	request(http.MethodPost, "/cancel/"+trade, "")
	assert.Equal(t, "cancelled", model.GetTopUpByTradeNo(trade).Status)
	for _, body := range []string{`{"amount":100000,"coupon_code":"MISSING"}`, `{"amount":-1}`, `{"amount":100000.5}`, `{"amount":9223372036854775807}`} {
		w := httptest.NewRecorder()
		req := httptest.NewRequest(http.MethodPost, "/pay", strings.NewReader(body))
		req.Header.Set("Content-Type", "application/json")
		r.ServeHTTP(w, req)
		var response map[string]any
		require.NoError(t, common.Unmarshal(w.Body.Bytes(), &response))
		assert.Equal(t, false, response["success"])
	}
	var count int64
	require.NoError(t, db.Model(&model.TopUp{}).Count(&count).Error)
	assert.EqualValues(t, 1, count)
}
