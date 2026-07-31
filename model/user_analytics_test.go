package model

import (
	"testing"
	"time"

	"github.com/dev-fan-sophon/boxai/common"

	"github.com/stretchr/testify/assert"
	"github.com/stretchr/testify/require"
)

func seedAnalyticsUser(t *testing.T, id int, createdAt int64, registerSource string, utmSource string) *User {
	t.Helper()
	user := &User{
		Id:             id,
		Username:       "analytics" + time.Unix(createdAt, 0).Format("150405") + string(rune('a'+id%26)),
		Password:       "password123",
		DisplayName:    "Analytics User",
		Role:           common.RoleCommonUser,
		Status:         common.UserStatusEnabled,
		Group:          "default",
		AffCode:        "aff" + time.Unix(createdAt, 0).Format("150405") + string(rune('a'+id%26)),
		CreatedAt:      createdAt,
		RegisterSource: registerSource,
		UtmSource:      utmSource,
	}
	require.NoError(t, DB.Create(user).Error)
	return user
}

func seedQuotaData(t *testing.T, userID int, hour int64, modelName string, quota int, tokens int) {
	t.Helper()
	require.NoError(t, DB.Create(&QuotaData{
		UserID:    userID,
		Username:  "analytics",
		ModelName: modelName,
		CreatedAt: hour - hour%3600,
		Count:     1,
		Quota:     quota,
		TokenUsed: tokens,
	}).Error)
}

func seedSuccessfulTopUp(t *testing.T, userID int, completeTime int64, money float64) {
	t.Helper()
	require.NoError(t, DB.Create(&TopUp{
		UserId:       userID,
		Amount:       10,
		Money:        money,
		TradeNo:      time.Now().Format("150405.000000000") + "-" + string(rune('a'+userID%26)),
		Status:       common.TopUpStatusSuccess,
		CreateTime:   completeTime,
		CompleteTime: completeTime,
	}).Error)
}

// TestRollupUserMetricsAggregatesByLocalDay pins the contract that the rollup
// collapses hourly quota_data rows into one row per user per local calendar day
// and that lifecycle totals are derived from it.
func TestRollupUserMetricsAggregatesByLocalDay(t *testing.T) {
	truncateTables(t)

	today := StartOfLocalDay(time.Now())
	yesterday := today - secondsPerDay
	user := seedAnalyticsUser(t, 1, yesterday, RegisterSourcePassword, "newsletter")

	seedQuotaData(t, user.Id, today+3600, "gpt-4o", 100, 1000)
	seedQuotaData(t, user.Id, today+7200, "gpt-4o", 50, 500)
	seedQuotaData(t, user.Id, yesterday+3600, "claude", 30, 300)

	require.NoError(t, RollupUserMetrics(0))

	var metrics []UserDailyMetric
	require.NoError(t, DB.Order("day ASC").Find(&metrics).Error)
	require.Len(t, metrics, 2)
	assert.Equal(t, yesterday, metrics[0].Day)
	assert.Equal(t, int64(30), metrics[0].Quota)
	assert.Equal(t, today, metrics[1].Day)
	assert.Equal(t, int64(150), metrics[1].Quota)
	assert.Equal(t, int64(2), metrics[1].Requests)
	assert.Equal(t, int64(1500), metrics[1].Tokens)

	lifecycle := &UserLifecycle{}
	require.NoError(t, DB.First(lifecycle, "user_id = ?", user.Id).Error)
	assert.Equal(t, yesterday, lifecycle.FirstActiveAt)
	assert.Equal(t, today, lifecycle.LastActiveAt)
	assert.Equal(t, 2, lifecycle.ActiveDays)
	assert.Equal(t, int64(180), lifecycle.TotalQuotaUsed)
	assert.Equal(t, int64(3), lifecycle.TotalRequests)
}

