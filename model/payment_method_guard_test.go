package model

import (
	"math"
	"sync"
	"testing"
	"time"

	"github.com/dev-fan-sophon/boxai/common"
	"github.com/stretchr/testify/assert"
	"github.com/stretchr/testify/require"
)

func insertUserForPaymentGuardTest(t *testing.T, id int, quota int) {
	t.Helper()
	user := &User{
		Id:       id,
		Username: "payment_guard_user",
		Status:   common.UserStatusEnabled,
		Quota:    quota,
	}
	require.NoError(t, DB.Create(user).Error)
}

func insertSubscriptionPlanForPaymentGuardTest(t *testing.T, id int) *SubscriptionPlan {
	t.Helper()
	plan := &SubscriptionPlan{
		Id:            id,
		Title:         "Guard Plan",
		PriceAmount:   9.99,
		Currency:      "USD",
		DurationUnit:  SubscriptionDurationMonth,
		DurationValue: 1,
		Enabled:       true,
		TotalAmount:   1000,
	}
	require.NoError(t, DB.Create(plan).Error)
	return plan
}

func insertSubscriptionOrderForPaymentGuardTest(t *testing.T, tradeNo string, userID int, planID int, paymentProvider string) {
	t.Helper()
	order := &SubscriptionOrder{
		UserId:          userID,
		PlanId:          planID,
		Money:           9.99,
		TradeNo:         tradeNo,
		PaymentMethod:   paymentProvider,
		PaymentProvider: paymentProvider,
		Status:          common.TopUpStatusPending,
		CreateTime:      time.Now().Unix(),
	}
	require.NoError(t, order.Insert())
}

func insertTopUpForPaymentGuardTest(t *testing.T, tradeNo string, userID int, paymentProvider string) {
	t.Helper()
	topUp := &TopUp{
		UserId:          userID,
		Amount:          2,
		Money:           9.99,
		TradeNo:         tradeNo,
		PaymentMethod:   paymentProvider,
		PaymentProvider: paymentProvider,
		Status:          common.TopUpStatusPending,
		CreateTime:      time.Now().Unix(),
	}
	require.NoError(t, topUp.Insert())
}

func getTopUpStatusForPaymentGuardTest(t *testing.T, tradeNo string) string {
	t.Helper()
	topUp := GetTopUpByTradeNo(tradeNo)
	require.NotNil(t, topUp)
	return topUp.Status
}

func countUserSubscriptionsForPaymentGuardTest(t *testing.T, userID int) int64 {
	t.Helper()
	var count int64
	require.NoError(t, DB.Model(&UserSubscription{}).Where("user_id = ?", userID).Count(&count).Error)
	return count
}

func getUserQuotaForPaymentGuardTest(t *testing.T, userID int) int {
	t.Helper()
	var user User
	require.NoError(t, DB.Select("quota").Where("id = ?", userID).First(&user).Error)
	return user.Quota
}

func TestRechargeWaffoPancake_RejectsMismatchedPaymentMethod(t *testing.T) {
	truncateTables(t)

	insertUserForPaymentGuardTest(t, 101, 0)
	insertTopUpForPaymentGuardTest(t, "waffo-pancake-guard", 101, PaymentProviderStripe)

	err := RechargeWaffoPancake("waffo-pancake-guard")
	require.Error(t, err)

	topUp := GetTopUpByTradeNo("waffo-pancake-guard")
	require.NotNil(t, topUp)
	assert.Equal(t, common.TopUpStatusPending, topUp.Status)
	assert.Equal(t, 0, getUserQuotaForPaymentGuardTest(t, 101))
}

func TestUpdatePendingTopUpStatus_RejectsMismatchedPaymentProvider(t *testing.T) {
	testCases := []struct {
		name                    string
		tradeNo                 string
		storedPaymentProvider   string
		expectedPaymentProvider string
		targetStatus            string
	}{
		{
			name:                    "stripe expire",
			tradeNo:                 "stripe-expire-guard",
			storedPaymentProvider:   PaymentProviderCreem,
			expectedPaymentProvider: PaymentProviderStripe,
			targetStatus:            common.TopUpStatusExpired,
		},
		{
			name:                    "waffo failed",
			tradeNo:                 "waffo-failed-guard",
			storedPaymentProvider:   PaymentProviderStripe,
			expectedPaymentProvider: PaymentProviderWaffo,
			targetStatus:            common.TopUpStatusFailed,
		},
	}

	for _, tc := range testCases {
		t.Run(tc.name, func(t *testing.T) {
			truncateTables(t)
			insertUserForPaymentGuardTest(t, 150, 0)
			insertTopUpForPaymentGuardTest(t, tc.tradeNo, 150, tc.storedPaymentProvider)

			err := UpdatePendingTopUpStatus(tc.tradeNo, tc.expectedPaymentProvider, tc.targetStatus)
			require.ErrorIs(t, err, ErrPaymentMethodMismatch)
			assert.Equal(t, common.TopUpStatusPending, getTopUpStatusForPaymentGuardTest(t, tc.tradeNo))
		})
	}
}

