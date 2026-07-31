package model

import (
	"errors"
	"strconv"
	"strings"

	"github.com/dev-fan-sophon/boxai/common"

	"gorm.io/gorm"
)

// UserTag is a free-form marketing label attached to a user. Tags are the manual
// counterpart to segments: segments are recomputed from a filter, tags are set
// by an operator and survive filter changes.
type UserTag struct {
	Id        int    `json:"id"`
	UserId    int    `json:"user_id" gorm:"not null;uniqueIndex:idx_user_tag,priority:1"`
	Tag       string `json:"tag" gorm:"type:varchar(64);not null;uniqueIndex:idx_user_tag,priority:2;index"`
	CreatedBy int    `json:"created_by" gorm:"default:0"`
	CreatedAt int64  `json:"created_at" gorm:"bigint;default:0"`
}

func (UserTag) TableName() string {
	return "user_tags"
}

// UserSegment stores a saved audience definition. Filter holds the serialized
// UserQueryFilter; it is always re-parsed into a typed struct before it reaches
// the database so a stored filter cannot inject SQL.
type UserSegment struct {
	Id          int    `json:"id"`
	Name        string `json:"name" gorm:"type:varchar(64);not null"`
	Description string `json:"description" gorm:"type:varchar(255);default:''"`
	Filter      string `json:"filter" gorm:"type:text"`
	CachedCount int    `json:"cached_count" gorm:"default:0"`
	RefreshedAt int64  `json:"refreshed_at" gorm:"bigint;default:0"`
	CreatedBy   int    `json:"created_by" gorm:"index;default:0"`
	CreatedAt   int64  `json:"created_at" gorm:"bigint;default:0"`
	UpdatedAt   int64  `json:"updated_at" gorm:"bigint;default:0"`
}

func (UserSegment) TableName() string {
	return "user_segments"
}

// Campaign types supported by the operations console.
const (
	CampaignTypeQuotaGrant = "quota_grant"
	CampaignTypeGroupSet   = "group_set"
	CampaignTypeTag        = "tag"
	CampaignTypeEmail      = "email"
)

const (
	CampaignStatusRunning   = "running"
	CampaignStatusCompleted = "completed"
	CampaignStatusPartial   = "partial"
	CampaignStatusFailed    = "failed"
)

// UserCampaign records one outreach or bulk operation executed against a segment,
// so operators can audit reach and measure follow-up conversion.
type UserCampaign struct {
	Id           int    `json:"id"`
	SegmentId    int    `json:"segment_id" gorm:"index;default:0"`
	Name         string `json:"name" gorm:"type:varchar(128);not null"`
	Type         string `json:"type" gorm:"type:varchar(32);not null"`
	Payload      string `json:"payload" gorm:"type:text"`
	Status       string `json:"status" gorm:"type:varchar(16);default:''"`
	TargetCount  int    `json:"target_count" gorm:"default:0"`
	SuccessCount int    `json:"success_count" gorm:"default:0"`
	FailedCount  int    `json:"failed_count" gorm:"default:0"`
	Message      string `json:"message" gorm:"type:varchar(255);default:''"`
	CreatedBy    int    `json:"created_by" gorm:"index;default:0"`
	CreatedAt    int64  `json:"created_at" gorm:"bigint;index;default:0"`
	FinishedAt   int64  `json:"finished_at" gorm:"bigint;default:0"`
}

func (UserCampaign) TableName() string {
	return "user_campaigns"
}

// UserQueryFilter is the typed audience definition shared by the directory list,
// segment previews, and campaign execution. Every field maps to a bound
// parameter; no part of it is ever interpolated into SQL.
type UserQueryFilter struct {
	Keyword         string   `json:"keyword"`
	Group           string   `json:"group"`
	Role            *int     `json:"role"`
	Status          *int     `json:"status"`
	RegisterSource  string   `json:"register_source"`
	UtmSource       string   `json:"utm_source"`
	UtmCampaign     string   `json:"utm_campaign"`
	Tags            []string `json:"tags"`
	InviterId       *int     `json:"inviter_id"`
	CreatedAfter    int64    `json:"created_after"`
	CreatedBefore   int64    `json:"created_before"`
	LastLoginAfter  int64    `json:"last_login_after"`
	LastLoginBefore int64    `json:"last_login_before"`
	ActiveAfter     int64    `json:"active_after"`
	InactiveDays    int      `json:"inactive_days"`
	NeverActive     bool     `json:"never_active"`
	MinQuota        *int     `json:"min_quota"`
	MaxQuota        *int     `json:"max_quota"`
	MinUsedQuota    *int     `json:"min_used_quota"`
	MinTopupMoney   *float64 `json:"min_topup_money"`
	MaxTopupMoney   *float64 `json:"max_topup_money"`
	MinTopupCount   *int     `json:"min_topup_count"`
	HasPaid         *bool    `json:"has_paid"`
	HasSubscription *bool    `json:"has_subscription"`
}