// TestRollupUserMetricsIsIdempotent guards the incremental pass: re-aggregating
// the same window must overwrite the day rows instead of duplicating them.
func TestRollupUserMetricsIsIdempotent(t *testing.T) {
	truncateTables(t)

	today := StartOfLocalDay(time.Now())
	user := seedAnalyticsUser(t, 2, today, RegisterSourcePassword, "")
	seedQuotaData(t, user.Id, today+3600, "gpt-4o", 100, 1000)

	require.NoError(t, RollupUserMetrics(0))
	require.NoError(t, RollupUserMetrics(today))

	var metrics []UserDailyMetric
	require.NoError(t, DB.Find(&metrics).Error)
	require.Len(t, metrics, 1)
	assert.Equal(t, int64(100), metrics[0].Quota)
}

// TestUserLifecycleTracksPayments checks that payment-derived fields used by the
// revenue and funnel views come from successful top-ups only.
func TestUserLifecycleTracksPayments(t *testing.T) {
	truncateTables(t)

	today := StartOfLocalDay(time.Now())
	user := seedAnalyticsUser(t, 3, today, RegisterSourcePassword, "")
	seedSuccessfulTopUp(t, user.Id, today+100, 12.5)
	seedSuccessfulTopUp(t, user.Id, today+200, 7.5)
	require.NoError(t, DB.Create(&TopUp{
		UserId: user.Id, Amount: 10, Money: 999, TradeNo: "pending-order",
		Status: common.TopUpStatusPending, CreateTime: today, CompleteTime: 0,
	}).Error)

	require.NoError(t, RollupUserMetrics(0))

	lifecycle := &UserLifecycle{}
	require.NoError(t, DB.First(lifecycle, "user_id = ?", user.Id).Error)
	assert.Equal(t, 2, lifecycle.TopupCount)
	assert.InDelta(t, 20.0, lifecycle.TopupMoney, 0.001)
	assert.Equal(t, today+100, lifecycle.FirstPaidAt)
	assert.Equal(t, today+200, lifecycle.LastPaidAt)
}

// TestGetUserFunnelCountsProgression covers the acquisition funnel contract:
// each stage is a strict subset of the previous one within the registration
// cohort.
func TestGetUserFunnelCountsProgression(t *testing.T) {
	truncateTables(t)

	today := StartOfLocalDay(time.Now())
	registered := seedAnalyticsUser(t, 4, today, RegisterSourcePassword, "")
	activated := seedAnalyticsUser(t, 5, today, RegisterSourcePassword, "")
	paid := seedAnalyticsUser(t, 6, today, RegisterSourcePassword, "")
	repeat := seedAnalyticsUser(t, 7, today, RegisterSourcePassword, "")

	seedQuotaData(t, activated.Id, today+3600, "gpt-4o", 10, 100)
	seedQuotaData(t, paid.Id, today+3600, "gpt-4o", 10, 100)
	seedQuotaData(t, repeat.Id, today+3600, "gpt-4o", 10, 100)
	seedSuccessfulTopUp(t, paid.Id, today+100, 5)
	seedSuccessfulTopUp(t, repeat.Id, today+100, 5)
	seedSuccessfulTopUp(t, repeat.Id, today+200, 5)

	require.NoError(t, RollupUserMetrics(0))

	stages, err := GetUserFunnel(today, today+secondsPerDay)
	require.NoError(t, err)
	require.Len(t, stages, 4)
	assert.Equal(t, "registered", stages[0].Key)
	assert.Equal(t, int64(4), stages[0].Count)
	assert.Equal(t, int64(3), stages[1].Count)
	assert.Equal(t, int64(2), stages[2].Count)
	assert.Equal(t, int64(1), stages[3].Count)
	assert.NotZero(t, registered.Id)
}

// TestGetUserRetentionCohortsBucketsByRegistrationDay verifies the retention
// matrix indexes activity by whole days elapsed since registration.
func TestGetUserRetentionCohortsBucketsByRegistrationDay(t *testing.T) {
	truncateTables(t)

	today := StartOfLocalDay(time.Now())
	cohortDay := today - 2*secondsPerDay
	user := seedAnalyticsUser(t, 8, cohortDay+100, RegisterSourcePassword, "")

	seedQuotaData(t, user.Id, cohortDay+3600, "gpt-4o", 10, 100)
	seedQuotaData(t, user.Id, today+3600, "gpt-4o", 10, 100)
	require.NoError(t, RollupUserMetrics(0))

	cohorts, err := GetUserRetentionCohorts(cohortDay, today+secondsPerDay, 7)
	require.NoError(t, err)
	require.Len(t, cohorts, 1)
	assert.Equal(t, cohortDay, cohorts[0].Cohort)
	assert.Equal(t, int64(1), cohorts[0].Size)
	assert.Equal(t, int64(1), cohorts[0].Retained[0])
	assert.Equal(t, int64(0), cohorts[0].Retained[1])
	assert.Equal(t, int64(1), cohorts[0].Retained[2])
}

