package model

import (
	"testing"

	"github.com/dev-fan-sophon/boxai/common"
	"github.com/shopspring/decimal"
	"github.com/stretchr/testify/assert"
	"github.com/stretchr/testify/require"
)

func TestUSDToCents(t *testing.T) {
	cents, err := USDToCents(decimal.RequireFromString("1.90"))
	require.NoError(t, err)
	assert.Equal(t, int64(190), cents)

	_, err = USDToCents(decimal.RequireFromString("1.901"))
	require.Error(t, err)

	_, err = USDToCents(decimal.Zero)
	require.Error(t, err)
}

func TestTopUpQuotaCentsAndLegacy(t *testing.T) {
	original := common.QuotaPerUnit
	common.QuotaPerUnit = 500000
	t.Cleanup(func() { common.QuotaPerUnit = original })

	quota, err := TopUpQuota(&TopUp{Amount: 190, AmountUnit: TopUpAmountUnitUSDCent})
	require.NoError(t, err)
	assert.Equal(t, 950000, quota)

	legacy, err := TopUpQuota(&TopUp{Amount: 2, PaymentProvider: PaymentProviderEpay})
	require.NoError(t, err)
	assert.Equal(t, 1_000_000, legacy)

	stripe, err := TopUpQuota(&TopUp{
		Amount:          2,
		Money:           2,
		PaymentProvider: PaymentProviderStripe,
	})
	require.NoError(t, err)
	assert.Equal(t, 1_000_000, stripe)
}
