package controller

import (
	"errors"
	"strconv"
	"strings"

	"github.com/dev-fan-sophon/boxai/common"
	"github.com/dev-fan-sophon/boxai/i18n"
	"github.com/dev-fan-sophon/boxai/logger"
	"github.com/dev-fan-sophon/boxai/model"
	"github.com/dev-fan-sophon/boxai/setting/operation_setting"

	"github.com/gin-gonic/gin"
	"gorm.io/gorm"
)

type rewardCampaignRequest struct {
	Slug            string `json:"slug"`
	Name            string `json:"name"`
	Description     string `json:"description"`
	Status          *int   `json:"status"`
	Quota           int    `json:"quota"`
	StartsAt        int64  `json:"starts_at"`
	EndsAt          int64  `json:"ends_at"`
	MaxClaims       int    `json:"max_claims"`
	PerUserLimit    int    `json:"per_user_limit"`
	NewUsersOnly    bool   `json:"new_users_only"`
	RequireVerified bool   `json:"require_verified"`
}

type rewardClaimRequest struct {
	Slug string `json:"slug"`
}

type rewardRedeemRequest struct {
	Quota int `json:"quota"`
}

type rewardAdjustRequest struct {
	UserId int    `json:"user_id"`
	Delta  int    `json:"delta"`
	Note   string `json:"note"`
}

func rewardErrorKey(err error) string {
	switch {
	case errors.Is(err, model.ErrRewardDisabled):
		return i18n.MsgRewardDisabled
	case errors.Is(err, model.ErrRewardCampaignNotFound):
		return i18n.MsgRewardCampaignNotFound
	case errors.Is(err, model.ErrRewardCampaignDisabled):
		return i18n.MsgRewardCampaignDisabled
	case errors.Is(err, model.ErrRewardCampaignNotStarted):
		return i18n.MsgRewardCampaignNotStarted
	case errors.Is(err, model.ErrRewardCampaignEnded):
		return i18n.MsgRewardCampaignEnded
	case errors.Is(err, model.ErrRewardSoldOut):
		return i18n.MsgRewardSoldOut
	case errors.Is(err, model.ErrRewardAlreadyClaimed):
		return i18n.MsgRewardAlreadyClaimed
	case errors.Is(err, model.ErrRewardNewUsersOnly):
		return i18n.MsgRewardNewUsersOnly
	case errors.Is(err, model.ErrRewardVerificationRequired):
		return i18n.MsgRewardVerificationRequired
	case errors.Is(err, model.ErrRewardInvalidQuota):
		return i18n.MsgRewardInvalidQuota
	case errors.Is(err, model.ErrRewardInsufficient):
		return i18n.MsgRewardInsufficient
	case errors.Is(err, model.ErrRewardBelowMinimum):
		return i18n.MsgRewardBelowMinimum
	case errors.Is(err, model.ErrRewardQuotaOverflow):
		return i18n.MsgRewardQuotaOverflow
	case errors.Is(err, model.ErrRewardInvalidSlug):
		return i18n.MsgRewardInvalidSlug
	case errors.Is(err, model.ErrRewardSlugTaken):
		return i18n.MsgRewardSlugTaken
	case errors.Is(err, model.ErrRewardInvalidName):
		return i18n.MsgRewardInvalidName
	default:
		return ""
	}
}

func writeRewardError(c *gin.Context, err error) {
	if key := rewardErrorKey(err); key != "" {
		common.ApiErrorI18n(c, key)
		return
	}
	common.ApiError(c, err)
}

func GetPublicRewardCampaign(c *gin.Context) {
	campaign, err := model.GetRewardCampaignBySlug(c.Param("slug"))
	if err != nil {
		writeRewardError(c, err)
		return
	}
	common.ApiSuccess(c, campaign.ToPublic())
}

