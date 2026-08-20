package model

import (
	"errors"
	"fmt"
	"strings"
	"unicode"
	"unicode/utf8"

	"github.com/dev-fan-sophon/boxai/common"
	"github.com/dev-fan-sophon/boxai/logger"
	"github.com/dev-fan-sophon/boxai/setting/operation_setting"

	"gorm.io/gorm"
)

const (
	RewardCampaignStatusDisabled = 0
	RewardCampaignStatusEnabled  = 1

	RewardLedgerTypeClaim  = "claim"
	RewardLedgerTypeRedeem = "redeem"
	RewardLedgerTypeExpire = "expire"
	RewardLedgerTypeAdjust = "adjust"

	RewardSlugMinLen = 2
	RewardSlugMaxLen = 48
	RewardNameMaxLen = 80
	RewardDescMaxLen = 500
)

var (
	ErrRewardDisabled             = errors.New("rewards are disabled")
	ErrRewardCampaignNotFound     = errors.New("reward campaign not found")
	ErrRewardCampaignDisabled     = errors.New("reward campaign is disabled")
	ErrRewardCampaignNotStarted   = errors.New("reward campaign has not started")
	ErrRewardCampaignEnded        = errors.New("reward campaign has ended")
	ErrRewardSoldOut              = errors.New("reward campaign has no remaining claims")
	ErrRewardAlreadyClaimed       = errors.New("reward already claimed")
	ErrRewardNewUsersOnly         = errors.New("reward is only available to new users")
	ErrRewardVerificationRequired = errors.New("verified email is required to claim this reward")
	ErrRewardInvalidQuota         = errors.New("invalid reward quota")
	ErrRewardInsufficient         = errors.New("insufficient reward balance")
	ErrRewardBelowMinimum         = errors.New("reward amount is below the minimum")
	ErrRewardQuotaOverflow        = errors.New("transfer would exceed the stored quota limit")
	ErrRewardInvalidSlug          = errors.New("invalid reward campaign slug")
	ErrRewardSlugTaken            = errors.New("reward campaign slug already exists")
	ErrRewardInvalidName          = errors.New("invalid reward campaign name")
)

type RewardCampaign struct {
	Id              int    `json:"id"`
	Slug            string `json:"slug" gorm:"type:varchar(64);uniqueIndex;not null"`
	Name            string `json:"name" gorm:"type:varchar(80);index;not null"`
	Description     string `json:"description" gorm:"type:varchar(500)"`
	Status          int    `json:"status" gorm:"default:1;index"`
	Quota           int    `json:"quota"`
	StartsAt        int64  `json:"starts_at" gorm:"bigint;default:0"`
	EndsAt          int64  `json:"ends_at" gorm:"bigint;default:0"`
	MaxClaims       int    `json:"max_claims" gorm:"default:0"`
	ClaimedCount    int    `json:"claimed_count" gorm:"default:0"`
	PerUserLimit    int    `json:"per_user_limit" gorm:"default:1"`
	NewUsersOnly    bool   `json:"new_users_only"`
	RequireVerified bool   `json:"require_verified"`
	CreatedBy       int    `json:"created_by"`
	CreatedTime     int64  `json:"created_time" gorm:"bigint"`
	UpdatedTime     int64  `json:"updated_time" gorm:"bigint"`
}

func (RewardCampaign) TableName() string {
	return "reward_campaigns"
}

type RewardClaim struct {
	Id          int    `json:"id"`
	CampaignId  int    `json:"campaign_id" gorm:"uniqueIndex:idx_reward_claim_campaign_user;index"`
	UserId      int    `json:"user_id" gorm:"uniqueIndex:idx_reward_claim_campaign_user;index"`
	Quota       int    `json:"quota"`
	ClaimedTime int64  `json:"claimed_time" gorm:"bigint"`
	ClientIP    string `json:"client_ip" gorm:"type:varchar(64);column:client_ip"`
	UserAgent   string `json:"user_agent" gorm:"type:varchar(255)"`
}

func (RewardClaim) TableName() string {
	return "reward_claims"
}

