package controller

import (
	"net/http/httptest"
	"testing"

	"github.com/dev-fan-sophon/boxai/common"
	"github.com/dev-fan-sophon/boxai/constant"
	"github.com/dev-fan-sophon/boxai/i18n"
	"github.com/dev-fan-sophon/boxai/model"
	"github.com/dev-fan-sophon/boxai/setting/operation_setting"
	"github.com/gin-gonic/gin"
	"github.com/stretchr/testify/assert"
	"github.com/stretchr/testify/require"
)

func TestBankQRAmount(t *testing.T) {
	setting := operation_setting.GetBankQRSetting()
	originalSetting := setting
	originalRate := operation_setting.USDExchangeRate
	originalDiscounts := operation_setting.GetPaymentSetting().AmountDiscount
	t.Cleanup(func() {
		operation_setting.SetBankQRSetting(originalSetting)
		operation_setting.USDExchangeRate = originalRate
		operation_setting.GetPaymentSetting().AmountDiscount = originalDiscounts
		require.NoError(t, common.UpdateTopupGroupRatioByJSONString(`{"default":1}`))
	})

	setting.MinTopUp = 1
	operation_setting.SetBankQRSetting(setting)
	operation_setting.USDExchangeRate = 26000
	operation_setting.GetPaymentSetting().AmountDiscount = map[int]float64{10: 0.9}
	require.NoError(t, common.UpdateTopupGroupRatioByJSONString(`{"default":1.2}`))

	amount, err := bankQRAmount(1000, "default", setting)
	require.NoError(t, err)
	assert.Equal(t, int64(280800), amount)

	_, err = bankQRAmount(0, "default", setting)
	assert.Error(t, err)
	_, err = bankQRAmount((maxBankQRTopUpUSD+1)*100, "default", setting)
	assert.Error(t, err)

	operation_setting.USDExchangeRate = 50_000_000
	_, err = bankQRAmount(1000, "default", setting)
	assert.Error(t, err)
}

func TestBankQRPendOrderLimitErrorUsesVietnameseCatalog(t *testing.T) {
	require.NoError(t, i18n.Init())
	c, _ := gin.CreateTestContext(httptest.NewRecorder())
	c.Set(string(constant.ContextKeyLanguage), i18n.LangVi)

	assert.Equal(t, "Bạn có quá nhiều đơn Bank QR đang chờ xử lý", topUpPaymentError(c, model.ErrBankQRPendingOrderLimit))
}