// TestGetAcquisitionAnalyticsGroupsByChannel confirms marketing attribution
// captured at signup is what the acquisition view reports on.
func TestGetAcquisitionAnalyticsGroupsByChannel(t *testing.T) {
	truncateTables(t)

	today := StartOfLocalDay(time.Now())
	first := seedAnalyticsUser(t, 9, today, RegisterSourcePassword, "newsletter")
	seedAnalyticsUser(t, 10, today, RegisterSourcePassword, "newsletter")
	seedAnalyticsUser(t, 11, today, RegisterSourceOAuth+":zalo", "")

	seedQuotaData(t, first.Id, today+3600, "gpt-4o", 10, 100)
	seedSuccessfulTopUp(t, first.Id, today+100, 9)
	require.NoError(t, RollupUserMetrics(0))

	analytics, err := GetAcquisitionAnalytics(today, today+secondsPerDay)
	require.NoError(t, err)

	sources := map[string]AcquisitionChannelStat{}
	for _, stat := range analytics.Sources {
		sources[stat.Channel] = stat
	}
	assert.Equal(t, int64(2), sources[RegisterSourcePassword].Users)
	assert.Equal(t, int64(1), sources[RegisterSourcePassword].Activated)
	assert.Equal(t, int64(1), sources[RegisterSourcePassword].Paid)
	assert.InDelta(t, 9.0, sources[RegisterSourcePassword].Revenue, 0.001)
	assert.Equal(t, int64(1), sources[RegisterSourceOAuth+":zalo"].Users)

	utm := map[string]AcquisitionChannelStat{}
	for _, stat := range analytics.UtmSources {
		utm[stat.Channel] = stat
	}
	assert.Equal(t, int64(2), utm["newsletter"].Users)
	assert.Equal(t, int64(1), utm["unknown"].Users)
}

// TestGetUserGrowthOverviewSummarizesWindow locks the headline metrics that the
// operations overview renders, including the derived per-user averages.
func TestGetUserGrowthOverviewSummarizesWindow(t *testing.T) {
	truncateTables(t)

	today := StartOfLocalDay(time.Now())
	first := seedAnalyticsUser(t, 12, today, RegisterSourcePassword, "")
	second := seedAnalyticsUser(t, 13, today, RegisterSourcePassword, "")

	seedQuotaData(t, first.Id, today+3600, "gpt-4o", 40, 400)
	seedQuotaData(t, second.Id, today+3600, "gpt-4o", 60, 600)
	seedSuccessfulTopUp(t, first.Id, today+100, 10)
	require.NoError(t, RollupUserMetrics(0))

	overview, err := GetUserGrowthOverview(today, today+secondsPerDay-1)
	require.NoError(t, err)
	assert.Equal(t, int64(2), overview.Current.TotalUsers)
	assert.Equal(t, int64(2), overview.Current.NewUsers)
	assert.Equal(t, int64(2), overview.Current.ActiveUsers)
	assert.Equal(t, int64(1), overview.Current.PayingUsers)
	assert.Equal(t, int64(1), overview.Current.NewPayingUsers)
	assert.Equal(t, int64(100), overview.Current.QuotaConsumed)
	assert.InDelta(t, 10.0, overview.Current.Revenue, 0.001)
	assert.InDelta(t, 5.0, overview.Current.Arpu, 0.001)
	assert.InDelta(t, 10.0, overview.Current.Arppu, 0.001)
	require.NotEmpty(t, overview.Trend)
	assert.Equal(t, today, overview.Trend[len(overview.Trend)-1].Day)
}