// adminUserSortColumns maps API sort keys to qualified columns. The directory
// joins user_lifecycles, so lifecycle metrics are sortable alongside user fields.
var adminUserSortColumns = map[string]string{
	"id":             "u.id",
	"username":       "u.username",
	"quota":          "u.quota",
	"used_quota":     "u.used_quota",
	"created_at":     "u.created_at",
	"last_login_at":  "u.last_login_at",
	"last_active_at": "l.last_active_at",
	"topup_money":    "l.topup_money",
	"topup_count":    "l.topup_count",
	"quota_30":       "l.quota_30",
	"active_days":    "l.active_days",
}

// AdminUserRow is one directory row: the user record plus the derived lifecycle
// metrics and operator tags that the marketing console needs.
type AdminUserRow struct {
	*User
	Lifecycle *UserLifecycle `json:"lifecycle,omitempty"`
	Tags      []string       `json:"tags,omitempty"`
}

// Apply narrows a query that selects from `users u` left-joined to
// `user_lifecycles l`.
func (filter UserQueryFilter) Apply(query *gorm.DB) *gorm.DB {
	if keyword := strings.TrimSpace(filter.Keyword); keyword != "" {
		pattern := "%" + keyword + "%"
		condition := "u.username LIKE ? OR u.email LIKE ? OR u.display_name LIKE ? OR u.remark LIKE ?"
		args := []interface{}{pattern, pattern, pattern, pattern}
		if id, err := strconv.Atoi(keyword); err == nil {
			condition = "u.id = ? OR " + condition
			args = append([]interface{}{id}, args...)
		}
		query = query.Where("("+condition+")", args...)
	}
	if filter.Group != "" {
		query = query.Where("u."+commonGroupCol+" = ?", filter.Group)
	}
	if filter.Role != nil {
		query = query.Where("u.role = ?", *filter.Role)
	}
	// UserStatusFilterDeleted is handled in baseQuery via deleted_at; a plain
	// status equality would never match soft-deleted rows.
	if filter.Status != nil && *filter.Status != UserStatusFilterDeleted {
		query = query.Where("u.status = ?", *filter.Status)
	}
	if filter.RegisterSource != "" {
		query = query.Where("u.register_source = ?", filter.RegisterSource)
	}
	if filter.UtmSource != "" {
		query = query.Where("u.utm_source = ?", filter.UtmSource)
	}
	if filter.UtmCampaign != "" {
		query = query.Where("u.utm_campaign = ?", filter.UtmCampaign)
	}
	if filter.InviterId != nil {
		query = query.Where("u.inviter_id = ?", *filter.InviterId)
	}
	if filter.CreatedAfter > 0 {
		query = query.Where("u.created_at >= ?", filter.CreatedAfter)
	}
	if filter.CreatedBefore > 0 {
		query = query.Where("u.created_at <= ?", filter.CreatedBefore)
	}
	if filter.LastLoginAfter > 0 {
		query = query.Where("u.last_login_at >= ?", filter.LastLoginAfter)
	}
	if filter.LastLoginBefore > 0 {
		query = query.Where("u.last_login_at <= ?", filter.LastLoginBefore)
	}
	if filter.MinQuota != nil {
		query = query.Where("u.quota >= ?", *filter.MinQuota)
	}
	if filter.MaxQuota != nil {
		query = query.Where("u.quota <= ?", *filter.MaxQuota)
	}
	if filter.MinUsedQuota != nil {
		query = query.Where("u.used_quota >= ?", *filter.MinUsedQuota)
	}
	if filter.ActiveAfter > 0 {
		query = query.Where("l.last_active_at >= ?", filter.ActiveAfter)
	}
	if filter.InactiveDays > 0 {
		cutoff := common.GetTimestamp() - int64(filter.InactiveDays)*secondsPerDay
		query = query.Where("l.first_active_at > 0").Where("l.last_active_at < ?", cutoff)
	}
	if filter.NeverActive {
		query = query.Where("(l.first_active_at IS NULL OR l.first_active_at = 0)")
	}
	if filter.MinTopupMoney != nil {
		query = query.Where("l.topup_money >= ?", *filter.MinTopupMoney)
	}
	if filter.MaxTopupMoney != nil {
		query = query.Where("l.topup_money <= ?", *filter.MaxTopupMoney)
	}
	if filter.MinTopupCount != nil {
		query = query.Where("l.topup_count >= ?", *filter.MinTopupCount)
	}
	if filter.HasPaid != nil {
		if *filter.HasPaid {
			query = query.Where("l.first_paid_at > 0")
		} else {
			query = query.Where("(l.first_paid_at IS NULL OR l.first_paid_at = 0)")
		}
	}
	if len(filter.Tags) > 0 {
		query = query.Where("u.id IN (?)", DB.Table("user_tags").Select("user_id").Where("tag IN ?", filter.Tags))
	}
	if filter.HasSubscription != nil {
		subscribers := DB.Table("user_subscriptions").
			Select("user_id").
			Where("status = ?", "active").
			Where("end_time > ?", common.GetTimestamp())
		if *filter.HasSubscription {
			query = query.Where("u.id IN (?)", subscribers)
		} else {
			query = query.Where("u.id NOT IN (?)", subscribers)
		}
	}
	return query
}

