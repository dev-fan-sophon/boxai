package model

import (
	"testing"

	"github.com/dev-fan-sophon/boxai/common"
	"github.com/stretchr/testify/assert"
	"github.com/stretchr/testify/require"
)

func TestAddUserSubscriptionOverageAccumulatesAndFloorsAtZero(t *testing.T) {
	truncateTables(t)

	now := GetDBTimestamp()
	seedSubscriptionResetSub(t, &UserSubscription{Id: 9701, UserId: 501, PlanId: 1, AmountTotal: 1000, StartTime: now - 3600, EndTime: now + 3600, Status: "active"})

	require.NoError(t, AddUserSubscriptionOverage(9701, 300))
	require.NoError(t, AddUserSubscriptionOverage(9701, 200))
	assert.EqualValues(t, 500, getSubscriptionResetSub(t, 9701).OverageUsed)

	// Refund larger than accumulated must clamp at zero, never go negative.
	require.NoError(t, AddUserSubscriptionOverage(9701, -900))
	assert.Zero(t, getSubscriptionResetSub(t, 9701).OverageUsed)
}

func TestAdminResetClearsOverageCounter(t *testing.T) {
	truncateTables(t)

	now := GetDBTimestamp()
	plan := &SubscriptionPlan{Id: 9711, Title: "Pro", DurationUnit: SubscriptionDurationMonth, DurationValue: 1, TotalAmount: 1000, QuotaResetPeriod: SubscriptionResetMonthly}
	seedSubscriptionResetPlan(t, plan)
	seedSubscriptionResetSub(t, &UserSubscription{Id: 9712, UserId: 502, PlanId: plan.Id, AmountTotal: 1000, AmountUsed: 400, OverageUsed: 700, StartTime: now - 3600, EndTime: now + 30*24*3600, Status: "active"})

	_, err := AdminResetUserSubscriptionsByPlan(502, plan.Id, true)
	require.NoError(t, err)

	sub := getSubscriptionResetSub(t, 9712)
	assert.Zero(t, sub.AmountUsed)
	assert.Zero(t, sub.OverageUsed)
}

func TestGetPrimaryActiveSubscriptionForOveragePicksEarliestEnding(t *testing.T) {
	truncateTables(t)

	now := GetDBTimestamp()
	seedSubscriptionResetSub(t, &UserSubscription{Id: 9721, UserId: 503, PlanId: 1, StartTime: now - 3600, EndTime: now + 7200, Status: "active"})
	seedSubscriptionResetSub(t, &UserSubscription{Id: 9722, UserId: 503, PlanId: 1, StartTime: now - 3600, EndTime: now + 3600, Status: "active"})
	seedSubscriptionResetSub(t, &UserSubscription{Id: 9723, UserId: 503, PlanId: 1, StartTime: now - 7200, EndTime: now - 1, Status: "active"})

	sub, err := GetPrimaryActiveSubscriptionForOverage(503)
	require.NoError(t, err)
	require.NotNil(t, sub)
	assert.Equal(t, 9722, sub.Id)

	none, err := GetPrimaryActiveSubscriptionForOverage(999999)
	require.NoError(t, err)
	assert.Nil(t, none)
}

func TestRenewalOrderBypassesPurchaseLimitAndLinksProviderSubscription(t *testing.T) {
	truncateTables(t)

	require.NoError(t, DB.Create(&User{Id: 504, Username: "renewal-user", Group: "default"}).Error)
	plan := &SubscriptionPlan{
		Id:                 9731,
		Title:              "Monthly Pro",
		PriceAmount:        10,
		DurationUnit:       SubscriptionDurationMonth,
		DurationValue:      1,
		TotalAmount:        1000,
		MaxPurchasePerUser: 1,
		Enabled:            true,
	}
	seedSubscriptionResetPlan(t, plan)

	now := GetDBTimestamp()
	// The initial period already exists, so the purchase limit (1) is exhausted.
	seedSubscriptionResetSub(t, &UserSubscription{Id: 9732, UserId: 504, PlanId: plan.Id, AmountTotal: 1000, StartTime: now - 3600, EndTime: now + 3600, Status: "active", ProviderSubscriptionId: "sub_test_123", AutoRenew: true})

	// A plain repurchase must still be blocked by the limit.
	blocked := &SubscriptionOrder{UserId: 504, PlanId: plan.Id, Money: 10, TradeNo: "sub_checkout_dup", PaymentMethod: PaymentMethodStripe, PaymentProvider: PaymentProviderStripe, Status: common.TopUpStatusPending, CreateTime: now}
	require.NoError(t, blocked.Insert())
	require.ErrorIs(t, CompleteSubscriptionOrder("sub_checkout_dup", "", PaymentProviderStripe, ""), ErrSubscriptionPurchaseLimit)

	// A renewal invoice order (trade_no prefix) bypasses the limit and links the
	// new period to the provider subscription with auto-renew enabled.
	renewal := &SubscriptionOrder{UserId: 504, PlanId: plan.Id, Money: 10, TradeNo: RenewalTradeNoPrefix + "in_test_1", PaymentMethod: PaymentMethodStripe, PaymentProvider: PaymentProviderStripe, Status: common.TopUpStatusPending, CreateTime: now, ProviderSubscriptionId: "sub_test_123"}
	require.NoError(t, renewal.Insert())
	require.NoError(t, CompleteSubscriptionOrder(RenewalTradeNoPrefix+"in_test_1", "{}", PaymentProviderStripe, ""))

	var subs []UserSubscription
	require.NoError(t, DB.Where("user_id = ? AND id <> ?", 504, 9732).Find(&subs).Error)
	require.Len(t, subs, 1)
	assert.Equal(t, SubscriptionSourceRenewal, subs[0].Source)
	assert.Equal(t, "sub_test_123", subs[0].ProviderSubscriptionId)
	assert.True(t, subs[0].AutoRenew)
	assert.Zero(t, subs[0].OverageUsed)

	// Completion is idempotent for duplicate webhook deliveries.
	require.NoError(t, CompleteSubscriptionOrder(RenewalTradeNoPrefix+"in_test_1", "{}", PaymentProviderStripe, ""))
	var count int64
	require.NoError(t, DB.Model(&UserSubscription{}).Where("user_id = ?", 504).Count(&count).Error)
	assert.EqualValues(t, 2, count)
}

func TestSetAutoRenewByProviderSubscriptionId(t *testing.T) {
	truncateTables(t)

	now := GetDBTimestamp()
	seedSubscriptionResetSub(t, &UserSubscription{Id: 9741, UserId: 505, PlanId: 1, StartTime: now - 3600, EndTime: now + 3600, Status: "active", ProviderSubscriptionId: "sub_test_456", AutoRenew: true})

	rows, err := SetAutoRenewByProviderSubscriptionId("sub_test_456", false)
	require.NoError(t, err)
	assert.EqualValues(t, 1, rows)
	assert.False(t, getSubscriptionResetSub(t, 9741).AutoRenew)
}
