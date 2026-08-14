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
	operation_setting.GetPaymentSetting().AmountDiscount = map[int]float64{}
	require.NoError(t, common.UpdateTopupGroupRatioByJSONString(`{"default":1.2}`))
	assert.Equal(t, int64(26000), bankQRMinVND())

	quote, err := quoteBankQRTopUp(50000)
	require.NoError(t, err)
	assert.Equal(t, int64(50000), quote.FaceAmountMinor)
	assert.Equal(t, int64(192), quote.CreditCents)

	_, err = quoteBankQRTopUp(0)
	assert.Error(t, err)
	_, err = quoteBankQRTopUp(25000)
	assert.ErrorIs(t, err, errBankQRTopUpAmountRange)
	_, err = quoteBankQRTopUp(maxBankQRAmountVND)
	assert.Error(t, err)

	operation_setting.USDExchangeRate = 50_000_000
	_, err = quoteBankQRTopUp(50000)
	assert.Error(t, err)
}

func TestBankQRAmountRangeMessageUsesVND(t *testing.T) {
	require.NoError(t, i18n.Init())
	c, _ := gin.CreateTestContext(httptest.NewRecorder())
	c.Set(string(constant.ContextKeyLanguage), i18n.LangZhCN)

	message := bankQRAmountError(c, errBankQRTopUpAmountRange, 26000)
	assert.Equal(t, "充值金额必须在 26000 至 499999999 越南盾之间", message)
}

func TestBankQRPendOrderLimitErrorUsesVietnameseCatalog(t *testing.T) {
	require.NoError(t, i18n.Init())
	c, _ := gin.CreateTestContext(httptest.NewRecorder())
	c.Set(string(constant.ContextKeyLanguage), i18n.LangVi)

	assert.Equal(t, "Bạn có quá nhiều đơn Bank QR đang chờ xử lý", topUpPaymentError(c, model.ErrBankQRPendingOrderLimit))
}