// UserStatusFilterDeleted is the sentinel the console sends to list soft-deleted
// accounts, matching the legacy SearchUsers contract.
const UserStatusFilterDeleted = -1

func (filter UserQueryFilter) baseQuery() *gorm.DB {
	query := DB.Table("users u").
		Joins("LEFT JOIN user_lifecycles l ON l.user_id = u.id")
	if filter.Status != nil && *filter.Status == UserStatusFilterDeleted {
		query = query.Where("u.deleted_at IS NOT NULL")
	} else {
		query = query.Where("u.deleted_at IS NULL")
	}
	return filter.Apply(query)
}

// CountUsersByFilter returns how many users currently match the filter.
func CountUsersByFilter(filter UserQueryFilter) (int64, error) {
	var total int64
	err := filter.baseQuery().Count(&total).Error
	return total, err
}

// QueryUsers returns one page of directory rows with lifecycle metrics and tags
// attached. Lifecycle and tags are loaded per page rather than joined into the
// projection so the user columns stay unambiguous across dialects.
func QueryUsers(filter UserQueryFilter, sortBy string, sortOrder string, startIdx int, num int) ([]*AdminUserRow, int64, error) {
	total, err := CountUsersByFilter(filter)
	if err != nil {
		return nil, 0, err
	}

	column, ok := adminUserSortColumns[strings.ToLower(strings.TrimSpace(sortBy))]
	if !ok {
		column = "u.id"
	}
	direction := "DESC"
	if strings.EqualFold(strings.TrimSpace(sortOrder), "asc") {
		direction = "ASC"
	}

	// Unscoped: soft deletion is handled explicitly in baseQuery, and GORM's
	// automatic soft-delete clause on the *User destination would otherwise
	// exclude the rows the deleted-status filter asks for.
	var users []*User
	err = filter.baseQuery().
		Unscoped().
		Select("u.*").
		Order(column + " " + direction).
		Order("u.id DESC").
		Limit(num).
		Offset(startIdx).
		Find(&users).Error
	if err != nil {
		return nil, 0, err
	}
	rows, err := decorateUserRows(users)
	if err != nil {
		return nil, 0, err
	}
	return rows, total, nil
}

// CollectUserIdsByFilter returns the ids of every user matching the filter, up to
// limit. Campaigns use it so a bulk action can never fan out without a bound.
func CollectUserIdsByFilter(filter UserQueryFilter, limit int) ([]int, error) {
	var userIDs []int
	err := filter.baseQuery().
		Order("u.id ASC").
		Limit(limit).
		Pluck("u.id", &userIDs).Error
	return userIDs, err
}

func decorateUserRows(users []*User) ([]*AdminUserRow, error) {
	rows := make([]*AdminUserRow, 0, len(users))
	if len(users) == 0 {
		return rows, nil
	}
	userIDs := make([]int, 0, len(users))
	for _, user := range users {
		user.Password = ""
		user.SetAccessToken("")
		userIDs = append(userIDs, user.Id)
	}

	var lifecycles []UserLifecycle
	if err := DB.Where("user_id IN ?", userIDs).Find(&lifecycles).Error; err != nil {
		return nil, err
	}
	lifecycleByUser := make(map[int]*UserLifecycle, len(lifecycles))
	for i := range lifecycles {
		lifecycleByUser[lifecycles[i].UserId] = &lifecycles[i]
	}

	var tags []UserTag
	if err := DB.Where("user_id IN ?", userIDs).Order("tag ASC").Find(&tags).Error; err != nil {
		return nil, err
	}
	tagsByUser := map[int][]string{}
	for _, tag := range tags {
		tagsByUser[tag.UserId] = append(tagsByUser[tag.UserId], tag.Tag)
	}

	for _, user := range users {
		rows = append(rows, &AdminUserRow{
			User:      user,
			Lifecycle: lifecycleByUser[user.Id],
			Tags:      tagsByUser[user.Id],
		})
	}
	return rows, nil
}

// UserTagCount is one entry of the tag directory used by filter menus.
type UserTagCount struct {
	Tag   string `json:"tag"`
	Users int64  `json:"users"`
}

