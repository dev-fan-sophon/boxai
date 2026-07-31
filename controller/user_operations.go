package controller

import (
	"encoding/csv"
	"errors"
	"fmt"
	"net/http"
	"strconv"
	"strings"
	"time"

	"github.com/dev-fan-sophon/boxai/common"
	"github.com/dev-fan-sophon/boxai/i18n"
	"github.com/dev-fan-sophon/boxai/logger"
	"github.com/dev-fan-sophon/boxai/model"

	"github.com/bytedance/gopkg/util/gopool"
	"github.com/gin-gonic/gin"
)

const (
	// maxBulkTargets bounds how many users a single bulk action or campaign can
	// touch, so a mistyped filter cannot fan out across the whole user base.
	maxBulkTargets = 2000
	// maxBulkQuotaPerUser bounds a bulk grant. Quota columns are 32-bit, so an
	// unbounded grant could overflow a recipient's balance.
	maxBulkQuotaPerUser = 500000000
	maxExportRows       = 20000
	maxCampaignSubject  = 200
	maxCampaignBody     = 20000
)

type adminUserQueryRequest struct {
	Filter    model.UserQueryFilter `json:"filter"`
	Page      int                   `json:"page"`
	PageSize  int                   `json:"page_size"`
	SortBy    string                `json:"sort_by"`
	SortOrder string                `json:"sort_order"`
}

// QueryAdminUsers powers the operations directory. It takes the filter in a POST
// body because the audience definition is a nested object that also has to round
// trip through saved segments.
func QueryAdminUsers(c *gin.Context) {
	var req adminUserQueryRequest
	if err := common.DecodeJson(c.Request.Body, &req); err != nil {
		common.ApiErrorI18n(c, i18n.MsgInvalidParams)
		return
	}
	if req.Page < 1 {
		req.Page = 1
	}
	if req.PageSize < 1 || req.PageSize > 100 {
		req.PageSize = common.ItemsPerPage
	}
	rows, total, err := model.QueryUsers(req.Filter, req.SortBy, req.SortOrder, (req.Page-1)*req.PageSize, req.PageSize)
	if err != nil {
		common.ApiError(c, err)
		return
	}
	common.ApiSuccess(c, gin.H{
		"items":     rows,
		"total":     total,
		"page":      req.Page,
		"page_size": req.PageSize,
	})
}

func GetAdminUserProfile(c *gin.Context) {
	id, err := strconv.Atoi(c.Param("id"))
	if err != nil || id <= 0 {
		common.ApiErrorI18n(c, i18n.MsgInvalidParams)
		return
	}
	profile, err := model.GetUserProfile(id)
	if err != nil {
		common.ApiError(c, err)
		return
	}
	common.ApiSuccess(c, profile)
}

func ListUserTags(c *gin.Context) {
	tags, err := model.ListUserTagNames()
	if err != nil {
		common.ApiError(c, err)
		return
	}
	common.ApiSuccess(c, tags)
}

type bulkUserActionRequest struct {
	Action    string                 `json:"action"`
	UserIds   []int                  `json:"user_ids"`
	Filter    *model.UserQueryFilter `json:"filter"`
	SegmentId int                    `json:"segment_id"`
	Quota     int                    `json:"quota"`
	Group     string                 `json:"group"`
	Tag       string                 `json:"tag"`
}

// resolveBulkTargets turns an explicit id list, a saved segment, or an ad hoc
// filter into a bounded set of user ids.
func resolveBulkTargets(userIDs []int, filter *model.UserQueryFilter, segmentID int) ([]int, error) {
	if len(userIDs) > 0 {
		if len(userIDs) > maxBulkTargets {
			return nil, fmt.Errorf("too many users selected, the limit is %d", maxBulkTargets)
		}
		return userIDs, nil
	}
	resolved := filter
	if segmentID > 0 {
		segment, err := model.GetUserSegmentById(segmentID)
		if err != nil {
			return nil, err
		}
		parsed, err := model.ParseSegmentFilter(segment.Filter)
		if err != nil {
			return nil, err
		}
		resolved = &parsed
	}
	if resolved == nil {
		return nil, errors.New("no target users specified")
	}
	return model.CollectUserIdsByFilter(*resolved, maxBulkTargets)
}

