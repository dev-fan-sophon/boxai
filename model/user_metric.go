package model

import (
	"fmt"
	"time"

	"github.com/dev-fan-sophon/boxai/common"

	"gorm.io/gorm"
	"gorm.io/gorm/clause"
)

// UserDailyMetric is the per-user, per-day rollup of quota_data. Operations
// analytics reads this table instead of scanning the hourly source rows, and it
// lives in the main database so it can be joined against users, top-ups, and
// subscriptions (the log database may be a separate server or ClickHouse).
type UserDailyMetric struct {
	Id       int   `json:"id"`
	Day      int64 `json:"day" gorm:"bigint;not null;uniqueIndex:idx_udm_day_user,priority:1"`
	UserId   int   `json:"user_id" gorm:"not null;uniqueIndex:idx_udm_day_user,priority:2;index"`
	Requests int64 `json:"requests" gorm:"bigint;default:0"`
	Tokens   int64 `json:"tokens" gorm:"bigint;default:0"`
	Quota    int64 `json:"quota" gorm:"bigint;default:0"`
}

func (UserDailyMetric) TableName() string {
	return "user_daily_metrics"
}

// UserLifecycle holds derived per-user marketing metrics. It is a separate table
// rather than extra columns on users because it is rewritten on every rollup and
// the users table is on the hot authentication path.
type UserLifecycle struct {
	UserId         int     `json:"user_id" gorm:"primaryKey;autoIncrement:false"`
	FirstActiveAt  int64   `json:"first_active_at" gorm:"bigint;default:0;index"`
	LastActiveAt   int64   `json:"last_active_at" gorm:"bigint;default:0;index"`
	ActiveDays     int     `json:"active_days" gorm:"default:0"`
	ActiveDays30   int     `json:"active_days_30" gorm:"column:active_days_30;default:0"`
	TotalRequests  int64   `json:"total_requests" gorm:"bigint;default:0"`
	TotalQuotaUsed int64   `json:"total_quota_used" gorm:"bigint;default:0"`
	Quota7         int64   `json:"quota_7" gorm:"bigint;column:quota_7;default:0"`
	Quota30        int64   `json:"quota_30" gorm:"bigint;column:quota_30;default:0"`
	FirstPaidAt    int64   `json:"first_paid_at" gorm:"bigint;default:0;index"`
	LastPaidAt     int64   `json:"last_paid_at" gorm:"bigint;default:0"`
	TopupCount     int     `json:"topup_count" gorm:"default:0;index"`
	TopupMoney     float64 `json:"topup_money" gorm:"default:0"`
	TopupAmount    int64   `json:"topup_amount" gorm:"bigint;default:0"`
	RefreshedAt    int64   `json:"refreshed_at" gorm:"bigint;default:0"`
}

func (UserLifecycle) TableName() string {
	return "user_lifecycles"
}

const (
	secondsPerDay = 86400
	// userMetricRollupWindowDays re-aggregates the trailing few days on every
	// incremental pass so late-arriving quota_data flushes are picked up.
	userMetricRollupWindowDays = 3
	userMetricUpsertBatchSize  = 200
)

// dayBucketExpr renders a dialect-safe SQL expression that truncates a unix
// timestamp column to the start of its local calendar day. MySQL's `/` yields a
// decimal, so it needs an explicit FLOOR; SQLite and PostgreSQL divide integers.
func dayBucketExpr(column string) string {
	_, offset := time.Now().Zone()
	if common.UsingMainDatabase(common.DatabaseTypeMySQL) {
		return fmt.Sprintf("(FLOOR((%s + %d) / %d) * %d - %d)", column, offset, secondsPerDay, secondsPerDay, offset)
	}
	return fmt.Sprintf("((%s + %d) / %d * %d - %d)", column, offset, secondsPerDay, secondsPerDay, offset)
}

// StartOfLocalDay returns the unix timestamp of midnight local time for t.
func StartOfLocalDay(t time.Time) int64 {
	year, month, day := t.Date()
	return time.Date(year, month, day, 0, 0, 0, 0, t.Location()).Unix()
}