func GetSelfRewards(c *gin.Context) {
	userId := c.GetInt("id")
	summary, err := model.GetUserRewardSummary(userId)
	if err != nil {
		common.ApiError(c, err)
		return
	}
	pageInfo := common.GetPageQuery(c)
	ledgers, total, err := model.SearchRewardLedgers(userId, c.Query("type"), pageInfo.GetStartIdx(), pageInfo.GetPageSize())
	if err != nil {
		common.ApiError(c, err)
		return
	}
	pageInfo.SetTotal(int(total))
	pageInfo.SetItems(ledgers)
	common.ApiSuccess(c, gin.H{
		"summary": summary,
		"ledger":  pageInfo,
	})
}

func ClaimSelfReward(c *gin.Context) {
	var req rewardClaimRequest
	if err := c.ShouldBindJSON(&req); err != nil {
		common.ApiErrorI18n(c, i18n.MsgInvalidInput)
		return
	}
	claim, err := model.ClaimRewardCampaign(c.GetInt("id"), req.Slug, common.RealClientIP(c), c.Request.UserAgent())
	if err != nil {
		writeRewardError(c, err)
		return
	}
	summary, summaryErr := model.GetUserRewardSummary(c.GetInt("id"))
	if summaryErr != nil {
		common.ApiError(c, summaryErr)
		return
	}
	common.ApiSuccessI18n(c, i18n.MsgRewardClaimSuccess, gin.H{
		"claim":   claim,
		"summary": summary,
	})
}

func RedeemSelfReward(c *gin.Context) {
	var req rewardRedeemRequest
	if err := c.ShouldBindJSON(&req); err != nil {
		common.ApiErrorI18n(c, i18n.MsgInvalidInput)
		return
	}
	if err := model.RedeemRewardQuota(c.GetInt("id"), req.Quota); err != nil {
		writeRewardError(c, err)
		return
	}
	summary, err := model.GetUserRewardSummary(c.GetInt("id"))
	if err != nil {
		common.ApiError(c, err)
		return
	}
	common.ApiSuccessI18n(c, i18n.MsgRewardRedeemSuccess, summary)
}

func GetRewardCampaigns(c *gin.Context) {
	pageInfo := common.GetPageQuery(c)
	campaigns, total, err := model.SearchRewardCampaigns(c.Query("keyword"), c.Query("status"), pageInfo.GetStartIdx(), pageInfo.GetPageSize())
	if err != nil {
		common.ApiError(c, err)
		return
	}
	pageInfo.SetTotal(int(total))
	pageInfo.SetItems(campaigns)
	common.ApiSuccess(c, pageInfo)
}

func GetRewardCampaign(c *gin.Context) {
	id, err := strconv.Atoi(c.Param("id"))
	if err != nil {
		common.ApiErrorI18n(c, i18n.MsgInvalidInput)
		return
	}
	campaign, err := model.GetRewardCampaignById(id)
	if err != nil {
		writeRewardError(c, err)
		return
	}
	common.ApiSuccess(c, campaign)
}

func applyRewardCampaignRequest(campaign *model.RewardCampaign, req rewardCampaignRequest, creating bool) {
	if req.Slug != "" || creating {
		campaign.Slug = req.Slug
	}
	if req.Name != "" || creating {
		campaign.Name = req.Name
	}
	campaign.Description = req.Description
	if req.Status != nil {
		campaign.Status = *req.Status
	} else if creating {
		campaign.Status = model.RewardCampaignStatusEnabled
	}
	if req.Quota > 0 || creating {
		campaign.Quota = req.Quota
	}
	campaign.StartsAt = req.StartsAt
	campaign.EndsAt = req.EndsAt
	campaign.MaxClaims = req.MaxClaims
	if req.PerUserLimit > 0 || creating {
		campaign.PerUserLimit = req.PerUserLimit
	}
	campaign.NewUsersOnly = req.NewUsersOnly
	campaign.RequireVerified = req.RequireVerified
}