// BulkUserAction applies one operations action to a resolved audience. Quota
// grants are bounded per user and every run is written to the audit log.
func BulkUserAction(c *gin.Context) {
	var req bulkUserActionRequest
	if err := common.DecodeJson(c.Request.Body, &req); err != nil {
		common.ApiErrorI18n(c, i18n.MsgInvalidParams)
		return
	}
	targets, err := resolveBulkTargets(req.UserIds, req.Filter, req.SegmentId)
	if err != nil {
		common.ApiError(c, err)
		return
	}
	if len(targets) == 0 {
		common.ApiErrorMsg(c, "no target users matched")
		return
	}

	operatorID := c.GetInt("id")
	applied := 0
	switch req.Action {
	case "quota_grant":
		if req.Quota <= 0 || req.Quota > maxBulkQuotaPerUser {
			common.ApiErrorMsg(c, fmt.Sprintf("quota must be between 1 and %d", maxBulkQuotaPerUser))
			return
		}
		for _, userID := range targets {
			if err := model.IncreaseUserQuota(userID, req.Quota, true); err != nil {
				common.ApiError(c, err)
				return
			}
			applied++
		}
	case "group_set":
		group := strings.TrimSpace(req.Group)
		if group == "" {
			common.ApiErrorI18n(c, i18n.MsgInvalidParams)
			return
		}
		result := model.DB.Model(&model.User{}).Where("id IN ?", targets).Update("group", group)
		if result.Error != nil {
			common.ApiError(c, result.Error)
			return
		}
		applied = int(result.RowsAffected)
		invalidateUserCaches(targets)
	case "tag_add":
		applied, err = model.AttachUserTag(targets, req.Tag, operatorID)
		if err != nil {
			common.ApiError(c, err)
			return
		}
	case "tag_remove":
		removed, err := model.DetachUserTag(targets, strings.TrimSpace(req.Tag))
		if err != nil {
			common.ApiError(c, err)
			return
		}
		applied = int(removed)
	case "enable", "disable":
		status := common.UserStatusEnabled
		if req.Action == "disable" {
			status = common.UserStatusDisabled
		}
		// Mirror ManageUser's privilege rule: an operator may never flip the
		// status of a peer or a higher-privileged account in bulk.
		query := model.DB.Model(&model.User{}).Where("id IN ?", targets)
		if c.GetInt("role") != common.RoleRootUser {
			query = query.Where("role < ?", c.GetInt("role"))
		} else {
			query = query.Where("role < ?", common.RoleRootUser)
		}
		result := query.Update("status", status)
		if result.Error != nil {
			common.ApiError(c, result.Error)
			return
		}
		applied = int(result.RowsAffected)
		invalidateUserCaches(targets)
	default:
		common.ApiErrorI18n(c, i18n.MsgInvalidParams)
		return
	}

	recordManageAudit(c, "user.bulk_action", map[string]interface{}{
		"action":  req.Action,
		"count":   applied,
		"targets": len(targets),
		"quota":   logger.LogQuota(req.Quota),
		"group":   req.Group,
		"tag":     req.Tag,
	})
	common.ApiSuccess(c, gin.H{"targets": len(targets), "applied": applied})
}

func invalidateUserCaches(userIDs []int) {
	for _, userID := range userIDs {
		if err := model.InvalidateUserCache(userID); err != nil {
			common.SysError(fmt.Sprintf("failed to invalidate user cache for user %d: %s", userID, err.Error()))
		}
		if err := model.InvalidateUserTokensCache(userID); err != nil {
			common.SysError(fmt.Sprintf("failed to invalidate tokens cache for user %d: %s", userID, err.Error()))
		}
	}
}

// ExportAdminUsers streams the filtered directory as CSV. It is gated by its own
// permission because the export carries contact details.
func ExportAdminUsers(c *gin.Context) {
	var req adminUserQueryRequest
	if err := common.DecodeJson(c.Request.Body, &req); err != nil {
		common.ApiErrorI18n(c, i18n.MsgInvalidParams)
		return
	}
	rows, _, err := model.QueryUsers(req.Filter, req.SortBy, req.SortOrder, 0, maxExportRows)
	if err != nil {
		common.ApiError(c, err)
		return
	}

	filename := fmt.Sprintf("boxai-users-%s.csv", time.Now().Format("20060102-150405"))
	c.Header("Content-Type", "text/csv; charset=utf-8")
	c.Header("Content-Disposition", "attachment; filename="+filename)

	writer := csv.NewWriter(c.Writer)
	header := []string{
		"id", "username", "display_name", "email", "group", "role", "status",
		"quota", "used_quota", "request_count", "created_at", "last_login_at",
		"register_source", "utm_source", "utm_campaign", "inviter_id",
		"first_active_at", "last_active_at", "active_days", "topup_count", "topup_money", "tags",
	}
	if err := writer.Write(header); err != nil {
		common.SysError("failed to write user export header: " + err.Error())
		return
	}
	for _, row := range rows {
		lifecycle := row.Lifecycle
		if lifecycle == nil {
			lifecycle = &model.UserLifecycle{}
		}
		record := []string{
			strconv.Itoa(row.Id), row.Username, row.DisplayName, row.Email, row.Group,
			strconv.Itoa(row.Role), strconv.Itoa(row.Status),
			strconv.Itoa(row.Quota), strconv.Itoa(row.UsedQuota), strconv.Itoa(row.RequestCount),
			strconv.FormatInt(row.CreatedAt, 10), strconv.FormatInt(row.LastLoginAt, 10),
			row.RegisterSource, row.UtmSource, row.UtmCampaign, strconv.Itoa(row.InviterId),
			strconv.FormatInt(lifecycle.FirstActiveAt, 10), strconv.FormatInt(lifecycle.LastActiveAt, 10),
			strconv.Itoa(lifecycle.ActiveDays), strconv.Itoa(lifecycle.TopupCount),
			strconv.FormatFloat(lifecycle.TopupMoney, 'f', 2, 64),
			strings.Join(row.Tags, "|"),
		}
		if err := writer.Write(record); err != nil {
			common.SysError("failed to write user export row: " + err.Error())
			return
		}
	}
	writer.Flush()

	recordManageAudit(c, "user.export", map[string]interface{}{"count": len(rows)})
}

