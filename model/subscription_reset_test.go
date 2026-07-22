package model

import (
	"strings"
	"testing"
	"time"

	"github.com/QuantumNous/new-api/setting/operation_setting"
	"github.com/stretchr/testify/assert"
	"github.com/stretchr/testify/require"
)

func seedSubscriptionResetPlan(t *testing.T, plan *SubscriptionPlan) {
	t.Helper()
	require.NoError(t, DB.Create(plan).Error)
}

func seedSubscriptionResetSub(t *testing.T, sub *UserSubscription) {
	t.Helper()
	require.NoError(t, DB.Create(sub).Error)
}

func getSubscriptionResetSub(t *testing.T, id int) UserSubscription {
	t.Helper()
	var sub UserSubscription
	require.NoError(t, DB.Where("id = ?", id).First(&sub).Error)
	return sub
}

func TestCalcNextResetTimeUsesBusinessTimezone(t *testing.T) {
	setting := operation_setting.GetGeneralSetting()
	original := setting.BusinessTimezone
	t.Cleanup(func() { setting.BusinessTimezone = original })
	setting.BusinessTimezone = "Asia/Ho_Chi_Minh"

	base := time.Date(2026, 7, 22, 16, 30, 0, 0, time.UTC)
	plan := &SubscriptionPlan{QuotaResetPeriod: SubscriptionResetDaily}
	next := calcNextResetTime(base, plan, 0)

	assert.Equal(t, time.Date(2026, 7, 22, 17, 0, 0, 0, time.UTC).Unix(), next)
}