func TestCompleteSubscriptionOrder_RejectsMismatchedPaymentProvider(t *testing.T) {
	truncateTables(t)

	insertUserForPaymentGuardTest(t, 202, 0)
	plan := insertSubscriptionPlanForPaymentGuardTest(t, 301)
	insertSubscriptionOrderForPaymentGuardTest(t, "sub-guard-order", 202, plan.Id, PaymentProviderStripe)

	err := CompleteSubscriptionOrder("sub-guard-order", `{"provider":"epay"}`, PaymentProviderEpay, "alipay")
	require.ErrorIs(t, err, ErrPaymentMethodMismatch)

	order := GetSubscriptionOrderByTradeNo("sub-guard-order")
	require.NotNil(t, order)
	assert.Equal(t, common.TopUpStatusPending, order.Status)
	assert.Zero(t, countUserSubscriptionsForPaymentGuardTest(t, 202))

	topUp := GetTopUpByTradeNo("sub-guard-order")
	assert.Nil(t, topUp)
}

func TestExpireSubscriptionOrder_RejectsMismatchedPaymentProvider(t *testing.T) {
	truncateTables(t)

	insertUserForPaymentGuardTest(t, 303, 0)
	plan := insertSubscriptionPlanForPaymentGuardTest(t, 401)
	insertSubscriptionOrderForPaymentGuardTest(t, "sub-expire-guard", 303, plan.Id, PaymentProviderStripe)

	err := ExpireSubscriptionOrder("sub-expire-guard", PaymentProviderCreem)
	require.ErrorIs(t, err, ErrPaymentMethodMismatch)

	order := GetSubscriptionOrderByTradeNo("sub-expire-guard")
	require.NotNil(t, order)
	assert.Equal(t, common.TopUpStatusPending, order.Status)
}

func insertEpayTopUpForPaymentGuardTest(t *testing.T, tradeNo string, userID int, status string) {
	t.Helper()
	topUp := &TopUp{
		UserId:          userID,
		Amount:          2,
		Money:           9.99,
		TradeNo:         tradeNo,
		PaymentMethod:   "alipay",
		PaymentProvider: PaymentProviderEpay,
		Status:          status,
		CreateTime:      time.Now().Unix(),
	}
	require.NoError(t, topUp.Insert())
}

func useEpayQuotaUnit(t *testing.T, quotaPerUnit float64) {
	t.Helper()
	previous := common.QuotaPerUnit
	common.QuotaPerUnit = quotaPerUnit
	t.Cleanup(func() { common.QuotaPerUnit = previous })
}

func topUpRechargeCases() []struct {
	name          string
	provider      string
	expectedQuota int
	recharge      func(string) error
} {
	return []struct {
		name          string
		provider      string
		expectedQuota int
		recharge      func(string) error
	}{
		{name: "Stripe", provider: PaymentProviderStripe, expectedQuota: 100, recharge: func(tradeNo string) error {
			return Recharge(tradeNo, "cus_test", "127.0.0.1")
		}},
		{name: "Creem", provider: PaymentProviderCreem, expectedQuota: 2, recharge: func(tradeNo string) error {
			return RechargeCreem(tradeNo, "buyer@example.com", "Buyer", "127.0.0.1")
		}},
		{name: "Waffo", provider: PaymentProviderWaffo, expectedQuota: 20, recharge: func(tradeNo string) error {
			return RechargeWaffo(tradeNo, "127.0.0.1")
		}},
		{name: "Waffo Pancake", provider: PaymentProviderWaffoPancake, expectedQuota: 20, recharge: RechargeWaffoPancake},
	}
}