type RewardLedger struct {
	Id           int    `json:"id"`
	UserId       int    `json:"user_id" gorm:"index"`
	Delta        int    `json:"delta"`
	BalanceAfter int    `json:"balance_after"`
	Type         string `json:"type" gorm:"type:varchar(16);index"`
	RefType      string `json:"ref_type" gorm:"type:varchar(32)"`
	RefId        int    `json:"ref_id"`
	Note         string `json:"note" gorm:"type:varchar(255)"`
	CreatedTime  int64  `json:"created_time" gorm:"bigint;index"`
}

func (RewardLedger) TableName() string {
	return "reward_ledgers"
}

type RewardPublicCampaign struct {
	Slug            string `json:"slug"`
	Name            string `json:"name"`
	Description     string `json:"description"`
	Quota           int    `json:"quota"`
	Status          string `json:"status"`
	StartsAt        int64  `json:"starts_at"`
	EndsAt          int64  `json:"ends_at"`
	RemainingClaims *int   `json:"remaining_claims,omitempty"`
	NewUsersOnly    bool   `json:"new_users_only"`
	RequireVerified bool   `json:"require_verified"`
	Enabled         bool   `json:"enabled"`
}

type RewardSummary struct {
	RewardQuota    int  `json:"reward_quota"`
	RewardHistory  int  `json:"reward_history"`
	MinRedeemQuota int  `json:"min_redeem_quota"`
	Enabled        bool `json:"enabled"`
}

func NormalizeRewardSlug(raw string) (string, error) {
	slug := strings.ToLower(strings.TrimSpace(raw))
	if slug == "" {
		return "", ErrRewardInvalidSlug
	}
	if utf8.RuneCountInString(slug) < RewardSlugMinLen || utf8.RuneCountInString(slug) > RewardSlugMaxLen {
		return "", ErrRewardInvalidSlug
	}
	for _, r := range slug {
		if unicode.IsLetter(r) || unicode.IsDigit(r) || r == '-' || r == '_' {
			continue
		}
		return "", ErrRewardInvalidSlug
	}
	return slug, nil
}

func (campaign *RewardCampaign) Normalize() error {
	slug, err := NormalizeRewardSlug(campaign.Slug)
	if err != nil {
		return err
	}
	campaign.Slug = slug
	campaign.Name = strings.TrimSpace(campaign.Name)
	if campaign.Name == "" || utf8.RuneCountInString(campaign.Name) > RewardNameMaxLen {
		return ErrRewardInvalidName
	}
	campaign.Description = strings.TrimSpace(campaign.Description)
	if utf8.RuneCountInString(campaign.Description) > RewardDescMaxLen {
		return fmt.Errorf("description is too long")
	}
	if campaign.Quota <= 0 || campaign.Quota > common.MaxQuota {
		return ErrRewardInvalidQuota
	}
	if campaign.MaxClaims < 0 {
		campaign.MaxClaims = 0
	}
	if campaign.PerUserLimit <= 0 {
		if limit := operation_setting.GetRewardSetting().DefaultPerUserLimit; limit > 0 {
			campaign.PerUserLimit = limit
		} else {
			campaign.PerUserLimit = 1
		}
	}
	if campaign.Status != RewardCampaignStatusDisabled {
		campaign.Status = RewardCampaignStatusEnabled
	}
	if campaign.StartsAt < 0 {
		campaign.StartsAt = 0
	}
	if campaign.EndsAt < 0 {
		campaign.EndsAt = 0
	}
	if campaign.EndsAt > 0 && campaign.StartsAt > 0 && campaign.EndsAt < campaign.StartsAt {
		return errors.New("end time must be after start time")
	}
	return nil
}

func (campaign *RewardCampaign) remainingClaims() *int {
	if campaign.MaxClaims <= 0 {
		return nil
	}
	remaining := campaign.MaxClaims - campaign.ClaimedCount
	if remaining < 0 {
		remaining = 0
	}
	return &remaining
}