// ============================================================================
// Segments
// ============================================================================

func ListUserSegments(c *gin.Context) {
	segments, err := model.ListUserSegments()
	if err != nil {
		common.ApiError(c, err)
		return
	}
	common.ApiSuccess(c, segments)
}

type userSegmentRequest struct {
	Name        string                `json:"name"`
	Description string                `json:"description"`
	Filter      model.UserQueryFilter `json:"filter"`
}

func (req userSegmentRequest) serializedFilter() (string, error) {
	encoded, err := common.Marshal(req.Filter)
	if err != nil {
		return "", err
	}
	return string(encoded), nil
}

func CreateUserSegment(c *gin.Context) {
	var req userSegmentRequest
	if err := common.DecodeJson(c.Request.Body, &req); err != nil {
		common.ApiErrorI18n(c, i18n.MsgInvalidParams)
		return
	}
	name := strings.TrimSpace(req.Name)
	if name == "" || len(name) > 64 {
		common.ApiErrorI18n(c, i18n.MsgInvalidParams)
		return
	}
	serialized, err := req.serializedFilter()
	if err != nil {
		common.ApiError(c, err)
		return
	}
	segment := &model.UserSegment{
		Name:        name,
		Description: req.Description,
		Filter:      serialized,
		CreatedBy:   c.GetInt("id"),
	}
	if err := segment.Insert(); err != nil {
		common.ApiError(c, err)
		return
	}
	if _, err := model.RefreshSegmentCount(segment); err != nil {
		common.SysError("failed to refresh segment count: " + err.Error())
	}
	recordManageAudit(c, "segment.create", map[string]interface{}{"name": segment.Name, "id": segment.Id})
	common.ApiSuccess(c, segment)
}

func UpdateUserSegment(c *gin.Context) {
	id, err := strconv.Atoi(c.Param("id"))
	if err != nil || id <= 0 {
		common.ApiErrorI18n(c, i18n.MsgInvalidParams)
		return
	}
	var req userSegmentRequest
	if err := common.DecodeJson(c.Request.Body, &req); err != nil {
		common.ApiErrorI18n(c, i18n.MsgInvalidParams)
		return
	}
	segment, err := model.GetUserSegmentById(id)
	if err != nil {
		common.ApiError(c, err)
		return
	}
	serialized, err := req.serializedFilter()
	if err != nil {
		common.ApiError(c, err)
		return
	}
	segment.Name = strings.TrimSpace(req.Name)
	segment.Description = req.Description
	segment.Filter = serialized
	if segment.Name == "" || len(segment.Name) > 64 {
		common.ApiErrorI18n(c, i18n.MsgInvalidParams)
		return
	}
	if err := segment.Update(); err != nil {
		common.ApiError(c, err)
		return
	}
	if _, err := model.RefreshSegmentCount(segment); err != nil {
		common.SysError("failed to refresh segment count: " + err.Error())
	}
	recordManageAudit(c, "segment.update", map[string]interface{}{"name": segment.Name, "id": segment.Id})
	common.ApiSuccess(c, segment)
}

func DeleteUserSegment(c *gin.Context) {
	id, err := strconv.Atoi(c.Param("id"))
	if err != nil || id <= 0 {
		common.ApiErrorI18n(c, i18n.MsgInvalidParams)
		return
	}
	if err := model.DeleteUserSegmentById(id); err != nil {
		common.ApiError(c, err)
		return
	}
	recordManageAudit(c, "segment.delete", map[string]interface{}{"id": id})
	common.ApiSuccess(c, nil)
}

// PreviewUserSegment reports how many users an unsaved filter matches, so an
// operator can size an audience before committing to it.
func PreviewUserSegment(c *gin.Context) {
	var req userSegmentRequest
	if err := common.DecodeJson(c.Request.Body, &req); err != nil {
		common.ApiErrorI18n(c, i18n.MsgInvalidParams)
		return
	}
	total, err := model.CountUsersByFilter(req.Filter)
	if err != nil {
		common.ApiError(c, err)
		return
	}
	common.ApiSuccess(c, gin.H{"total": total})
}