// ListUserTagNames returns every tag in use with its user count, for filter menus.
func ListUserTagNames() ([]UserTagCount, error) {
	var rows []UserTagCount
	err := DB.Table("user_tags").
		Select("tag as tag, count(*) as users").
		Group("tag").
		Order("users DESC").
		Find(&rows).Error
	return rows, err
}

// AttachUserTag adds a tag to the given users, ignoring users that already carry it.
func AttachUserTag(userIDs []int, tag string, operatorID int) (int, error) {
	tag = strings.TrimSpace(tag)
	if tag == "" {
		return 0, errors.New("tag is empty")
	}
	if len(tag) > 64 {
		tag = tag[:64]
	}
	now := common.GetTimestamp()
	applied := 0
	for _, userID := range userIDs {
		record := UserTag{UserId: userID, Tag: tag, CreatedBy: operatorID, CreatedAt: now}
		result := DB.Where("user_id = ? AND tag = ?", userID, tag).FirstOrCreate(&record)
		if result.Error != nil {
			return applied, result.Error
		}
		if result.RowsAffected > 0 {
			applied++
		}
	}
	return applied, nil
}

// DetachUserTag removes a tag from the given users.
func DetachUserTag(userIDs []int, tag string) (int64, error) {
	if len(userIDs) == 0 || tag == "" {
		return 0, nil
	}
	result := DB.Where("user_id IN ? AND tag = ?", userIDs, tag).Delete(&UserTag{})
	return result.RowsAffected, result.Error
}

// ParseSegmentFilter decodes a stored segment definition into the typed filter.
func ParseSegmentFilter(raw string) (UserQueryFilter, error) {
	filter := UserQueryFilter{}
	if strings.TrimSpace(raw) == "" {
		return filter, nil
	}
	err := common.UnmarshalJsonStr(raw, &filter)
	return filter, err
}

func ListUserSegments() ([]*UserSegment, error) {
	var segments []*UserSegment
	err := DB.Order("id DESC").Find(&segments).Error
	return segments, err
}

func GetUserSegmentById(id int) (*UserSegment, error) {
	segment := &UserSegment{}
	err := DB.First(segment, "id = ?", id).Error
	if err != nil {
		return nil, err
	}
	return segment, nil
}

func (segment *UserSegment) Insert() error {
	now := common.GetTimestamp()
	segment.CreatedAt = now
	segment.UpdatedAt = now
	return DB.Create(segment).Error
}

func (segment *UserSegment) Update() error {
	segment.UpdatedAt = common.GetTimestamp()
	return DB.Model(segment).Select("name", "description", "filter", "cached_count", "refreshed_at", "updated_at").Updates(segment).Error
}

func DeleteUserSegmentById(id int) error {
	return DB.Delete(&UserSegment{}, "id = ?", id).Error
}

// RefreshSegmentCount recomputes and stores the audience size of a segment.
func RefreshSegmentCount(segment *UserSegment) (int64, error) {
	filter, err := ParseSegmentFilter(segment.Filter)
	if err != nil {
		return 0, err
	}
	total, err := CountUsersByFilter(filter)
	if err != nil {
		return 0, err
	}
	segment.CachedCount = int(total)
	segment.RefreshedAt = common.GetTimestamp()
	err = DB.Model(&UserSegment{}).
		Where("id = ?", segment.Id).
		Updates(map[string]interface{}{"cached_count": segment.CachedCount, "refreshed_at": segment.RefreshedAt}).Error
	return total, err
}

func ListUserCampaigns(limit int) ([]*UserCampaign, error) {
	if limit <= 0 || limit > 200 {
		limit = 50
	}
	var campaigns []*UserCampaign
	err := DB.Order("id DESC").Limit(limit).Find(&campaigns).Error
	return campaigns, err
}

func (campaign *UserCampaign) Insert() error {
	campaign.CreatedAt = common.GetTimestamp()
	return DB.Create(campaign).Error
}

// FinishUserCampaign stores the delivery outcome of a background campaign run.
func FinishUserCampaign(campaignID int, status string, success int, failed int, message string) error {
	if len(message) > 255 {
		message = message[:255]
	}
	return DB.Model(&UserCampaign{}).
		Where("id = ?", campaignID).
		Updates(map[string]interface{}{
			"status":        status,
			"success_count": success,
			"failed_count":  failed,
			"message":       message,
			"finished_at":   common.GetTimestamp(),
		}).Error
}

// CollectUserEmails returns the deliverable addresses of the given users,
// skipping disabled accounts and users without an email on file.
func CollectUserEmails(userIDs []int) ([]string, error) {
	if len(userIDs) == 0 {
		return nil, nil
	}
	var emails []string
	err := DB.Model(&User{}).
		Where("id IN ?", userIDs).
		Where("status = ?", common.UserStatusEnabled).
		Where("email <> ''").
		Pluck("email", &emails).Error
	return emails, err
}