func TestReconcileActiveSubscriptionResetTimezone(t *testing.T) {
	truncateTables(t)
	setting := operation_setting.GetGeneralSetting()
	original := setting.BusinessTimezone
	t.Cleanup(func() { setting.BusinessTimezone = original })

	now := GetDBTimestamp()
	end := now + 45*24*60*60
	dailyPlan := &SubscriptionPlan{Id: 9001, Title: "Daily", DurationUnit: SubscriptionDurationMonth, DurationValue: 2, TotalAmount: 1000, QuotaResetPeriod: SubscriptionResetDaily}
	customPlan := &SubscriptionPlan{Id: 9002, Title: "Custom", DurationUnit: SubscriptionDurationMonth, DurationValue: 2, TotalAmount: 1000, QuotaResetPeriod: SubscriptionResetCustom, QuotaResetCustomSeconds: 3600}
	neverPlan := &SubscriptionPlan{Id: 9003, Title: "Never", DurationUnit: SubscriptionDurationMonth, DurationValue: 2, TotalAmount: 1000, QuotaResetPeriod: SubscriptionResetNever}
	weeklyPlan := &SubscriptionPlan{Id: 9004, Title: "Weekly", DurationUnit: SubscriptionDurationMonth, DurationValue: 2, TotalAmount: 1000, QuotaResetPeriod: SubscriptionResetWeekly}
	monthlyPlan := &SubscriptionPlan{Id: 9005, Title: "Monthly", DurationUnit: SubscriptionDurationMonth, DurationValue: 2, TotalAmount: 1000, QuotaResetPeriod: SubscriptionResetMonthly}
	seedSubscriptionResetPlan(t, dailyPlan)
	seedSubscriptionResetPlan(t, customPlan)
	seedSubscriptionResetPlan(t, neverPlan)
	seedSubscriptionResetPlan(t, weeklyPlan)
	seedSubscriptionResetPlan(t, monthlyPlan)

	setting.BusinessTimezone = "Asia/Shanghai"
	oldFutureReset := calcNextResetTime(time.Unix(now, 0), dailyPlan, end)
	seedSubscriptionResetSub(t, &UserSubscription{Id: 9001, UserId: 1, PlanId: dailyPlan.Id, AmountTotal: 1000, AmountUsed: 250, StartTime: now - 86400, EndTime: end, Status: "active", LastResetTime: now - 3600, NextResetTime: oldFutureReset, ResetTimezone: "Asia/Shanghai"})
	seedSubscriptionResetSub(t, &UserSubscription{Id: 9002, UserId: 2, PlanId: dailyPlan.Id, AmountTotal: 1000, AmountUsed: 350, StartTime: now - 86400, EndTime: end, Status: "active", LastResetTime: now - 3600, NextResetTime: now - 60, ResetTimezone: "Asia/Shanghai"})
	seedSubscriptionResetSub(t, &UserSubscription{Id: 9003, UserId: 3, PlanId: customPlan.Id, AmountTotal: 1000, AmountUsed: 450, StartTime: now - 3600, EndTime: end, Status: "active", LastResetTime: now - 1800, NextResetTime: now + 1800, ResetTimezone: "Asia/Shanghai"})
	seedSubscriptionResetSub(t, &UserSubscription{Id: 9004, UserId: 4, PlanId: neverPlan.Id, AmountTotal: 1000, AmountUsed: 550, StartTime: now - 3600, EndTime: end, Status: "active", ResetTimezone: "Asia/Shanghai"})
	seedSubscriptionResetSub(t, &UserSubscription{Id: 9005, UserId: 5, PlanId: weeklyPlan.Id, AmountTotal: 1000, AmountUsed: 650, StartTime: now - 3600, EndTime: end, Status: "active", NextResetTime: now + 3600, ResetTimezone: "Asia/Shanghai"})
	seedSubscriptionResetSub(t, &UserSubscription{Id: 9006, UserId: 6, PlanId: monthlyPlan.Id, AmountTotal: 1000, AmountUsed: 750, StartTime: now - 3600, EndTime: end, Status: "active", NextResetTime: now + 3600, ResetTimezone: "Asia/Shanghai"})

	setting.BusinessTimezone = "Asia/Ho_Chi_Minh"
	require.NoError(t, ReconcileActiveSubscriptionResetTimezone())

	future := getSubscriptionResetSub(t, 9001)
	assert.Equal(t, "Asia/Ho_Chi_Minh", future.ResetTimezone)
	assert.Equal(t, calcNextResetTime(time.Unix(now, 0), dailyPlan, end), future.NextResetTime)
	assert.EqualValues(t, 250, future.AmountUsed)

	overdue := getSubscriptionResetSub(t, 9002)
	assert.Equal(t, "Asia/Ho_Chi_Minh", overdue.ResetTimezone)
	assert.Zero(t, overdue.AmountUsed)
	assert.Greater(t, overdue.NextResetTime, now)

	custom := getSubscriptionResetSub(t, 9003)
	assert.Equal(t, "Asia/Shanghai", custom.ResetTimezone)
	assert.Equal(t, now+1800, custom.NextResetTime)
	assert.EqualValues(t, 450, custom.AmountUsed)
	never := getSubscriptionResetSub(t, 9004)
	assert.Equal(t, "Asia/Shanghai", never.ResetTimezone)
	assert.EqualValues(t, 550, never.AmountUsed)
	weekly := getSubscriptionResetSub(t, 9005)
	assert.Equal(t, "Asia/Ho_Chi_Minh", weekly.ResetTimezone)
	assert.Equal(t, calcNextResetTime(time.Unix(now, 0), weeklyPlan, end), weekly.NextResetTime)
	monthly := getSubscriptionResetSub(t, 9006)
	assert.Equal(t, "Asia/Ho_Chi_Minh", monthly.ResetTimezone)
	assert.Equal(t, calcNextResetTime(time.Unix(now, 0), monthlyPlan, end), monthly.NextResetTime)

	// The persisted timezone makes startup reconciliation idempotent.
	require.NoError(t, ReconcileActiveSubscriptionResetTimezone())
	assert.Equal(t, future.NextResetTime, getSubscriptionResetSub(t, 9001).NextResetTime)
}

