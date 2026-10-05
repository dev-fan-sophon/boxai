package controller

import (
	"errors"
	"fmt"
	"net/http"
	"strconv"
	"strings"
	"time"

	"github.com/dev-fan-sophon/boxai/common"
	"github.com/dev-fan-sophon/boxai/model"
	"github.com/dev-fan-sophon/boxai/setting/operation_setting"
	"github.com/gin-gonic/gin"
)

const trialVerificationPurpose = "trial"

func trialGrantView(g *model.TrialGrant) any {
	if g == nil {
		return nil
	}
	models := []string{}
	_ = common.UnmarshalJsonStr(g.Models, &models)
	return gin.H{"status": g.Status, "total": g.Total, "remaining": g.Remaining, "reserved": g.Reserved, "used": g.Used, "expires_at": g.ExpiresAt, "models": models}
}

func GetSelfTrial(c *gin.Context) {
	user, err := model.GetUserById(c.GetInt("id"), true)
	if err != nil {
		common.ApiError(c, err)
		return
	}
	grant, err := model.GetTrialGrant(user.Id)
	if err != nil {
		common.ApiError(c, err)
		return
	}
	p := operation_setting.GetRegistrationRiskPolicy()
	enabled := p.Enabled && p.TrialEnabled
	c.JSON(http.StatusOK, gin.H{"success": true, "data": gin.H{
		"enabled": enabled, "eligible": enabled && user.CreatedAt >= p.TrialEligibleAfter,
		"email": user.Email, "grant": trialGrantView(grant), "max_output_tokens": p.TrialMaxOutputTokens,
	}})
}

func SendTrialVerification(c *gin.Context) {
	user, err := model.GetUserById(c.GetInt("id"), true)
	if err != nil {
		common.ApiError(c, err)
		return
	}
	p := operation_setting.GetRegistrationRiskPolicy()
	if !p.Enabled || !p.TrialEnabled || user.CreatedAt < p.TrialEligibleAfter || common.Validate.Var(user.Email, "required,email") != nil {
		common.ApiError(c, errors.New("Trial credit is unavailable for this account."))
		return
	}
	if err := model.CheckRegistrationEmail(user.Email); err != nil {
		common.ApiError(c, err)
		return
	}
	code := common.GenerateVerificationCode(6)
	key := strconv.Itoa(user.Id) + ":" + model.NormalizeEmail(user.Email)
	if err := common.RegisterVerificationCodeWithKey(key, code, trialVerificationPurpose); err != nil {
		common.ApiError(c, err)
		return
	}
	if err := common.SendEmail("BoxAI — Trial credit verification", user.Email, fmt.Sprintf("<p>Mã xác minh / Verification code: <strong>%s</strong></p><p>Hết hạn sau 10 phút / Expires in 10 minutes.</p>", code)); err != nil {
		common.ApiError(c, errors.New("Unable to send verification email. Please try again later."))
		return
	}
	c.JSON(http.StatusOK, gin.H{"success": true})
}

func RequestSelfTrial(c *gin.Context) {
	var req struct {
		Code string `json:"code"`
	}
	if common.DecodeJson(c.Request.Body, &req) != nil || len(req.Code) != 6 {
		common.ApiError(c, errors.New("Invalid verification code."))
		return
	}
	user, err := model.GetUserById(c.GetInt("id"), true)
	if err != nil {
		common.ApiError(c, err)
		return
	}
	key := strconv.Itoa(user.Id) + ":" + model.NormalizeEmail(user.Email)
	if !common.VerifyCodeWithKey(key, strings.ToLower(req.Code), trialVerificationPurpose) {
		common.ApiError(c, errors.New("Invalid or expired verification code."))
		return
	}
	grant, err := model.RequestTrial(user.Id, user.Email, common.RealClientIP(c))
	if err != nil {
		common.ApiError(c, errors.New("Trial credit request could not be accepted. Please contact support."))
		return
	}
	c.JSON(http.StatusOK, gin.H{"success": true, "data": trialGrantView(grant)})
}

