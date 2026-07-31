package model

import (
	"time"

	"github.com/dev-fan-sophon/boxai/common"
)

// UserProfileModelUsage is one row of a user's model preference breakdown.
type UserProfileModelUsage struct {
	ModelName string `json:"model_name"`
	Requests  int64  `json:"requests"`
	Tokens    int64  `json:"tokens"`
	Quota     int64  `json:"quota"`
}

// UserProfileRef is the minimal identity of a related user (inviter, invitee).
type UserProfileRef struct {
	Id       int    `json:"id"`
	Username string `json:"username"`
	Email    string `json:"email"`
}

// UserProfile is the aggregated 360-degree view of a single customer that the
// operations console renders in the detail drawer.
type UserProfile struct {
	User          *User                   `json:"user"`
	Lifecycle     *UserLifecycle          `json:"lifecycle"`
	Tags          []string                `json:"tags"`
	Inviter       *UserProfileRef         `json:"inviter"`
	Invitees      []UserProfileRef        `json:"invitees"`
	InviteeCount  int64                   `json:"invitee_count"`
	DailyMetrics  []UserDailyMetric       `json:"daily_metrics"`
	TopUps        []TopUp                 `json:"top_ups"`
	Subscriptions []UserSubscription      `json:"subscriptions"`
	TopModels     []UserProfileModelUsage `json:"top_models"`
	TokenCount    int64                   `json:"token_count"`
	CheckinCount  int64                   `json:"checkin_count"`
	LoginEvents   []*Log                  `json:"login_events"`
	AuditEvents   []*Log                  `json:"audit_events"`
}

const (
	profileTrendDays     = 30
	profileListLimit     = 10
	profileTopModelLimit = 8
)

// GetUserProfile assembles the detail view for one user. Every query targets the
// main database except the log lookups, which intentionally stay unjoined
// because the log database may be a separate server or ClickHouse.
func GetUserProfile(userID int) (*UserProfile, error) {
	user, err := GetUserById(userID, false)
	if err != nil {
		return nil, err
	}
	user.Password = ""

	profile := &UserProfile{User: user, Tags: []string{}}

	lifecycle := &UserLifecycle{}
	if err := DB.Where("user_id = ?", userID).First(lifecycle).Error; err == nil {
		profile.Lifecycle = lifecycle
	}

	var tags []UserTag
	if err := DB.Where("user_id = ?", userID).Order("tag ASC").Find(&tags).Error; err != nil {
		return nil, err
	}
	for _, tag := range tags {
		profile.Tags = append(profile.Tags, tag.Tag)
	}

	if user.InviterId > 0 {
		inviter := &UserProfileRef{}
		if err := DB.Table("users").
			Select("id, username, email").
			Where("id = ?", user.InviterId).
			Scan(inviter).Error; err == nil && inviter.Id > 0 {
			profile.Inviter = inviter
		}
	}
	if err := DB.Model(&User{}).Where("inviter_id = ?", userID).Count(&profile.InviteeCount).Error; err != nil {
		return nil, err
	}
	if err := DB.Table("users").
		Select("id, username, email").
		Where("inviter_id = ? AND deleted_at IS NULL", userID).
		Order("id DESC").
		Limit(profileListLimit).
		Scan(&profile.Invitees).Error; err != nil {
		return nil, err
	}

	since := StartOfLocalDay(time.Now().AddDate(0, 0, -(profileTrendDays - 1)))
	if err := DB.Where("user_id = ? AND day >= ?", userID, since).
		Order("day ASC").
		Find(&profile.DailyMetrics).Error; err != nil {
		return nil, err
	}

	if err := DB.Where("user_id = ?", userID).
		Order("id DESC").
		Limit(profileListLimit).
		Find(&profile.TopUps).Error; err != nil {
		return nil, err
	}
	if err := DB.Where("user_id = ?", userID).
		Order("id DESC").
		Limit(profileListLimit).
		Find(&profile.Subscriptions).Error; err != nil {
		return nil, err
	}
	if err := DB.Model(&Token{}).Where("user_id = ?", userID).Count(&profile.TokenCount).Error; err != nil {
		return nil, err
	}
	if err := DB.Model(&Checkin{}).Where("user_id = ?", userID).Count(&profile.CheckinCount).Error; err != nil {
		return nil, err
	}

	if err := DB.Table("quota_data").
		Select("model_name as model_name, sum(quota_data.count) as requests, sum(token_used) as tokens, sum(quota) as quota").
		Where("user_id = ? AND model_name <> ''", userID).
		Group("model_name").
		Order("quota DESC").
		Limit(profileTopModelLimit).
		Find(&profile.TopModels).Error; err != nil {
		return nil, err
	}

	profile.LoginEvents = recentUserLogEvents(userID, LogTypeLogin)
	profile.AuditEvents = recentUserLogEvents(userID, LogTypeManage)
	return profile, nil
}

// recentUserLogEvents reads the newest log rows of one type. Log lookups are
// best-effort: the log database can be offline or remote, and that must not fail
// the whole profile.
func recentUserLogEvents(userID int, logType int) []*Log {
	var logs []*Log
	err := LOG_DB.Model(&Log{}).
		Where("user_id = ? AND type = ?", userID, logType).
		Order("created_at DESC").
		Limit(profileListLimit).
		Find(&logs).Error
	if err != nil {
		common.SysError("failed to load user log events: " + err.Error())
		return nil
	}
	return logs
}
