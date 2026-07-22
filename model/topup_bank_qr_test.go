package model

import (
	"math"
	"testing"

	"github.com/QuantumNous/new-api/common"
	"github.com/stretchr/testify/assert"
	"github.com/stretchr/testify/require"
)

func TestBankQRQuotaRejectsInvalidOrOversizedConfiguration(t *testing.T) {
	originalQuotaPerUnit := common.QuotaPerUnit
	t.Cleanup(func() { common.QuotaPerUnit = originalQuotaPerUnit })

	for _, quotaPerUnit := range []float64{0, math.Inf(1), float64(common.MaxQuota)} {
		common.QuotaPerUnit = quotaPerUnit
		_, err := BankQRQuota(1)
		assert.Error(t, err)
	}
}

func TestManualCompleteBankQRRequiresProofReview(t *testing.T) {
	truncateTables(t)
	originalQuotaPerUnit := common.QuotaPerUnit
	common.QuotaPerUnit = 500_000
	t.Cleanup(func() { common.QuotaPerUnit = originalQuotaPerUnit })

	insertUserForPaymentGuardTest(t, 301, 0)
	order := &TopUp{
		UserId: 301, Amount: 10, Money: 280_800, TradeNo: "BOXAITESTBANKQR",
		PaymentMethod: PaymentMethodBankQR, PaymentProvider: PaymentProviderBankQR,
		Status: common.TopUpStatusPending, CreateTime: common.GetTimestamp(),
	}
	require.NoError(t, order.Insert())
	require.ErrorContains(t, ManualCompleteTopUp(order.TradeNo, "127.0.0.1"), "payment-proof review")
	assert.Equal(t, 0, getUserQuotaForPaymentGuardTest(t, 301))
}
