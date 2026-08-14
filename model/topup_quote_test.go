package model

import (
	"testing"

	"github.com/dev-fan-sophon/boxai/common"
	"github.com/dev-fan-sophon/boxai/setting/operation_setting"
	"github.com/shopspring/decimal"
	"github.com/stretchr/testify/assert"
	"github.com/stretchr/testify/require"
)

func TestQuoteVNDTopUpFreezesExactFaceAmount(t *testing.T) {
	originalRate := operation_setting.USDExchangeRate
	originalQuota := common.QuotaPerUnit
	operation_setting.USDExchangeRate = 26000
	common.QuotaPerUnit = 500000
	t.Cleanup(func() {
		operation_setting.USDExchangeRate = originalRate
		common.QuotaPerUnit = originalQuota
	})

	quote, err := QuoteVNDTopUp(50000)
	require.NoError(t, err)
	assert.Equal(t, int64(50000), quote.FaceAmountMinor)
	assert.Equal(t, "VND", quote.FaceCurrency)
	assert.Equal(t, int64(192), quote.CreditCents)

	order := &TopUp{}
	quote.Apply(order)
	assert.Equal(t, int64(192), order.Amount)
	assert.Equal(t, TopUpAmountUnitUSDCent, order.AmountUnit)
	assert.Equal(t, float64(50000), order.Money)
	assert.Equal(t, int64(50000), order.FaceAmountMinor)
}

func TestParseWholeVNDRejectsFractions(t *testing.T) {
	_, err := ParseWholeVND(decimal.RequireFromString("50000.5"))
	require.Error(t, err)
}
