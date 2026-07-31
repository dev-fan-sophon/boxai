package model

import (
	"fmt"
	"time"

	"github.com/dev-fan-sophon/boxai/common"

	"gorm.io/gorm"
)

// UserGrowthSummary is the headline set of operations metrics for one period.
// Money fields come from paid orders, quota fields from the daily rollup.
type UserGrowthSummary struct {
	TotalUsers       int64   `json:"total_users"`
	NewUsers         int64   `json:"new_users"`
	ActiveUsers      int64   `json:"active_users"`
	PayingUsers      int64   `json:"paying_users"`
	NewPayingUsers   int64   `json:"new_paying_users"`
	Revenue          float64 `json:"revenue"`
	PaidOrders       int64   `json:"paid_orders"`
	QuotaConsumed    int64   `json:"quota_consumed"`
	Requests         int64   `json:"requests"`
	OutstandingQuota int64   `json:"outstanding_quota"`
	Arpu             float64 `json:"arpu"`
	Arppu            float64 `json:"arppu"`
}

type UserGrowthTrendPoint struct {
	Day         int64   `json:"day"`
	NewUsers    int64   `json:"new_users"`
	ActiveUsers int64   `json:"active_users"`
	PayingUsers int64   `json:"paying_users"`
	Revenue     float64 `json:"revenue"`
	Quota       int64   `json:"quota"`
}

type UserGrowthOverview struct {
	Current  UserGrowthSummary      `json:"current"`
	Previous UserGrowthSummary      `json:"previous"`
	Trend    []UserGrowthTrendPoint `json:"trend"`
}

type UserFunnelStage struct {
	Key   string `json:"key"`
	Count int64  `json:"count"`
}

type UserRetentionCohort struct {
	Cohort   int64   `json:"cohort"`
	Size     int64   `json:"size"`
	Retained []int64 `json:"retained"`
}

type RevenueChannelStat struct {
	Provider      string  `json:"provider"`
	Orders        int64   `json:"orders"`
	SuccessOrders int64   `json:"success_orders"`
	Revenue       float64 `json:"revenue"`
}

type RevenueTrendPoint struct {
	Day                 int64   `json:"day"`
	TopUpRevenue        float64 `json:"topup_revenue"`
	SubscriptionRevenue float64 `json:"subscription_revenue"`
	Orders              int64   `json:"orders"`
}

type SubscriptionPlanStat struct {
	PlanId   int     `json:"plan_id"`
	PlanName string  `json:"plan_name"`
	Active   int64   `json:"active"`
	NewSold  int64   `json:"new_sold"`
	Revenue  float64 `json:"revenue"`
}

type RevenueDistributionBucket struct {
	Label string `json:"label"`
	Users int64  `json:"users"`
}

type RevenueAnalytics struct {
	Trend           []RevenueTrendPoint         `json:"trend"`
	Channels        []RevenueChannelStat        `json:"channels"`
	Plans           []SubscriptionPlanStat      `json:"plans"`
	LifetimeBuckets []RevenueDistributionBucket `json:"lifetime_buckets"`
	RepeatBuyers    int64                       `json:"repeat_buyers"`
	FirstTimeBuyers int64                       `json:"first_time_buyers"`
}

type AcquisitionChannelStat struct {
	Channel   string  `json:"channel"`
	Users     int64   `json:"users"`
	Activated int64   `json:"activated"`
	Paid      int64   `json:"paid"`
	Revenue   float64 `json:"revenue"`
}

type InviterStat struct {
	UserId      int     `json:"user_id"`
	Username    string  `json:"username"`
	Invited     int64   `json:"invited"`
	PaidInvited int64   `json:"paid_invited"`
	Revenue     float64 `json:"revenue"`
}

type AcquisitionAnalytics struct {
	Sources     []AcquisitionChannelStat `json:"sources"`
	UtmSources  []AcquisitionChannelStat `json:"utm_sources"`
	Campaigns   []AcquisitionChannelStat `json:"campaigns"`
	Groups      []AcquisitionChannelStat `json:"groups"`
	TopInviters []InviterStat            `json:"top_inviters"`
}

const (
	acquisitionChannelLimit = 20
	topInviterLimit         = 20
	// maxRetentionOffsets caps the retention matrix width so an unbounded date
	// range cannot make the response grow without limit.
	maxRetentionOffsets = 30
)

// liveUsers scopes a query to the users table excluding soft-deleted rows, which
// raw Table() queries do not get from GORM automatically.
func liveUsers(alias string) *gorm.DB {
	if alias == "" {
		return DB.Table("users").Where("deleted_at IS NULL")
	}
	return DB.Table("users " + alias).Where(alias + ".deleted_at IS NULL")
}