// StartUserMetricRollupTask backfills the operations rollups once at boot and
// then keeps them fresh. The full backfill is a single grouped query, so it
// stays cheap even when quota_data already holds a long history.
func StartUserMetricRollupTask(intervalMinutes int) {
	if intervalMinutes <= 0 {
		intervalMinutes = 30
	}
	if err := RollupUserMetrics(0); err != nil {
		common.SysError("initial user metric rollup failed: " + err.Error())
	}
	for {
		time.Sleep(time.Duration(intervalMinutes) * time.Minute)
		since := StartOfLocalDay(time.Now().AddDate(0, 0, -(userMetricRollupWindowDays - 1)))
		if err := RollupUserMetrics(since); err != nil {
			common.SysError("user metric rollup failed: " + err.Error())
		}
	}
}

// RollupUserMetrics refreshes the daily rollup for quota_data rows created at or
// after since (pass 0 for a full rebuild), then recomputes the lifecycle rows of
// every user touched in that window.
func RollupUserMetrics(since int64) error {
	touched, err := rollupUserDailyMetrics(since)
	if err != nil {
		return err
	}
	paying, err := usersWithTopUpsSince(since)
	if err != nil {
		return err
	}
	for _, userID := range paying {
		touched[userID] = struct{}{}
	}
	if since <= 0 {
		return RefreshUserLifecycle(nil)
	}
	if len(touched) == 0 {
		return nil
	}
	userIDs := make([]int, 0, len(touched))
	for userID := range touched {
		userIDs = append(userIDs, userID)
	}
	return RefreshUserLifecycle(userIDs)
}

func rollupUserDailyMetrics(since int64) (map[int]struct{}, error) {
	bucket := dayBucketExpr("created_at")
	query := DB.Table("quota_data").
		Select(fmt.Sprintf(
			"%s as day, user_id as user_id, sum(quota_data.count) as requests, sum(token_used) as tokens, sum(quota) as quota",
			bucket,
		)).
		Where("user_id > 0").
		Group(fmt.Sprintf("%s, user_id", bucket))
	if since > 0 {
		query = query.Where("created_at >= ?", since)
	}

	var rows []UserDailyMetric
	if err := query.Find(&rows).Error; err != nil {
		return nil, err
	}
	if len(rows) == 0 {
		return map[int]struct{}{}, nil
	}

	touched := make(map[int]struct{}, len(rows))
	for i := range rows {
		touched[rows[i].UserId] = struct{}{}
	}
	err := DB.Clauses(clause.OnConflict{
		Columns:   []clause.Column{{Name: "day"}, {Name: "user_id"}},
		DoUpdates: clause.AssignmentColumns([]string{"requests", "tokens", "quota"}),
	}).CreateInBatches(&rows, userMetricUpsertBatchSize).Error
	if err != nil {
		return nil, err
	}
	return touched, nil
}

func usersWithTopUpsSince(since int64) ([]int, error) {
	query := DB.Model(&TopUp{}).Where("status = ?", common.TopUpStatusSuccess)
	if since > 0 {
		query = query.Where("complete_time >= ?", since)
	}
	var userIDs []int
	err := query.Distinct().Pluck("user_id", &userIDs).Error
	return userIDs, err
}