func (campaign *RewardCampaign) publicStatus(now int64) string {
	if !operation_setting.IsRewardEnabled() || campaign.Status != RewardCampaignStatusEnabled {
		return "disabled"
	}
	if campaign.StartsAt > 0 && now < campaign.StartsAt {
		return "scheduled"
	}
	if campaign.EndsAt > 0 && now >= campaign.EndsAt {
		return "ended"
	}
	if remaining := campaign.remainingClaims(); remaining != nil && *remaining <= 0 {
		return "sold_out"
	}
	return "active"
}

func (campaign *RewardCampaign) ToPublic() RewardPublicCampaign {
	now := common.GetTimestamp()
	return RewardPublicCampaign{
		Slug:            campaign.Slug,
		Name:            campaign.Name,
		Description:     campaign.Description,
		Quota:           campaign.Quota,
		Status:          campaign.publicStatus(now),
		StartsAt:        campaign.StartsAt,
		EndsAt:          campaign.EndsAt,
		RemainingClaims: campaign.remainingClaims(),
		NewUsersOnly:    campaign.NewUsersOnly,
		RequireVerified: campaign.RequireVerified || operation_setting.GetRewardSetting().RequireVerified,
		Enabled:         operation_setting.IsRewardEnabled(),
	}
}

func GetRewardCampaignBySlug(slug string) (*RewardCampaign, error) {
	normalized, err := NormalizeRewardSlug(slug)
	if err != nil {
		return nil, err
	}
	campaign := &RewardCampaign{}
	if err := DB.Where("slug = ?", normalized).First(campaign).Error; err != nil {
		if errors.Is(err, gorm.ErrRecordNotFound) {
			return nil, ErrRewardCampaignNotFound
		}
		return nil, err
	}
	return campaign, nil
}

func GetRewardCampaignById(id int) (*RewardCampaign, error) {
	if id <= 0 {
		return nil, ErrRewardCampaignNotFound
	}
	campaign := &RewardCampaign{}
	if err := DB.First(campaign, id).Error; err != nil {
		if errors.Is(err, gorm.ErrRecordNotFound) {
			return nil, ErrRewardCampaignNotFound
		}
		return nil, err
	}
	return campaign, nil
}

func SearchRewardCampaigns(keyword string, status string, startIdx int, num int) ([]*RewardCampaign, int64, error) {
	query := DB.Model(&RewardCampaign{})
	if keyword != "" {
		like := keyword + "%"
		query = query.Where("slug LIKE ? OR name LIKE ?", like, like)
	}
	now := common.GetTimestamp()
	switch status {
	case "enabled":
		query = query.Where("status = ?", RewardCampaignStatusEnabled)
	case "disabled":
		query = query.Where("status = ?", RewardCampaignStatusDisabled)
	case "scheduled":
		query = query.Where("status = ? AND starts_at > ?", RewardCampaignStatusEnabled, now)
	case "ended":
		query = query.Where("status = ? AND ends_at != 0 AND ends_at < ?", RewardCampaignStatusEnabled, now)
	case "sold_out":
		query = query.Where("status = ? AND max_claims > 0 AND claimed_count >= max_claims", RewardCampaignStatusEnabled)
	}

	var total int64
	if err := query.Count(&total).Error; err != nil {
		return nil, 0, err
	}
	var campaigns []*RewardCampaign
	if err := query.Order("id desc").Limit(num).Offset(startIdx).Find(&campaigns).Error; err != nil {
		return nil, 0, err
	}
	return campaigns, total, nil
}

func SearchRewardClaims(userId int, campaignId int, startIdx int, num int) ([]*RewardClaim, int64, error) {
	query := DB.Model(&RewardClaim{})
	if userId > 0 {
		query = query.Where("user_id = ?", userId)
	}
	if campaignId > 0 {
		query = query.Where("campaign_id = ?", campaignId)
	}
	var total int64
	if err := query.Count(&total).Error; err != nil {
		return nil, 0, err
	}
	var claims []*RewardClaim
	if err := query.Order("id desc").Limit(num).Offset(startIdx).Find(&claims).Error; err != nil {
		return nil, 0, err
	}
	return claims, total, nil
}