// ============================================================================
// Campaigns
// ============================================================================

func ListUserCampaigns(c *gin.Context) {
	limit, _ := strconv.Atoi(c.Query("limit"))
	campaigns, err := model.ListUserCampaigns(limit)
	if err != nil {
		common.ApiError(c, err)
		return
	}
	common.ApiSuccess(c, campaigns)
}

type sendCampaignRequest struct {
	Name      string                 `json:"name"`
	SegmentId int                    `json:"segment_id"`
	Filter    *model.UserQueryFilter `json:"filter"`
	UserIds   []int                  `json:"user_ids"`
	Subject   string                 `json:"subject"`
	Content   string                 `json:"content"`
}

// SendUserCampaign delivers an email blast to a resolved audience. Delivery runs
// in the background and the campaign row carries the result, because SMTP for a
// few thousand recipients cannot complete inside a request.
func SendUserCampaign(c *gin.Context) {
	var req sendCampaignRequest
	if err := common.DecodeJson(c.Request.Body, &req); err != nil {
		common.ApiErrorI18n(c, i18n.MsgInvalidParams)
		return
	}
	subject := strings.TrimSpace(req.Subject)
	content := strings.TrimSpace(req.Content)
	if subject == "" || content == "" || len(subject) > maxCampaignSubject || len(content) > maxCampaignBody {
		common.ApiErrorI18n(c, i18n.MsgInvalidParams)
		return
	}
	targets, err := resolveBulkTargets(req.UserIds, req.Filter, req.SegmentId)
	if err != nil {
		common.ApiError(c, err)
		return
	}
	recipients, err := model.CollectUserEmails(targets)
	if err != nil {
		common.ApiError(c, err)
		return
	}
	if len(recipients) == 0 {
		common.ApiErrorMsg(c, "no recipients with a verified email address matched")
		return
	}

	name := strings.TrimSpace(req.Name)
	if name == "" {
		name = subject
	}
	payload, err := common.Marshal(map[string]string{"subject": subject})
	if err != nil {
		common.ApiError(c, err)
		return
	}
	campaign := &model.UserCampaign{
		SegmentId:   req.SegmentId,
		Name:        name,
		Type:        model.CampaignTypeEmail,
		Payload:     string(payload),
		Status:      model.CampaignStatusRunning,
		TargetCount: len(recipients),
		CreatedBy:   c.GetInt("id"),
	}
	if err := campaign.Insert(); err != nil {
		common.ApiError(c, err)
		return
	}

	campaignID := campaign.Id
	gopool.Go(func() {
		deliverCampaignEmails(campaignID, recipients, subject, content)
	})

	recordManageAudit(c, "segment.campaign_send", map[string]interface{}{
		"name":    name,
		"count":   len(recipients),
		"segment": req.SegmentId,
	})
	common.ApiSuccess(c, campaign)
}

func deliverCampaignEmails(campaignID int, recipients []string, subject string, content string) {
	success := 0
	failed := 0
	message := ""
	for _, recipient := range recipients {
		if err := common.SendEmail(subject, recipient, content); err != nil {
			failed++
			if message == "" {
				message = err.Error()
			}
			continue
		}
		success++
	}
	status := model.CampaignStatusCompleted
	if failed > 0 {
		status = model.CampaignStatusPartial
	}
	if success == 0 {
		status = model.CampaignStatusFailed
	}
	if err := model.FinishUserCampaign(campaignID, status, success, failed, message); err != nil {
		common.SysError("failed to finalize campaign: " + err.Error())
	}
}

// ============================================================================
// Attribution capture
// ============================================================================

// TrackAcquisition lets the frontend hand its first-touch attribution to the
// server as a same-site cookie, so every later signup path (including OAuth
// callbacks that never touch the SPA) can read it back.
func TrackAcquisition(c *gin.Context) {
	var attribution model.AcquisitionAttribution
	if err := common.DecodeJson(c.Request.Body, &attribution); err != nil {
		common.ApiErrorI18n(c, i18n.MsgInvalidParams)
		return
	}
	encoded, err := common.Marshal(attribution)
	if err != nil {
		common.ApiError(c, err)
		return
	}
	if len(encoded) > acquisitionCookieMaxBytes {
		common.ApiErrorI18n(c, i18n.MsgInvalidParams)
		return
	}
	c.SetSameSite(http.SameSiteLaxMode)
	c.SetCookie(acquisitionCookieName, string(encoded), int((90 * 24 * time.Hour).Seconds()), "/", "", false, false)
	common.ApiSuccess(c, nil)
}