// RefreshUserLifecycle recomputes derived lifecycle metrics. Passing nil rebuilds
// every user that has any activity or payment history.
func RefreshUserLifecycle(userIDs []int) error {
	if userIDs != nil && len(userIDs) == 0 {
		return nil
	}
	now := common.GetTimestamp()
	day30 := StartOfLocalDay(time.Now().AddDate(0, 0, -29))
	day7 := StartOfLocalDay(time.Now().AddDate(0, 0, -6))

	lifecycles := map[int]*UserLifecycle{}
	lifecycleFor := func(userID int) *UserLifecycle {
		if existing, ok := lifecycles[userID]; ok {
			return existing
		}
		created := &UserLifecycle{UserId: userID, RefreshedAt: now}
		lifecycles[userID] = created
		return created
	}

	type usageRow struct {
		UserId     int
		FirstDay   int64
		LastDay    int64
		ActiveDays int
		Requests   int64
		Quota      int64
	}
	var totals []usageRow
	if err := scopeLifecycleQuery(DB.Table("user_daily_metrics"), userIDs).
		Select("user_id as user_id, min(day) as first_day, max(day) as last_day, count(*) as active_days, sum(requests) as requests, sum(quota) as quota").
		Group("user_id").
		Find(&totals).Error; err != nil {
		return err
	}
	for _, row := range totals {
		lifecycle := lifecycleFor(row.UserId)
		lifecycle.FirstActiveAt = row.FirstDay
		lifecycle.LastActiveAt = row.LastDay
		lifecycle.ActiveDays = row.ActiveDays
		lifecycle.TotalRequests = row.Requests
		lifecycle.TotalQuotaUsed = row.Quota
	}

	var recent []usageRow
	if err := scopeLifecycleQuery(DB.Table("user_daily_metrics"), userIDs).
		Where("day >= ?", day30).
		Select("user_id as user_id, count(*) as active_days, sum(quota) as quota").
		Group("user_id").
		Find(&recent).Error; err != nil {
		return err
	}
	for _, row := range recent {
		lifecycle := lifecycleFor(row.UserId)
		lifecycle.ActiveDays30 = row.ActiveDays
		lifecycle.Quota30 = row.Quota
	}

	var week []usageRow
	if err := scopeLifecycleQuery(DB.Table("user_daily_metrics"), userIDs).
		Where("day >= ?", day7).
		Select("user_id as user_id, sum(quota) as quota").
		Group("user_id").
		Find(&week).Error; err != nil {
		return err
	}
	for _, row := range week {
		lifecycleFor(row.UserId).Quota7 = row.Quota
	}

	type paymentRow struct {
		UserId      int
		FirstPaidAt int64
		LastPaidAt  int64
		TopupCount  int
		TopupMoney  float64
		TopupAmount int64
	}
	var payments []paymentRow
	if err := scopeLifecycleQuery(DB.Table("top_ups"), userIDs).
		Where("status = ?", common.TopUpStatusSuccess).
		Select("user_id as user_id, min(complete_time) as first_paid_at, max(complete_time) as last_paid_at, count(*) as topup_count, sum(money) as topup_money, sum(amount) as topup_amount").
		Group("user_id").
		Find(&payments).Error; err != nil {
		return err
	}
	for _, row := range payments {
		lifecycle := lifecycleFor(row.UserId)
		lifecycle.FirstPaidAt = row.FirstPaidAt
		lifecycle.LastPaidAt = row.LastPaidAt
		lifecycle.TopupCount = row.TopupCount
		lifecycle.TopupMoney = row.TopupMoney
		lifecycle.TopupAmount = row.TopupAmount
	}

	if len(lifecycles) == 0 {
		return nil
	}
	rows := make([]UserLifecycle, 0, len(lifecycles))
	for _, lifecycle := range lifecycles {
		rows = append(rows, *lifecycle)
	}
	return DB.Clauses(clause.OnConflict{
		Columns: []clause.Column{{Name: "user_id"}},
		DoUpdates: clause.AssignmentColumns([]string{
			"first_active_at", "last_active_at", "active_days", "active_days_30",
			"total_requests", "total_quota_used", "quota_7", "quota_30",
			"first_paid_at", "last_paid_at", "topup_count", "topup_money", "topup_amount",
			"refreshed_at",
		}),
	}).CreateInBatches(&rows, userMetricUpsertBatchSize).Error
}

func scopeLifecycleQuery(query *gorm.DB, userIDs []int) *gorm.DB {
	if userIDs == nil {
		return query
	}
	return query.Where("user_id IN ?", userIDs)
}