// GetUserGrowthOverview returns headline metrics for [start, end] alongside the
// immediately preceding window of equal length, plus a daily trend series.
func GetUserGrowthOverview(start int64, end int64) (*UserGrowthOverview, error) {
	current, err := collectGrowthSummary(start, end)
	if err != nil {
		return nil, err
	}
	span := end - start
	previous, err := collectGrowthSummary(start-span-1, start-1)
	if err != nil {
		return nil, err
	}
	trend, err := collectGrowthTrend(start, end)
	if err != nil {
		return nil, err
	}
	return &UserGrowthOverview{Current: *current, Previous: *previous, Trend: trend}, nil
}

func collectGrowthSummary(start int64, end int64) (*UserGrowthSummary, error) {
	summary := &UserGrowthSummary{}

	if err := liveUsers("").Count(&summary.TotalUsers).Error; err != nil {
		return nil, err
	}
	if err := liveUsers("").Where("created_at BETWEEN ? AND ?", start, end).Count(&summary.NewUsers).Error; err != nil {
		return nil, err
	}
	if err := liveUsers("").Select("coalesce(sum(quota), 0)").Row().Scan(&summary.OutstandingQuota); err != nil {
		return nil, err
	}

	var usage struct {
		ActiveUsers int64
		Quota       int64
		Requests    int64
	}
	if err := DB.Table("user_daily_metrics").
		Where("day BETWEEN ? AND ?", start, end).
		Select("count(distinct user_id) as active_users, coalesce(sum(quota), 0) as quota, coalesce(sum(requests), 0) as requests").
		Scan(&usage).Error; err != nil {
		return nil, err
	}
	summary.ActiveUsers = usage.ActiveUsers
	summary.QuotaConsumed = usage.Quota
	summary.Requests = usage.Requests

	var payments struct {
		PayingUsers int64
		Orders      int64
		Revenue     float64
	}
	if err := DB.Table("top_ups").
		Where("status = ?", common.TopUpStatusSuccess).
		Where("complete_time BETWEEN ? AND ?", start, end).
		Select("count(distinct user_id) as paying_users, count(*) as orders, coalesce(sum(money), 0) as revenue").
		Scan(&payments).Error; err != nil {
		return nil, err
	}
	summary.PayingUsers = payments.PayingUsers
	summary.PaidOrders = payments.Orders
	summary.Revenue = payments.Revenue

	var subscriptionRevenue float64
	if err := DB.Table("subscription_orders").
		Where("status = ?", common.TopUpStatusSuccess).
		Where("complete_time BETWEEN ? AND ?", start, end).
		Select("coalesce(sum(money), 0)").
		Row().Scan(&subscriptionRevenue); err != nil {
		return nil, err
	}
	summary.Revenue += subscriptionRevenue

	if err := DB.Table("user_lifecycles").
		Where("first_paid_at BETWEEN ? AND ?", start, end).
		Count(&summary.NewPayingUsers).Error; err != nil {
		return nil, err
	}

	if summary.ActiveUsers > 0 {
		summary.Arpu = summary.Revenue / float64(summary.ActiveUsers)
	}
	if summary.PayingUsers > 0 {
		summary.Arppu = summary.Revenue / float64(summary.PayingUsers)
	}
	return summary, nil
}

func collectGrowthTrend(start int64, end int64) ([]UserGrowthTrendPoint, error) {
	points := map[int64]*UserGrowthTrendPoint{}
	pointFor := func(day int64) *UserGrowthTrendPoint {
		if existing, ok := points[day]; ok {
			return existing
		}
		created := &UserGrowthTrendPoint{Day: day}
		points[day] = created
		return created
	}

	registrationBucket := dayBucketExpr("created_at")
	var registrations []struct {
		Day   int64
		Total int64
	}
	if err := liveUsers("").
		Where("created_at BETWEEN ? AND ?", start, end).
		Select(fmt.Sprintf("%s as day, count(*) as total", registrationBucket)).
		Group(registrationBucket).
		Find(&registrations).Error; err != nil {
		return nil, err
	}
	for _, row := range registrations {
		pointFor(row.Day).NewUsers = row.Total
	}

	var usage []struct {
		Day     int64
		Actives int64
		Quota   int64
	}
	if err := DB.Table("user_daily_metrics").
		Where("day BETWEEN ? AND ?", start, end).
		Select("day as day, count(distinct user_id) as actives, coalesce(sum(quota), 0) as quota").
		Group("day").
		Find(&usage).Error; err != nil {
		return nil, err
	}
	for _, row := range usage {
		point := pointFor(row.Day)
		point.ActiveUsers = row.Actives
		point.Quota = row.Quota
	}

	paymentBucket := dayBucketExpr("complete_time")
	var payments []struct {
		Day     int64
		Payers  int64
		Revenue float64
	}
	if err := DB.Table("top_ups").
		Where("status = ?", common.TopUpStatusSuccess).
		Where("complete_time BETWEEN ? AND ?", start, end).
		Select(fmt.Sprintf("%s as day, count(distinct user_id) as payers, coalesce(sum(money), 0) as revenue", paymentBucket)).
		Group(paymentBucket).
		Find(&payments).Error; err != nil {
		return nil, err
	}
	for _, row := range payments {
		point := pointFor(row.Day)
		point.PayingUsers = row.Payers
		point.Revenue = row.Revenue
	}

	return sortedTrendPoints(points, start, end), nil
}