func ListTrialReviews(c *gin.Context) {
	page := common.GetPageQuery(c)
	var grants []model.TrialGrant
	q := model.DB.Model(&model.TrialGrant{})
	if status := c.Query("status"); status != "" {
		q = q.Where("status = ?", status)
	}
	var total int64
	if err := q.Count(&total).Error; err != nil {
		common.ApiError(c, err)
		return
	}
	if err := q.Order("id DESC").Limit(page.GetPageSize()).Offset(page.GetStartIdx()).Find(&grants).Error; err != nil {
		common.ApiError(c, err)
		return
	}
	c.JSON(http.StatusOK, gin.H{"success": true, "data": gin.H{"items": grants, "total": total}})
}

func ReviewTrial(c *gin.Context) {
	userID, err := strconv.Atoi(c.Param("id"))
	var req struct {
		Approve *bool  `json:"approve"`
		Reason  string `json:"reason"`
	}
	if err != nil || userID <= 0 || common.DecodeJson(c.Request.Body, &req) != nil || req.Approve == nil || len(req.Reason) > 1000 || strings.TrimSpace(req.Reason) == "" {
		common.ApiError(c, errors.New("A decision and review reason are required."))
		return
	}
	grant, err := model.ReviewTrial(userID, c.GetInt("id"), *req.Approve, req.Reason)
	if err != nil {
		common.ApiError(c, err)
		return
	}
	recordManageAuditFor(c, userID, "trial.review", map[string]interface{}{"approved": *req.Approve, "reason": req.Reason, "grant_id": grant.ID})
	c.JSON(http.StatusOK, gin.H{"success": true, "data": grant})
}

// Pending reservations are not automatically refunded on a timeout: an
// upstream may already have completed and charged for the request.
func ListTrialReservations(c *gin.Context) {
	page := common.GetPageQuery(c)
	var items []model.TrialReservation
	q := model.DB.Model(&model.TrialReservation{})
	if state := c.Query("state"); state != "" {
		q = q.Where("state = ?", state)
	}
	if userID, err := strconv.Atoi(c.Query("user_id")); err == nil && userID > 0 {
		q = q.Where("user_id = ?", userID)
	}
	var total int64
	if err := q.Count(&total).Error; err != nil {
		common.ApiError(c, err)
		return
	}
	if err := q.Order("created_at DESC").Limit(page.GetPageSize()).Offset(page.GetStartIdx()).Find(&items).Error; err != nil {
		common.ApiError(c, err)
		return
	}
	c.JSON(http.StatusOK, gin.H{"success": true, "data": gin.H{"total": total, "items": items}})
}

func ReconcileTrialReservation(c *gin.Context) {
	var req struct {
		Actual *int   `json:"actual_quota"`
		Refund *bool  `json:"refund"`
		Reason string `json:"reason"`
	}
	if common.DecodeJson(c.Request.Body, &req) != nil || req.Actual == nil || req.Refund == nil || *req.Actual < 0 || *req.Actual > common.MaxQuota || (*req.Refund && *req.Actual != 0) || strings.TrimSpace(req.Reason) == "" || len(req.Reason) > 1000 {
		common.ApiError(c, errors.New("Actual quota, refund decision and an audit reason are required."))
		return
	}
	var reservation model.TrialReservation
	if err := model.DB.Where("request_id = ?", c.Param("request")).First(&reservation).Error; err != nil {
		common.ApiError(c, err)
		return
	}
	if reservation.State == model.TrialReservationReserved && reservation.UpdatedAt > time.Now().Unix()-600 {
		common.ApiError(c, errors.New("Recent trial reservations cannot be manually reconciled."))
		return
	}
	result, err := model.FinishTrialReservation(reservation.RequestID, *req.Actual, *req.Refund)
	if err != nil {
		common.ApiError(c, err)
		return
	}
	_ = model.InvalidateUserTokensCache(reservation.UserID)
	recordManageAuditFor(c, reservation.UserID, "trial.reconcile", map[string]interface{}{"request_id": reservation.RequestID, "actual_quota": result.Actual, "funded_quota": result.Funded, "state": result.State, "reason": req.Reason})
	c.JSON(http.StatusOK, gin.H{"success": true, "data": result})
}