func TestAdminResetUserSubscriptionsByPlanResetsAllActiveMatchesAndAdvancesTime(t *testing.T) {
	truncateTables(t)

	now := GetDBTimestamp()
	plan := &SubscriptionPlan{
		Id:               9101,
		Title:            "Pro",
		PriceAmount:      10,
		DurationUnit:     SubscriptionDurationMonth,
		DurationValue:    1,
		TotalAmount:      1000,
		QuotaResetPeriod: SubscriptionResetDaily,
	}
	otherPlan := &SubscriptionPlan{
		Id:               9102,
		Title:            "Basic",
		PriceAmount:      1,
		DurationUnit:     SubscriptionDurationMonth,
		DurationValue:    1,
		TotalAmount:      100,
		QuotaResetPeriod: SubscriptionResetDaily,
	}
	seedSubscriptionResetPlan(t, plan)
	seedSubscriptionResetPlan(t, otherPlan)

	activeEnd := now + 30*24*3600
	expiredEnd := now - 1
	seedSubscriptionResetSub(t, &UserSubscription{Id: 9201, UserId: 101, PlanId: plan.Id, AmountTotal: 1000, AmountUsed: 300, StartTime: now - 3600, EndTime: activeEnd, Status: "active", LastResetTime: now - 3600, NextResetTime: now + 120})
	seedSubscriptionResetSub(t, &UserSubscription{Id: 9202, UserId: 101, PlanId: plan.Id, AmountTotal: 1000, AmountUsed: 500, StartTime: now - 3600, EndTime: activeEnd, Status: "active", LastResetTime: now - 3600, NextResetTime: now + 120})
	seedSubscriptionResetSub(t, &UserSubscription{Id: 9203, UserId: 101, PlanId: otherPlan.Id, AmountTotal: 100, AmountUsed: 60, StartTime: now - 3600, EndTime: activeEnd, Status: "active", LastResetTime: now - 3600, NextResetTime: now + 120})
	seedSubscriptionResetSub(t, &UserSubscription{Id: 9204, UserId: 101, PlanId: plan.Id, AmountTotal: 1000, AmountUsed: 700, StartTime: now - 7200, EndTime: expiredEnd, Status: "active", LastResetTime: now - 3600, NextResetTime: now - 10})
	seedSubscriptionResetSub(t, &UserSubscription{Id: 9205, UserId: 102, PlanId: plan.Id, AmountTotal: 1000, AmountUsed: 800, StartTime: now - 3600, EndTime: activeEnd, Status: "active", LastResetTime: now - 3600, NextResetTime: now + 120})
	seedSubscriptionResetSub(t, &UserSubscription{Id: 9206, UserId: 101, PlanId: plan.Id, AmountTotal: 1000, AmountUsed: 900, StartTime: now - 3600, EndTime: activeEnd, Status: "cancelled", LastResetTime: now - 3600, NextResetTime: now + 120})

	beforeReset := GetDBTimestamp()
	result, err := AdminResetUserSubscriptionsByPlan(101, plan.Id, true)
	afterReset := GetDBTimestamp()

	require.NoError(t, err)
	require.NotNil(t, result)
	assert.Equal(t, plan.Id, result.PlanId)
	assert.Equal(t, 2, result.MatchedCount)
	assert.Equal(t, 2, result.ResetCount)
	assert.Equal(t, 1, result.UserCount)
	assert.Equal(t, []int{101}, result.AffectedUserIds)
	assert.True(t, result.AdvanceResetTime)

	for _, id := range []int{9201, 9202} {
		sub := getSubscriptionResetSub(t, id)
		assert.Zero(t, sub.AmountUsed)
		assert.GreaterOrEqual(t, sub.LastResetTime, beforeReset)
		assert.LessOrEqual(t, sub.LastResetTime, afterReset)
		assert.Equal(t, calcNextResetTime(time.Unix(sub.LastResetTime, 0), plan, sub.EndTime), sub.NextResetTime)
	}
	assert.EqualValues(t, 60, getSubscriptionResetSub(t, 9203).AmountUsed)
	assert.EqualValues(t, 700, getSubscriptionResetSub(t, 9204).AmountUsed)
	assert.EqualValues(t, 800, getSubscriptionResetSub(t, 9205).AmountUsed)
	assert.EqualValues(t, 900, getSubscriptionResetSub(t, 9206).AmountUsed)
}

func TestAdminResetUserSubscriptionsByPlanKeepsResetTimes(t *testing.T) {
	truncateTables(t)

	now := GetDBTimestamp()
	plan := &SubscriptionPlan{
		Id:               9301,
		Title:            "Team",
		PriceAmount:      20,
		DurationUnit:     SubscriptionDurationMonth,
		DurationValue:    1,
		TotalAmount:      2000,
		QuotaResetPeriod: SubscriptionResetMonthly,
	}
	seedSubscriptionResetPlan(t, plan)

	lastReset := now - 86400
	nextReset := now + 86400
	seedSubscriptionResetSub(t, &UserSubscription{Id: 9302, UserId: 201, PlanId: plan.Id, AmountTotal: 2000, AmountUsed: 1200, StartTime: now - 172800, EndTime: now + 30*24*3600, Status: "active", LastResetTime: lastReset, NextResetTime: nextReset})

	result, err := AdminResetUserSubscriptionsByPlan(201, plan.Id, false)

	require.NoError(t, err)
	assert.False(t, result.AdvanceResetTime)
	sub := getSubscriptionResetSub(t, 9302)
	assert.Zero(t, sub.AmountUsed)
	assert.Equal(t, lastReset, sub.LastResetTime)
	assert.Equal(t, nextReset, sub.NextResetTime)
}

