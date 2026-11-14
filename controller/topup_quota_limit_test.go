package controller

import (
	"net/http"
	"net/http/httptest"
	"strings"
	"testing"

	"github.com/dev-fan-sophon/boxai/common"
	"github.com/dev-fan-sophon/boxai/i18n"
	"github.com/dev-fan-sophon/boxai/model"
	"github.com/dev-fan-sophon/boxai/setting"
	"github.com/dev-fan-sophon/boxai/setting/operation_setting"
	"github.com/gin-gonic/gin"
	"github.com/glebarez/sqlite"
	"github.com/stretchr/testify/assert"
	"github.com/stretchr/testify/require"
	"gorm.io/gorm"
)

func setupTopUpCapacityTest(t *testing.T, walletQuota int) *gorm.DB {
	t.Helper()
	require.NoError(t, i18n.Init())
	oldDB, oldQuotaPerUnit, oldRate := model.DB, common.QuotaPerUnit, operation_setting.USDExchangeRate
	db, err := gorm.Open(sqlite.Open("file:"+t.Name()+"?mode=memory&cache=shared"), &gorm.Config{})
	require.NoError(t, err)
	require.NoError(t, db.AutoMigrate(&model.User{}, &model.TopUp{}))
	model.DB = db
	common.QuotaPerUnit = 500_000
	operation_setting.USDExchangeRate = 25_000
	t.Cleanup(func() {
		model.DB, common.QuotaPerUnit, operation_setting.USDExchangeRate = oldDB, oldQuotaPerUnit, oldRate
		if sqlDB, dbErr := db.DB(); dbErr == nil {
			_ = sqlDB.Close()
		}
	})
	require.NoError(t, db.Create(&model.User{
		Id:       42,
		Username: "topup_capacity_user",
		AffCode:  "topup_capacity_user",
		Quota:    walletQuota,
		Status:   common.UserStatusEnabled,
	}).Error)
	return db
}

func postTopUpJSON(t *testing.T, handler gin.HandlerFunc, body string) *httptest.ResponseRecorder {
	t.Helper()
	gin.SetMode(gin.TestMode)
	recorder := httptest.NewRecorder()
	ctx, _ := gin.CreateTestContext(recorder)
	ctx.Set("id", 42)
	ctx.Request = httptest.NewRequest(http.MethodPost, "/api/user/topup", strings.NewReader(body))
	ctx.Request.Header.Set("Content-Type", "application/json")
	handler(ctx)
	return recorder
}

func topUpTestMessage(key string) string {
	ctx, _ := gin.CreateTestContext(httptest.NewRecorder())
	ctx.Request = httptest.NewRequest(http.MethodPost, "/api/user/topup", nil)
	return i18n.T(ctx, key)
}

func TestRequestAmountRejectsTopUpThatWouldOverflowWallet(t *testing.T) {
	// 1,000,000 VND at 25,000 VND/USD credits $40 = 20,000,000 quota.
	testCases := []struct {
		name        string
		walletQuota int
		wantBody    string
	}{
		{name: "fits exactly below the saturation sentinel", walletQuota: common.MaxQuota - 1 - 20_000_000, wantBody: `{"message":"success","data":"1000000"}`},
		{name: "would reach the saturation sentinel", walletQuota: common.MaxQuota - 20_000_000},
	}
	for _, tc := range testCases {
		t.Run(tc.name, func(t *testing.T) {
			setupTopUpCapacityTest(t, tc.walletQuota)
			recorder := postTopUpJSON(t, RequestAmount, `{"amount":1000000}`)
			assert.Equal(t, http.StatusOK, recorder.Code)
			if tc.wantBody != "" {
				assert.JSONEq(t, tc.wantBody, recorder.Body.String())
				return
			}
			var response map[string]string
			require.NoError(t, common.Unmarshal(recorder.Body.Bytes(), &response))
			assert.Equal(t, "error", response["message"])
			assert.Equal(t, topUpTestMessage(i18n.MsgTopupCreditExceedsMaximum), response["data"])
		})
	}
}

func TestRequestCreemPayRejectsUncreditableProductBeforeCheckout(t *testing.T) {
	oldProducts := setting.CreemProducts
	t.Cleanup(func() { setting.CreemProducts = oldProducts })

	testCases := []struct {
		name        string
		quota       int64
		walletQuota int
		wantMessage string
	}{
		{name: "product credit is not representable", quota: int64(common.MaxQuota), wantMessage: i18n.MsgPaymentTopUpNotCreditable},
		{name: "wallet cannot hold product credit", quota: 1_000, walletQuota: common.MaxQuota - 1_000, wantMessage: i18n.MsgTopupCreditExceedsMaximum},
	}
	for _, tc := range testCases {
		t.Run(tc.name, func(t *testing.T) {
			db := setupTopUpCapacityTest(t, tc.walletQuota)
			products, err := common.Marshal([]CreemProduct{{ProductId: "prod_1", Name: "Pack", Price: 1, Currency: "USD", Quota: tc.quota}})
			require.NoError(t, err)
			setting.CreemProducts = string(products)

			recorder := postTopUpJSON(t, RequestCreemPay, `{"product_id":"prod_1","payment_method":"creem"}`)
			var response map[string]string
			require.NoError(t, common.Unmarshal(recorder.Body.Bytes(), &response))
			assert.Equal(t, "error", response["message"])
			assert.Equal(t, topUpTestMessage(tc.wantMessage), response["data"])

			var orders int64
			require.NoError(t, db.Model(&model.TopUp{}).Count(&orders).Error)
			assert.Zero(t, orders)
		})
	}
}