func sortedTrendPoints(points map[int64]*UserGrowthTrendPoint, start int64, end int64) []UserGrowthTrendPoint {
	firstDay := StartOfLocalDay(time.Unix(start, 0))
	lastDay := StartOfLocalDay(time.Unix(end, 0))
	result := make([]UserGrowthTrendPoint, 0, (lastDay-firstDay)/secondsPerDay+1)
	for day := firstDay; day <= lastDay; day += secondsPerDay {
		if point, ok := points[day]; ok {
			result = append(result, *point)
			continue
		}
		result = append(result, UserGrowthTrendPoint{Day: day})
	}
	return result
}

// GetUserFunnel measures how far the users registered in [start, end] progressed:
// registered, made a successful call, paid once, paid again.
func GetUserFunnel(start int64, end int64) ([]UserFunnelStage, error) {
	base := func() *gorm.DB {
		return liveUsers("u").
			Joins("LEFT JOIN user_lifecycles l ON l.user_id = u.id").
			Where("u.created_at BETWEEN ? AND ?", start, end)
	}

	stages := []UserFunnelStage{
		{Key: "registered"},
		{Key: "activated"},
		{Key: "paid"},
		{Key: "repeat_paid"},
	}
	if err := base().Count(&stages[0].Count).Error; err != nil {
		return nil, err
	}
	if err := base().Where("l.first_active_at > 0").Count(&stages[1].Count).Error; err != nil {
		return nil, err
	}
	if err := base().Where("l.first_paid_at > 0").Count(&stages[2].Count).Error; err != nil {
		return nil, err
	}
	if err := base().Where("l.topup_count >= ?", 2).Count(&stages[3].Count).Error; err != nil {
		return nil, err
	}
	return stages, nil
}

// GetUserRetentionCohorts groups users by registration day and reports how many
// of each cohort were active on each following day.
func GetUserRetentionCohorts(start int64, end int64, offsets int) ([]UserRetentionCohort, error) {
	if offsets <= 0 || offsets > maxRetentionOffsets {
		offsets = maxRetentionOffsets
	}
	cohortBucket := dayBucketExpr("u.created_at")

	var sizes []struct {
		Cohort int64
		Total  int64
	}
	if err := liveUsers("u").
		Where("u.created_at BETWEEN ? AND ?", start, end).
		Select(fmt.Sprintf("%s as cohort, count(*) as total", cohortBucket)).
		Group(cohortBucket).
		Order("cohort ASC").
		Find(&sizes).Error; err != nil {
		return nil, err
	}
	if len(sizes) == 0 {
		return []UserRetentionCohort{}, nil
	}

	var retained []struct {
		Cohort    int64
		DayOffset int64
		Total     int64
	}
	offsetExpr := fmt.Sprintf("((m.day - %s) / %d)", cohortBucket, secondsPerDay)
	if err := liveUsers("u").
		Joins("JOIN user_daily_metrics m ON m.user_id = u.id").
		Where("u.created_at BETWEEN ? AND ?", start, end).
		Where(fmt.Sprintf("m.day >= %s", cohortBucket)).
		Select(fmt.Sprintf("%s as cohort, %s as day_offset, count(distinct m.user_id) as total", cohortBucket, offsetExpr)).
		Group(fmt.Sprintf("%s, %s", cohortBucket, offsetExpr)).
		Find(&retained).Error; err != nil {
		return nil, err
	}

	cohorts := make([]UserRetentionCohort, 0, len(sizes))
	indexByCohort := map[int64]int{}
	for _, row := range sizes {
		indexByCohort[row.Cohort] = len(cohorts)
		cohorts = append(cohorts, UserRetentionCohort{
			Cohort:   row.Cohort,
			Size:     row.Total,
			Retained: make([]int64, offsets),
		})
	}
	for _, row := range retained {
		index, ok := indexByCohort[row.Cohort]
		if !ok || row.DayOffset < 0 || row.DayOffset >= int64(offsets) {
			continue
		}
		cohorts[index].Retained[row.DayOffset] = row.Total
	}
	return cohorts, nil
}