func TestTopUpRechargeCallbacksCreditExactlyOnce(t *testing.T) {
	for i, test := range topUpRechargeCases() {
		t.Run(test.name, func(t *testing.T) {
			truncateTables(t)
			useEpayQuotaUnit(t, 10)
			userID := 600 + i
			tradeNo := "recharge-once-" + test.provider
			insertUserForPaymentGuardTest(t, userID, 0)
			insertTopUpForPaymentGuardTest(t, tradeNo, userID, test.provider)

			require.NoError(t, test.recharge(tradeNo))
			assert.Equal(t, test.expectedQuota, getUserQuotaForPaymentGuardTest(t, userID))
			assert.Equal(t, common.TopUpStatusSuccess, getTopUpStatusForPaymentGuardTest(t, tradeNo))

			require.NoError(t, test.recharge(tradeNo))
			assert.Equal(t, test.expectedQuota, getUserQuotaForPaymentGuardTest(t, userID))
		})
	}
}

func TestTopUpRechargeCallbacksRollBackWithoutUser(t *testing.T) {
	for _, test := range topUpRechargeCases() {
		t.Run(test.name, func(t *testing.T) {
			truncateTables(t)
			useEpayQuotaUnit(t, 10)
			tradeNo := "recharge-missing-user-" + test.provider
			insertTopUpForPaymentGuardTest(t, tradeNo, 9999, test.provider)

			require.Error(t, test.recharge(tradeNo))
			topUp := GetTopUpByTradeNo(tradeNo)
			require.NotNil(t, topUp)
			assert.Equal(t, common.TopUpStatusPending, topUp.Status)
			assert.Zero(t, topUp.CompleteTime)
		})
	}
}

func TestTopUpRechargeCallbacksRejectQuotaOverflow(t *testing.T) {
	for i, test := range topUpRechargeCases() {
		t.Run(test.name, func(t *testing.T) {
			truncateTables(t)
			useEpayQuotaUnit(t, 10)
			userID := 620 + i
			tradeNo := "recharge-overflow-" + test.provider
			insertUserForPaymentGuardTest(t, userID, common.MaxQuota-1)
			insertTopUpForPaymentGuardTest(t, tradeNo, userID, test.provider)

			require.Error(t, test.recharge(tradeNo))
			assert.Equal(t, common.MaxQuota-1, getUserQuotaForPaymentGuardTest(t, userID))
			assert.Equal(t, common.TopUpStatusPending, getTopUpStatusForPaymentGuardTest(t, tradeNo))
		})
	}
}

func TestTopUpRechargeCallbacksRejectUnrepresentableCredit(t *testing.T) {
	for _, test := range topUpRechargeCases() {
		t.Run(test.name, func(t *testing.T) {
			truncateTables(t)
			useEpayQuotaUnit(t, 2)
			const userID = 640
			tradeNo := "recharge-conversion-overflow-" + test.provider
			insertUserForPaymentGuardTest(t, userID, 0)
			insertTopUpForPaymentGuardTest(t, tradeNo, userID, test.provider)
			updates := map[string]interface{}{"amount": int64(math.MaxInt64)}
			if test.provider == PaymentProviderStripe {
				updates["money"] = math.MaxFloat64
			}
			require.NoError(t, DB.Model(&TopUp{}).Where("trade_no = ?", tradeNo).Updates(updates).Error)

			require.Error(t, test.recharge(tradeNo))
			assert.Zero(t, getUserQuotaForPaymentGuardTest(t, userID))
			assert.Equal(t, common.TopUpStatusPending, getTopUpStatusForPaymentGuardTest(t, tradeNo))
		})
	}
}

func TestRechargeEpayCreditsQuotaExactlyOnce(t *testing.T) {
	truncateTables(t)
	useEpayQuotaUnit(t, 500_000)
	insertUserForPaymentGuardTest(t, 501, 0)
	insertEpayTopUpForPaymentGuardTest(t, "epay-once", 501, common.TopUpStatusPending)

	alreadyDone, err := RechargeEpay("epay-once", "wxpay", "127.0.0.1")
	require.NoError(t, err)
	assert.False(t, alreadyDone)
	assert.Equal(t, 1_000_000, getUserQuotaForPaymentGuardTest(t, 501))
	topUp := GetTopUpByTradeNo("epay-once")
	require.NotNil(t, topUp)
	assert.Equal(t, common.TopUpStatusSuccess, topUp.Status)
	assert.Equal(t, "wxpay", topUp.PaymentMethod)
	assert.NotZero(t, topUp.CompleteTime)

	alreadyDone, err = RechargeEpay("epay-once", "wxpay", "127.0.0.1")
	require.NoError(t, err)
	assert.True(t, alreadyDone)
	assert.Equal(t, 1_000_000, getUserQuotaForPaymentGuardTest(t, 501))
}