func SearchRewardLedgers(userId int, entryType string, startIdx int, num int) ([]*RewardLedger, int64, error) {
	query := DB.Model(&RewardLedger{})
	if userId > 0 {
		query = query.Where("user_id = ?", userId)
	}
	if entryType != "" {
		query = query.Where("type = ?", entryType)
	}
	var total int64
	if err := query.Count(&total).Error; err != nil {
		return nil, 0, err
	}
	var entries []*RewardLedger
	if err := query.Order("id desc").Limit(num).Offset(startIdx).Find(&entries).Error; err != nil {
		return nil, 0, err
	}
	return entries, total, nil
}

func GetUserRewardSummary(userId int) (RewardSummary, error) {
	var user User
	if err := DB.Select("id", "reward_quota", "reward_history").First(&user, userId).Error; err != nil {
		return RewardSummary{}, err
	}
	return RewardSummary{
		RewardQuota:    user.RewardQuota,
		RewardHistory:  user.RewardHistory,
		MinRedeemQuota: effectiveMinRedeemQuota(),
		Enabled:        operation_setting.IsRewardEnabled(),
	}, nil
}

func effectiveMinRedeemQuota() int {
	if min := operation_setting.RewardMinRedeemQuota(); min > 0 {
		return min
	}
	unit := common.QuotaFromFloat(common.QuotaPerUnit)
	if unit <= 0 {
		return 1
	}
	return unit
}

func (campaign *RewardCampaign) Insert() error {
	if err := campaign.Normalize(); err != nil {
		return err
	}
	now := common.GetTimestamp()
	if campaign.CreatedTime == 0 {
		campaign.CreatedTime = now
	}
	campaign.UpdatedTime = now
	if err := DB.Create(campaign).Error; err != nil {
		if isUniqueConstraintError(err) {
			return ErrRewardSlugTaken
		}
		return err
	}
	return nil
}

func (campaign *RewardCampaign) Update() error {
	if err := campaign.Normalize(); err != nil {
		return err
	}
	campaign.UpdatedTime = common.GetTimestamp()
	result := DB.Model(&RewardCampaign{}).Where("id = ?", campaign.Id).Updates(map[string]interface{}{
		"slug":             campaign.Slug,
		"name":             campaign.Name,
		"description":      campaign.Description,
		"status":           campaign.Status,
		"quota":            campaign.Quota,
		"starts_at":        campaign.StartsAt,
		"ends_at":          campaign.EndsAt,
		"max_claims":       campaign.MaxClaims,
		"per_user_limit":   campaign.PerUserLimit,
		"new_users_only":   campaign.NewUsersOnly,
		"require_verified": campaign.RequireVerified,
		"updated_time":     campaign.UpdatedTime,
	})
	if result.Error != nil {
		if isUniqueConstraintError(result.Error) {
			return ErrRewardSlugTaken
		}
		return result.Error
	}
	if result.RowsAffected == 0 {
		return ErrRewardCampaignNotFound
	}
	return nil
}