func AddRewardCampaign(c *gin.Context) {
	var req rewardCampaignRequest
	if err := c.ShouldBindJSON(&req); err != nil {
		common.ApiErrorI18n(c, i18n.MsgInvalidInput)
		return
	}
	campaign := &model.RewardCampaign{CreatedBy: c.GetInt("id")}
	applyRewardCampaignRequest(campaign, req, true)
	if err := campaign.Insert(); err != nil {
		writeRewardError(c, err)
		return
	}
	recordManageAudit(c, "reward.campaign_create", map[string]interface{}{
		"name":  campaign.Name,
		"slug":  campaign.Slug,
		"quota": logger.LogQuota(campaign.Quota),
	})
	common.ApiSuccess(c, campaign)
}

func UpdateRewardCampaign(c *gin.Context) {
	id, err := strconv.Atoi(c.Param("id"))
	if err != nil {
		common.ApiErrorI18n(c, i18n.MsgInvalidInput)
		return
	}
	campaign, err := model.GetRewardCampaignById(id)
	if err != nil {
		writeRewardError(c, err)
		return
	}
	var req rewardCampaignRequest
	if err := c.ShouldBindJSON(&req); err != nil {
		common.ApiErrorI18n(c, i18n.MsgInvalidInput)
		return
	}
	applyRewardCampaignRequest(campaign, req, false)
	if err := campaign.Update(); err != nil {
		writeRewardError(c, err)
		return
	}
	recordManageAudit(c, "reward.campaign_update", map[string]interface{}{
		"id":    campaign.Id,
		"name":  campaign.Name,
		"slug":  campaign.Slug,
		"quota": logger.LogQuota(campaign.Quota),
	})
	common.ApiSuccess(c, campaign)
}

func GetRewardClaims(c *gin.Context) {
	pageInfo := common.GetPageQuery(c)
	userId, _ := strconv.Atoi(c.Query("user_id"))
	campaignId, _ := strconv.Atoi(c.Query("campaign_id"))
	claims, total, err := model.SearchRewardClaims(userId, campaignId, pageInfo.GetStartIdx(), pageInfo.GetPageSize())
	if err != nil {
		common.ApiError(c, err)
		return
	}
	pageInfo.SetTotal(int(total))
	pageInfo.SetItems(claims)
	common.ApiSuccess(c, pageInfo)
}

func GetRewardLedgers(c *gin.Context) {
	pageInfo := common.GetPageQuery(c)
	userId, _ := strconv.Atoi(c.Query("user_id"))
	ledgers, total, err := model.SearchRewardLedgers(userId, c.Query("type"), pageInfo.GetStartIdx(), pageInfo.GetPageSize())
	if err != nil {
		common.ApiError(c, err)
		return
	}
	pageInfo.SetTotal(int(total))
	pageInfo.SetItems(ledgers)
	common.ApiSuccess(c, pageInfo)
}

func AdjustRewardQuota(c *gin.Context) {
	var req rewardAdjustRequest
	if err := c.ShouldBindJSON(&req); err != nil {
		common.ApiErrorI18n(c, i18n.MsgInvalidInput)
		return
	}
	if req.UserId <= 0 || req.Delta == 0 {
		common.ApiErrorI18n(c, i18n.MsgRewardInvalidQuota)
		return
	}
	if _, err := model.GetUserById(req.UserId, false); err != nil {
		if errors.Is(err, gorm.ErrRecordNotFound) {
			common.ApiErrorI18n(c, i18n.MsgNotFound)
			return
		}
		common.ApiError(c, err)
		return
	}
	if err := model.AdjustRewardQuota(req.UserId, req.Delta, strings.TrimSpace(req.Note)); err != nil {
		writeRewardError(c, err)
		return
	}
	summary, err := model.GetUserRewardSummary(req.UserId)
	if err != nil {
		common.ApiError(c, err)
		return
	}
	recordManageAudit(c, "reward.adjust", map[string]interface{}{
		"user_id": req.UserId,
		"delta":   logger.LogQuota(req.Delta),
		"note":    req.Note,
	})
	common.ApiSuccess(c, summary)
}