func TestRechargeEpayConcurrentCallbacksCreditOnce(t *testing.T) {
	truncateTables(t)
	useEpayQuotaUnit(t, 500_000)
	insertUserForPaymentGuardTest(t, 502, 0)
	insertEpayTopUpForPaymentGuardTest(t, "epay-concurrent", 502, common.TopUpStatusPending)

	type result struct {
		alreadyDone bool
		err         error
	}
	start := make(chan struct{})
	results := make(chan result, 2)
	var workers sync.WaitGroup
	workers.Add(2)
	for range 2 {
		go func() {
			defer workers.Done()
			<-start
			alreadyDone, err := RechargeEpay("epay-concurrent", "alipay", "127.0.0.1")
			results <- result{alreadyDone: alreadyDone, err: err}
		}()
	}
	close(start)
	workers.Wait()
	close(results)

	completed := 0
	duplicates := 0
	for result := range results {
		require.NoError(t, result.err)
		if result.alreadyDone {
			duplicates++
		} else {
			completed++
		}
	}
	assert.Equal(t, 1, completed)
	assert.Equal(t, 1, duplicates)
	assert.Equal(t, 1_000_000, getUserQuotaForPaymentGuardTest(t, 502))
}

func TestRechargeEpayRejectsWrongProviderAndInvalidStatus(t *testing.T) {
	tests := []struct {
		name     string
		tradeNo  string
		provider string
		status   string
		wantErr  error
	}{
		{name: "wrong provider", tradeNo: "epay-wrong-provider", provider: PaymentProviderStripe, status: common.TopUpStatusPending, wantErr: ErrPaymentMethodMismatch},
		{name: "expired order", tradeNo: "epay-expired", provider: PaymentProviderEpay, status: common.TopUpStatusExpired, wantErr: ErrTopUpStatusInvalid},
	}

	for i, test := range tests {
		t.Run(test.name, func(t *testing.T) {
			truncateTables(t)
			useEpayQuotaUnit(t, 500_000)
			userID := 510 + i
			insertUserForPaymentGuardTest(t, userID, 7)
			insertTopUpForPaymentGuardTest(t, test.tradeNo, userID, test.provider)
			require.NoError(t, DB.Model(&TopUp{}).Where("trade_no = ?", test.tradeNo).Update("status", test.status).Error)

			_, err := RechargeEpay(test.tradeNo, "alipay", "127.0.0.1")
			assert.ErrorIs(t, err, test.wantErr)
			assert.Equal(t, 7, getUserQuotaForPaymentGuardTest(t, userID))
			assert.Equal(t, test.status, getTopUpStatusForPaymentGuardTest(t, test.tradeNo))
		})
	}

	_, err := RechargeEpay("epay-missing", "alipay", "127.0.0.1")
	assert.ErrorIs(t, err, ErrTopUpNotFound)
}

func TestRechargeEpayRollsBackOrderWhenCreditFails(t *testing.T) {
	truncateTables(t)
	useEpayQuotaUnit(t, 500_000)
	insertEpayTopUpForPaymentGuardTest(t, "epay-missing-user", 999, common.TopUpStatusPending)

	_, err := RechargeEpay("epay-missing-user", "wxpay", "127.0.0.1")
	require.Error(t, err)
	topUp := GetTopUpByTradeNo("epay-missing-user")
	require.NotNil(t, topUp)
	assert.Equal(t, common.TopUpStatusPending, topUp.Status)
	assert.Equal(t, "alipay", topUp.PaymentMethod)
	assert.Zero(t, topUp.CompleteTime)
}

func TestRechargeEpayRejectsQuotaOverflowBeforeCompletingOrder(t *testing.T) {
	truncateTables(t)
	useEpayQuotaUnit(t, 5)
	insertUserForPaymentGuardTest(t, 520, common.MaxQuota-5)
	insertEpayTopUpForPaymentGuardTest(t, "epay-overflow", 520, common.TopUpStatusPending)

	_, err := RechargeEpay("epay-overflow", "alipay", "127.0.0.1")
	require.Error(t, err)
	assert.Equal(t, common.MaxQuota-5, getUserQuotaForPaymentGuardTest(t, 520))
	assert.Equal(t, common.TopUpStatusPending, getTopUpStatusForPaymentGuardTest(t, "epay-overflow"))
}