func ClaimRewardCampaign(userId int, slug string, clientIP string, userAgent string) (*RewardClaim, error) {
	if !operation_setting.IsRewardEnabled() {
		return nil, ErrRewardDisabled
	}
	normalized, err := NormalizeRewardSlug(slug)
	if err != nil {
		return nil, err
	}
	if userId <= 0 {
		return nil, errors.New("invalid user id")
	}

	var claim *RewardClaim
	err = DB.Transaction(func(tx *gorm.DB) error {
		campaign := &RewardCampaign{}
		if err := lockForUpdate(tx).Where("slug = ?", normalized).First(campaign).Error; err != nil {
			if errors.Is(err, gorm.ErrRecordNotFound) {
				return ErrRewardCampaignNotFound
			}
			return err
		}
		now := common.GetTimestamp()
		if campaign.Status != RewardCampaignStatusEnabled {
			return ErrRewardCampaignDisabled
		}
		if campaign.StartsAt > 0 && now < campaign.StartsAt {
			return ErrRewardCampaignNotStarted
		}
		if campaign.EndsAt > 0 && now >= campaign.EndsAt {
			return ErrRewardCampaignEnded
		}
		if campaign.Quota <= 0 || campaign.Quota > common.MaxQuota {
			return ErrRewardInvalidQuota
		}

		user := &User{}
		if err := lockForUpdate(tx).Select("id", "email", "created_at", "reward_quota", "reward_history", "quota").First(user, userId).Error; err != nil {
			return err
		}
		if campaign.RequireVerified || operation_setting.GetRewardSetting().RequireVerified {
			if strings.TrimSpace(user.Email) == "" {
				return ErrRewardVerificationRequired
			}
		}
		if campaign.NewUsersOnly && campaign.CreatedTime > 0 && user.CreatedAt > 0 && user.CreatedAt < campaign.CreatedTime {
			return ErrRewardNewUsersOnly
		}

		var existing int64
		if err := tx.Model(&RewardClaim{}).Where("campaign_id = ? AND user_id = ?", campaign.Id, userId).Count(&existing).Error; err != nil {
			return err
		}
		limit := campaign.PerUserLimit
		if limit <= 0 {
			limit = 1
		}
		if existing >= int64(limit) {
			return ErrRewardAlreadyClaimed
		}

		if campaign.MaxClaims > 0 {
			result := tx.Model(&RewardCampaign{}).
				Where("id = ? AND (max_claims = 0 OR claimed_count < max_claims)", campaign.Id).
				Update("claimed_count", gorm.Expr("claimed_count + ?", 1))
			if result.Error != nil {
				return result.Error
			}
			if result.RowsAffected == 0 {
				return ErrRewardSoldOut
			}
		} else {
			if err := tx.Model(&RewardCampaign{}).Where("id = ?", campaign.Id).
				Update("claimed_count", gorm.Expr("claimed_count + ?", 1)).Error; err != nil {
				return err
			}
		}

		nextReward := user.RewardQuota + campaign.Quota
		if nextReward < user.RewardQuota || nextReward > common.MaxQuota {
			return ErrRewardQuotaOverflow
		}
		nextHistory := user.RewardHistory + campaign.Quota
		if nextHistory < user.RewardHistory || nextHistory > common.MaxQuota {
			return ErrRewardQuotaOverflow
		}

		claim = &RewardClaim{
			CampaignId:  campaign.Id,
			UserId:      userId,
			Quota:       campaign.Quota,
			ClaimedTime: now,
			ClientIP:    truncateRewardMeta(clientIP, 64),
			UserAgent:   truncateRewardMeta(userAgent, 255),
		}
		if err := tx.Create(claim).Error; err != nil {
			if isUniqueConstraintError(err) {
				return ErrRewardAlreadyClaimed
			}
			return err
		}

		result := tx.Model(&User{}).
			Where("id = ? AND reward_quota <= ?", userId, common.MaxQuota-campaign.Quota).
			Updates(map[string]interface{}{
				"reward_quota":   gorm.Expr("reward_quota + ?", campaign.Quota),
				"reward_history": gorm.Expr("reward_history + ?", campaign.Quota),
			})
		if result.Error != nil {
			return result.Error
		}
		if result.RowsAffected == 0 {
			return ErrRewardQuotaOverflow
		}

		return tx.Create(&RewardLedger{
			UserId:       userId,
			Delta:        campaign.Quota,
			BalanceAfter: nextReward,
			Type:         RewardLedgerTypeClaim,
			RefType:      "campaign",
			RefId:        campaign.Id,
			Note:         campaign.Slug,
			CreatedTime:  now,
		}).Error
	})
	if err != nil {
		return nil, err
	}
	if cacheErr := invalidateUserCache(userId); cacheErr != nil {
		common.SysLog("failed to invalidate user cache after reward claim: " + cacheErr.Error())
	}
	RecordLog(userId, LogTypeSystem, fmt.Sprintf("领取奖励 %s，活动 %s", logger.LogQuota(claim.Quota), slug))
	return claim, nil
}