func TestAdminResetUserSubscriptionsByPlanNoActiveMatchReturnsError(t *testing.T) {
	truncateTables(t)

	now := GetDBTimestamp()
	plan := &SubscriptionPlan{
		Id:            9401,
		Title:         "Expired",
		PriceAmount:   10,
		DurationUnit:  SubscriptionDurationMonth,
		DurationValue: 1,
		TotalAmount:   1000,
	}
	seedSubscriptionResetPlan(t, plan)
	seedSubscriptionResetSub(t, &UserSubscription{Id: 9402, UserId: 301, PlanId: plan.Id, AmountTotal: 1000, AmountUsed: 500, StartTime: now - 7200, EndTime: now - 1, Status: "active"})

	result, err := AdminResetUserSubscriptionsByPlan(301, plan.Id, true)

	require.Error(t, err)
	assert.Nil(t, result)
	assert.True(t, strings.Contains(err.Error(), "该用户没有有效的此套餐订阅"))
}

func TestAdminResetPlanSubscriptionsResetsAllActiveUsers(t *testing.T) {
	truncateTables(t)

	now := GetDBTimestamp()
	plan := &SubscriptionPlan{
		Id:               9501,
		Title:            "Business",
		PriceAmount:      30,
		DurationUnit:     SubscriptionDurationMonth,
		DurationValue:    1,
		TotalAmount:      3000,
		QuotaResetPeriod: SubscriptionResetNever,
	}
	seedSubscriptionResetPlan(t, plan)

	activeEnd := now + 30*24*3600
	seedSubscriptionResetSub(t, &UserSubscription{Id: 9502, UserId: 401, PlanId: plan.Id, AmountTotal: 3000, AmountUsed: 1000, StartTime: now - 3600, EndTime: activeEnd, Status: "active", LastResetTime: now - 3600, NextResetTime: now + 10})
	seedSubscriptionResetSub(t, &UserSubscription{Id: 9503, UserId: 401, PlanId: plan.Id, AmountTotal: 3000, AmountUsed: 1100, StartTime: now - 3500, EndTime: activeEnd, Status: "active", LastResetTime: now - 3600, NextResetTime: now + 10})
	seedSubscriptionResetSub(t, &UserSubscription{Id: 9504, UserId: 402, PlanId: plan.Id, AmountTotal: 3000, AmountUsed: 1200, StartTime: now - 3400, EndTime: activeEnd, Status: "active", LastResetTime: now - 3600, NextResetTime: now + 10})
	seedSubscriptionResetSub(t, &UserSubscription{Id: 9505, UserId: 403, PlanId: plan.Id, AmountTotal: 3000, AmountUsed: 1300, StartTime: now - 7200, EndTime: now - 1, Status: "active", LastResetTime: now - 3600, NextResetTime: now - 10})
	seedSubscriptionResetSub(t, &UserSubscription{Id: 9506, UserId: 404, PlanId: plan.Id, AmountTotal: 3000, AmountUsed: 1400, StartTime: now - 3600, EndTime: activeEnd, Status: "cancelled", LastResetTime: now - 3600, NextResetTime: now + 10})

	result, err := AdminResetPlanSubscriptions(plan.Id, true)

	require.NoError(t, err)
	require.NotNil(t, result)
	assert.Equal(t, 3, result.MatchedCount)
	assert.Equal(t, 3, result.ResetCount)
	assert.Equal(t, 2, result.UserCount)
	assert.Equal(t, []int{401, 402}, result.AffectedUserIds)
	for _, id := range []int{9502, 9503, 9504} {
		sub := getSubscriptionResetSub(t, id)
		assert.Zero(t, sub.AmountUsed)
		assert.Zero(t, sub.LastResetTime)
		assert.Zero(t, sub.NextResetTime)
	}
	assert.EqualValues(t, 1300, getSubscriptionResetSub(t, 9505).AmountUsed)
	assert.EqualValues(t, 1400, getSubscriptionResetSub(t, 9506).AmountUsed)
}

func TestAdminResetPlanSubscriptionsNoMatchSucceeds(t *testing.T) {
	truncateTables(t)

	plan := &SubscriptionPlan{
		Id:            9601,
		Title:         "Empty",
		PriceAmount:   10,
		DurationUnit:  SubscriptionDurationMonth,
		DurationValue: 1,
		TotalAmount:   1000,
	}
	seedSubscriptionResetPlan(t, plan)

	result, err := AdminResetPlanSubscriptions(plan.Id, true)

	require.NoError(t, err)
	require.NotNil(t, result)
	assert.Zero(t, result.MatchedCount)
	assert.Zero(t, result.ResetCount)
	assert.Zero(t, result.UserCount)
	assert.Empty(t, result.AffectedUserIds)
}