// GetRevenueAnalytics reports paid revenue by day and channel, subscription plan
// performance, and how lifetime spend is distributed across paying users.
func GetRevenueAnalytics(start int64, end int64) (*RevenueAnalytics, error) {
	analytics := &RevenueAnalytics{}

	trend := map[int64]*RevenueTrendPoint{}
	trendFor := func(day int64) *RevenueTrendPoint {
		if existing, ok := trend[day]; ok {
			return existing
		}
		created := &RevenueTrendPoint{Day: day}
		trend[day] = created
		return created
	}

	bucket := dayBucketExpr("complete_time")
	var topUpTrend []struct {
		Day     int64
		Orders  int64
		Revenue float64
	}
	if err := DB.Table("top_ups").
		Where("status = ?", common.TopUpStatusSuccess).
		Where("complete_time BETWEEN ? AND ?", start, end).
		Select(fmt.Sprintf("%s as day, count(*) as orders, coalesce(sum(money), 0) as revenue", bucket)).
		Group(bucket).
		Find(&topUpTrend).Error; err != nil {
		return nil, err
	}
	for _, row := range topUpTrend {
		point := trendFor(row.Day)
		point.Orders += row.Orders
		point.TopUpRevenue = row.Revenue
	}

	var subscriptionTrend []struct {
		Day     int64
		Orders  int64
		Revenue float64
	}
	if err := DB.Table("subscription_orders").
		Where("status = ?", common.TopUpStatusSuccess).
		Where("complete_time BETWEEN ? AND ?", start, end).
		Select(fmt.Sprintf("%s as day, count(*) as orders, coalesce(sum(money), 0) as revenue", bucket)).
		Group(bucket).
		Find(&subscriptionTrend).Error; err != nil {
		return nil, err
	}
	for _, row := range subscriptionTrend {
		point := trendFor(row.Day)
		point.Orders += row.Orders
		point.SubscriptionRevenue = row.Revenue
	}

	firstDay := StartOfLocalDay(time.Unix(start, 0))
	lastDay := StartOfLocalDay(time.Unix(end, 0))
	for day := firstDay; day <= lastDay; day += secondsPerDay {
		if point, ok := trend[day]; ok {
			analytics.Trend = append(analytics.Trend, *point)
			continue
		}
		analytics.Trend = append(analytics.Trend, RevenueTrendPoint{Day: day})
	}

	if err := DB.Table("top_ups").
		Where("create_time BETWEEN ? AND ?", start, end).
		Select(fmt.Sprintf(
			"payment_provider as provider, count(*) as orders, sum(case when status = '%s' then 1 else 0 end) as success_orders, coalesce(sum(case when status = '%s' then money else 0 end), 0) as revenue",
			common.TopUpStatusSuccess, common.TopUpStatusSuccess,
		)).
		Group("payment_provider").
		Order("revenue DESC").
		Find(&analytics.Channels).Error; err != nil {
		return nil, err
	}

	if err := collectSubscriptionPlanStats(start, end, analytics); err != nil {
		return nil, err
	}

	if err := DB.Table("user_lifecycles").Where("topup_count >= ?", 2).Count(&analytics.RepeatBuyers).Error; err != nil {
		return nil, err
	}
	if err := DB.Table("user_lifecycles").Where("topup_count = ?", 1).Count(&analytics.FirstTimeBuyers).Error; err != nil {
		return nil, err
	}

	buckets := []struct {
		label string
		lower float64
		upper float64
	}{
		{"0-10", 0, 10},
		{"10-50", 10, 50},
		{"50-200", 50, 200},
		{"200-1000", 200, 1000},
		{"1000+", 1000, 0},
	}
	for _, definition := range buckets {
		query := DB.Table("user_lifecycles").Where("topup_money > ?", definition.lower)
		if definition.upper > 0 {
			query = query.Where("topup_money <= ?", definition.upper)
		}
		var count int64
		if err := query.Count(&count).Error; err != nil {
			return nil, err
		}
		analytics.LifetimeBuckets = append(analytics.LifetimeBuckets, RevenueDistributionBucket{
			Label: definition.label,
			Users: count,
		})
	}
	return analytics, nil
}