func RedeemRewardQuota(userId int, quota int) error {
	if !operation_setting.IsRewardEnabled() {
		return ErrRewardDisabled
	}
	if userId <= 0 {
		return errors.New("invalid user id")
	}
	minQuota := effectiveMinRedeemQuota()
	if quota < minQuota || quota > common.MaxQuota {
		return ErrRewardBelowMinimum
	}

	err := DB.Transaction(func(tx *gorm.DB) error {
		user := &User{}
		if err := lockForUpdate(tx).Select("id", "quota", "reward_quota").First(user, userId).Error; err != nil {
			return err
		}
		if user.RewardQuota < quota {
			return ErrRewardInsufficient
		}
		if user.Quota > common.MaxQuota-quota {
			return ErrRewardQuotaOverflow
		}

		result := tx.Model(&User{}).
			Where("id = ? AND reward_quota >= ? AND quota <= ?", userId, quota, common.MaxQuota-quota).
			Updates(map[string]interface{}{
				"reward_quota": gorm.Expr("reward_quota - ?", quota),
				"quota":        gorm.Expr("quota + ?", quota),
			})
		if result.Error != nil {
			return result.Error
		}
		if result.RowsAffected == 0 {
			return ErrRewardInsufficient
		}

		return tx.Create(&RewardLedger{
			UserId:       userId,
			Delta:        -quota,
			BalanceAfter: user.RewardQuota - quota,
			Type:         RewardLedgerTypeRedeem,
			RefType:      "wallet",
			RefId:        userId,
			Note:         "redeem",
			CreatedTime:  common.GetTimestamp(),
		}).Error
	})
	if err != nil {
		return err
	}
	if cacheErr := invalidateUserCache(userId); cacheErr != nil {
		common.SysLog("failed to invalidate user cache after reward redeem: " + cacheErr.Error())
	}
	RecordLog(userId, LogTypeTopup, fmt.Sprintf("兑换奖励额度 %s", logger.LogQuota(quota)))
	return nil
}

func AdjustRewardQuota(userId int, delta int, note string) error {
	if userId <= 0 || delta == 0 {
		return ErrRewardInvalidQuota
	}
	if delta > common.MaxQuota || delta < -common.MaxQuota {
		return ErrRewardInvalidQuota
	}

	err := DB.Transaction(func(tx *gorm.DB) error {
		user := &User{}
		if err := lockForUpdate(tx).Select("id", "reward_quota", "reward_history").First(user, userId).Error; err != nil {
			return err
		}
		next := user.RewardQuota + delta
		if next < 0 {
			return ErrRewardInsufficient
		}
		if next > common.MaxQuota {
			return ErrRewardQuotaOverflow
		}
		updates := map[string]interface{}{
			"reward_quota": gorm.Expr("reward_quota + ?", delta),
		}
		if delta > 0 {
			if user.RewardHistory > common.MaxQuota-delta {
				return ErrRewardQuotaOverflow
			}
			updates["reward_history"] = gorm.Expr("reward_history + ?", delta)
		}
		result := tx.Model(&User{}).Where("id = ?", userId).Updates(updates)
		if result.Error != nil {
			return result.Error
		}
		if result.RowsAffected == 0 {
			return gorm.ErrRecordNotFound
		}
		return tx.Create(&RewardLedger{
			UserId:       userId,
			Delta:        delta,
			BalanceAfter: next,
			Type:         RewardLedgerTypeAdjust,
			RefType:      "admin",
			RefId:        0,
			Note:         truncateRewardMeta(note, 255),
			CreatedTime:  common.GetTimestamp(),
		}).Error
	})
	if err != nil {
		return err
	}
	if cacheErr := invalidateUserCache(userId); cacheErr != nil {
		common.SysLog("failed to invalidate user cache after reward adjust: " + cacheErr.Error())
	}
	return nil
}

func truncateRewardMeta(value string, max int) string {
	value = strings.TrimSpace(value)
	if max <= 0 || len(value) <= max {
		return value
	}
	return value[:max]
}

func isUniqueConstraintError(err error) bool {
	if err == nil {
		return false
	}
	msg := strings.ToLower(err.Error())
	return strings.Contains(msg, "unique") || strings.Contains(msg, "duplicate")
}