func collectSubscriptionPlanStats(start int64, end int64, analytics *RevenueAnalytics) error {
	var plans []SubscriptionPlan
	if err := DB.Find(&plans).Error; err != nil {
		return err
	}
	if len(plans) == 0 {
		return nil
	}

	var sold []struct {
		PlanId  int
		NewSold int64
		Revenue float64
	}
	if err := DB.Table("subscription_orders").
		Where("status = ?", common.TopUpStatusSuccess).
		Where("complete_time BETWEEN ? AND ?", start, end).
		Select("plan_id as plan_id, count(*) as new_sold, coalesce(sum(money), 0) as revenue").
		Group("plan_id").
		Find(&sold).Error; err != nil {
		return err
	}
	soldByPlan := map[int]struct {
		NewSold int64
		Revenue float64
	}{}
	for _, row := range sold {
		soldByPlan[row.PlanId] = struct {
			NewSold int64
			Revenue float64
		}{NewSold: row.NewSold, Revenue: row.Revenue}
	}

	var active []struct {
		PlanId int
		Total  int64
	}
	if err := DB.Table("user_subscriptions").
		Where("status = ?", "active").
		Where("end_time > ?", common.GetTimestamp()).
		Select("plan_id as plan_id, count(*) as total").
		Group("plan_id").
		Find(&active).Error; err != nil {
		return err
	}
	activeByPlan := map[int]int64{}
	for _, row := range active {
		activeByPlan[row.PlanId] = row.Total
	}

	for _, plan := range plans {
		stat := SubscriptionPlanStat{
			PlanId:   plan.Id,
			PlanName: plan.Title,
			Active:   activeByPlan[plan.Id],
		}
		if row, ok := soldByPlan[plan.Id]; ok {
			stat.NewSold = row.NewSold
			stat.Revenue = row.Revenue
		}
		if stat.Active == 0 && stat.NewSold == 0 {
			continue
		}
		analytics.Plans = append(analytics.Plans, stat)
	}
	return nil
}

// GetAcquisitionAnalytics breaks the users registered in [start, end] down by the
// channel they arrived through, and ranks the affiliates who brought them.
func GetAcquisitionAnalytics(start int64, end int64) (*AcquisitionAnalytics, error) {
	analytics := &AcquisitionAnalytics{}

	channelColumns := []struct {
		column string
		target *[]AcquisitionChannelStat
	}{
		{"u.register_source", &analytics.Sources},
		{"u.utm_source", &analytics.UtmSources},
		{"u.utm_campaign", &analytics.Campaigns},
		{"u." + commonGroupCol, &analytics.Groups},
	}
	for _, definition := range channelColumns {
		stats, err := collectAcquisitionChannel(definition.column, start, end)
		if err != nil {
			return nil, err
		}
		*definition.target = stats
	}

	if err := liveUsers("u").
		Joins("JOIN users inviter ON inviter.id = u.inviter_id AND inviter.deleted_at IS NULL").
		Joins("LEFT JOIN user_lifecycles l ON l.user_id = u.id").
		Where("u.inviter_id > 0").
		Where("u.created_at BETWEEN ? AND ?", start, end).
		Select("u.inviter_id as user_id, inviter.username as username, count(*) as invited, sum(case when l.first_paid_at > 0 then 1 else 0 end) as paid_invited, coalesce(sum(l.topup_money), 0) as revenue").
		Group("u.inviter_id, inviter.username").
		Order("invited DESC").
		Limit(topInviterLimit).
		Find(&analytics.TopInviters).Error; err != nil {
		return nil, err
	}
	return analytics, nil
}

func collectAcquisitionChannel(column string, start int64, end int64) ([]AcquisitionChannelStat, error) {
	var stats []AcquisitionChannelStat
	err := liveUsers("u").
		Joins("LEFT JOIN user_lifecycles l ON l.user_id = u.id").
		Where("u.created_at BETWEEN ? AND ?", start, end).
		Select(fmt.Sprintf(
			"%s as channel, count(*) as users, sum(case when l.first_active_at > 0 then 1 else 0 end) as activated, sum(case when l.first_paid_at > 0 then 1 else 0 end) as paid, coalesce(sum(l.topup_money), 0) as revenue",
			column,
		)).
		Group(column).
		Order("users DESC").
		Limit(acquisitionChannelLimit).
		Find(&stats).Error
	if err != nil {
		return nil, err
	}
	for i := range stats {
		if stats[i].Channel == "" {
			stats[i].Channel = "unknown"
		}
	}
	return stats, nil
}
