package model

import (
	"errors"
	"fmt"
	"time"

	"github.com/QuantumNous/new-api/common"
	"gorm.io/gorm"
)

// PlaygroundAsset stores user-owned media for the playground workbench.
type PlaygroundAsset struct {
	Id         int    `json:"id" gorm:"primaryKey;autoIncrement"`
	UserId     int    `json:"user_id" gorm:"not null;index"`
	Kind       string `json:"kind" gorm:"type:varchar(20);not null;index"` // image | video | audio
	Name       string `json:"name" gorm:"type:varchar(255)"`
	StorageKey string `json:"storage_key" gorm:"type:varchar(512);not null"`
	Backend    string `json:"backend" gorm:"type:varchar(16)"`    // local | r2 (empty = local, legacy)
	Visibility string `json:"visibility" gorm:"type:varchar(16)"` // private (default) | public
	PublicKey  string `json:"public_key" gorm:"type:varchar(512)"`
	PublicURL  string `json:"public_url" gorm:"type:varchar(1024)"`
	URL        string `json:"url" gorm:"type:varchar(1024)"` // public or app-relative URL
	Mime       string `json:"mime" gorm:"type:varchar(128)"`
	Size       int64  `json:"size"`
	CreatedAt  int64  `json:"created_at" gorm:"bigint;index"`
}

func (PlaygroundAsset) TableName() string { return "playground_assets" }

// PlaygroundConversation is a cloud-synced chat session.
type PlaygroundConversation struct {
	Id        int    `json:"id" gorm:"primaryKey;autoIncrement"`
	UserId    int    `json:"user_id" gorm:"not null;index"`
	Title     string `json:"title" gorm:"type:varchar(255)"`
	Model     string `json:"model" gorm:"type:varchar(191)"`
	Group     string `json:"group" gorm:"type:varchar(50)"`
	CreatedAt int64  `json:"created_at" gorm:"bigint;index"`
	UpdatedAt int64  `json:"updated_at" gorm:"bigint;index"`
}

func (PlaygroundConversation) TableName() string { return "playground_conversations" }

// PlaygroundMessage is a single turn in a conversation (normalized).
type PlaygroundMessage struct {
	Id             int    `json:"id" gorm:"primaryKey;autoIncrement"`
	ConversationId int    `json:"conversation_id" gorm:"not null;index"`
	UserId         int    `json:"user_id" gorm:"not null;index"`
	Role           string `json:"role" gorm:"type:varchar(32);not null"` // user | assistant | system
	// type:text is portable across SQLite / MySQL / PostgreSQL.
	// (MySQL TEXT is 64KB; large messages are also capped in the API layer.)
	// Do NOT use longtext — PostgreSQL rejects it (SQLSTATE 42704).
	Content   string `json:"content" gorm:"type:text"`
	Seq       int    `json:"seq" gorm:"not null;index"`
	CreatedAt int64  `json:"created_at" gorm:"bigint"`
}

func (PlaygroundMessage) TableName() string { return "playground_messages" }

// PlaygroundPersona is a reusable system prompt / role.
type PlaygroundPersona struct {
	Id           int    `json:"id" gorm:"primaryKey;autoIncrement"`
	UserId       int    `json:"user_id" gorm:"not null;index"`
	Name         string `json:"name" gorm:"type:varchar(128);not null"`
	SystemPrompt string `json:"system_prompt" gorm:"type:text"`
	CreatedAt    int64  `json:"created_at" gorm:"bigint;index"`
	UpdatedAt    int64  `json:"updated_at" gorm:"bigint"`
}

func (PlaygroundPersona) TableName() string { return "playground_personas" }

// PlaygroundRun records a lightweight generation for "My works".
type PlaygroundRun struct {
	Id        int    `json:"id" gorm:"primaryKey;autoIncrement"`
	UserId    int    `json:"user_id" gorm:"not null;index"`
	Modality  string `json:"modality" gorm:"type:varchar(20);not null;index"` // image | video | audio | chat
	Model     string `json:"model" gorm:"type:varchar(191)"`
	Prompt    string `json:"prompt" gorm:"type:text"`
	ResultURL string `json:"result_url" gorm:"type:varchar(1024)"`
	AssetId   int    `json:"asset_id" gorm:"index"` // persisted output asset, when stored
	Quota     int    `json:"quota"`
	TaskId    string `json:"task_id" gorm:"type:varchar(191);index"`
	CreatedAt int64  `json:"created_at" gorm:"bigint;index"`
}

func (PlaygroundRun) TableName() string { return "playground_runs" }

// PlaygroundVoice stores a voice-clone reference (provider wiring optional).
type PlaygroundVoice struct {
	Id              int    `json:"id" gorm:"primaryKey;autoIncrement"`
	UserId          int    `json:"user_id" gorm:"not null;index"`
	Name            string `json:"name" gorm:"type:varchar(128);not null"`
	AssetId         int    `json:"asset_id"`
	ProviderVoiceId string `json:"provider_voice_id" gorm:"type:varchar(191)"`
	Status          string `json:"status" gorm:"type:varchar(40)"` // pending_provider | ready | failed
	CreatedAt       int64  `json:"created_at" gorm:"bigint;index"`
}

func (PlaygroundVoice) TableName() string { return "playground_voices" }

// InspirationCategory groups inspiration templates.
type InspirationCategory struct {
	Id        int    `json:"id" gorm:"primaryKey;autoIncrement"`
	Slug      string `json:"slug" gorm:"type:varchar(64);uniqueIndex;not null"`
	Name      string `json:"name" gorm:"type:varchar(128);not null"`
	SortOrder int    `json:"sort_order"`
	CreatedAt int64  `json:"created_at" gorm:"bigint"`
}

func (InspirationCategory) TableName() string { return "inspiration_categories" }

// InspirationTemplate is a prompt template for the inspiration square.
type InspirationTemplate struct {
	Id         int    `json:"id" gorm:"primaryKey;autoIncrement"`
	CategoryId int    `json:"category_id" gorm:"index"`
	Slug       string `json:"slug" gorm:"type:varchar(64);uniqueIndex;not null"`
	Title      string `json:"title" gorm:"type:varchar(255);not null"`
	Prompt     string `json:"prompt" gorm:"type:text;not null"`
	Modality   string `json:"modality" gorm:"type:varchar(20);not null;index"` // image | video | chat | audio
	CoverURL   string `json:"cover_url" gorm:"type:varchar(1024)"`
	UseCount   int    `json:"use_count"`
	SortOrder  int    `json:"sort_order"`
	CreatedAt  int64  `json:"created_at" gorm:"bigint"`
}

func (InspirationTemplate) TableName() string { return "inspiration_templates" }

// PlaygroundUploadSession is a short-lived token for QR / cross-device upload.
type PlaygroundUploadSession struct {
	Id        int    `json:"id" gorm:"primaryKey;autoIncrement"`
	UserId    int    `json:"user_id" gorm:"not null;index"`
	Token     string `json:"token" gorm:"type:varchar(64);uniqueIndex;not null"`
	Kind      string `json:"kind" gorm:"type:varchar(20)"` // preferred kind filter
	ExpiresAt int64  `json:"expires_at" gorm:"bigint;index"`
	AssetId   int    `json:"asset_id"` // filled when upload completes
	CreatedAt int64  `json:"created_at" gorm:"bigint"`
}

func (PlaygroundUploadSession) TableName() string { return "playground_upload_sessions" }

// --- Asset helpers ---

func CreatePlaygroundAsset(a *PlaygroundAsset) error {
	if a.CreatedAt == 0 {
		a.CreatedAt = time.Now().Unix()
	}
	return DB.Create(a).Error
}

func GetPlaygroundAsset(id int, userId int) (*PlaygroundAsset, error) {
	var a PlaygroundAsset
	err := DB.Where("id = ? AND user_id = ?", id, userId).First(&a).Error
	if err != nil {
		return nil, err
	}
	return &a, nil
}

func GetPlaygroundAssetById(id int) (*PlaygroundAsset, error) {
	var a PlaygroundAsset
	err := DB.Where("id = ?", id).First(&a).Error
	if err != nil {
		return nil, err
	}
	return &a, nil
}

func ListPlaygroundAssets(userId int, kind string, offset, limit int) ([]PlaygroundAsset, int64, error) {
	q := DB.Model(&PlaygroundAsset{}).Where("user_id = ?", userId)
	if kind != "" {
		q = q.Where("kind = ?", kind)
	}
	var total int64
	if err := q.Count(&total).Error; err != nil {
		return nil, 0, err
	}
	var items []PlaygroundAsset
	err := q.Order("id DESC").Offset(offset).Limit(limit).Find(&items).Error
	return items, total, err
}

func DeletePlaygroundAsset(id int, userId int) error {
	res := DB.Where("id = ? AND user_id = ?", id, userId).Delete(&PlaygroundAsset{})
	if res.Error != nil {
		return res.Error
	}
	if res.RowsAffected == 0 {
		return gorm.ErrRecordNotFound
	}
	return nil
}

// SetPlaygroundAssetVisibility updates publish state. Empty publicKey/publicURL
// clear the public copy metadata (unpublish).
func SetPlaygroundAssetVisibility(id, userId int, visibility, publicKey, publicURL string) error {
	res := DB.Model(&PlaygroundAsset{}).
		Where("id = ? AND user_id = ?", id, userId).
		Updates(map[string]any{
			"visibility": visibility,
			"public_key": publicKey,
			"public_url": publicURL,
		})
	if res.Error != nil {
		return res.Error
	}
	if res.RowsAffected == 0 {
		return gorm.ErrRecordNotFound
	}
	return nil
}

// --- Conversation helpers ---

func CreatePlaygroundConversation(c *PlaygroundConversation) error {
	now := time.Now().Unix()
	if c.CreatedAt == 0 {
		c.CreatedAt = now
	}
	c.UpdatedAt = now
	return DB.Create(c).Error
}

func GetPlaygroundConversation(id int, userId int) (*PlaygroundConversation, error) {
	var c PlaygroundConversation
	err := DB.Where("id = ? AND user_id = ?", id, userId).First(&c).Error
	if err != nil {
		return nil, err
	}
	return &c, nil
}

func ListPlaygroundConversations(userId int, offset, limit int) ([]PlaygroundConversation, int64, error) {
	q := DB.Model(&PlaygroundConversation{}).Where("user_id = ?", userId)
	var total int64
	if err := q.Count(&total).Error; err != nil {
		return nil, 0, err
	}
	var items []PlaygroundConversation
	err := q.Order("updated_at DESC").Offset(offset).Limit(limit).Find(&items).Error
	return items, total, err
}

func UpdatePlaygroundConversation(c *PlaygroundConversation) error {
	c.UpdatedAt = time.Now().Unix()
	return DB.Model(c).Where("id = ? AND user_id = ?", c.Id, c.UserId).Updates(map[string]any{
		"title":      c.Title,
		"model":      c.Model,
		"group":      c.Group,
		"updated_at": c.UpdatedAt,
	}).Error
}

func DeletePlaygroundConversation(id int, userId int) error {
	return DB.Transaction(func(tx *gorm.DB) error {
		if err := tx.Where("conversation_id = ? AND user_id = ?", id, userId).Delete(&PlaygroundMessage{}).Error; err != nil {
			return err
		}
		res := tx.Where("id = ? AND user_id = ?", id, userId).Delete(&PlaygroundConversation{})
		if res.Error != nil {
			return res.Error
		}
		if res.RowsAffected == 0 {
			return gorm.ErrRecordNotFound
		}
		return nil
	})
}

func ReplacePlaygroundMessages(conversationId, userId int, messages []PlaygroundMessage) error {
	return DB.Transaction(func(tx *gorm.DB) error {
		var conv PlaygroundConversation
		if err := tx.Where("id = ? AND user_id = ?", conversationId, userId).First(&conv).Error; err != nil {
			return err
		}
		if err := tx.Where("conversation_id = ? AND user_id = ?", conversationId, userId).Delete(&PlaygroundMessage{}).Error; err != nil {
			return err
		}
		now := time.Now().Unix()
		for i := range messages {
			messages[i].Id = 0
			messages[i].ConversationId = conversationId
			messages[i].UserId = userId
			messages[i].Seq = i
			if messages[i].CreatedAt == 0 {
				messages[i].CreatedAt = now
			}
			if err := tx.Create(&messages[i]).Error; err != nil {
				return err
			}
		}
		return tx.Model(&PlaygroundConversation{}).Where("id = ?", conversationId).Update("updated_at", now).Error
	})
}

func ListPlaygroundMessages(conversationId, userId int) ([]PlaygroundMessage, error) {
	var items []PlaygroundMessage
	err := DB.Where("conversation_id = ? AND user_id = ?", conversationId, userId).
		Order("seq ASC, id ASC").Find(&items).Error
	return items, err
}

// --- Persona helpers ---

func CreatePlaygroundPersona(p *PlaygroundPersona) error {
	now := time.Now().Unix()
	if p.CreatedAt == 0 {
		p.CreatedAt = now
	}
	p.UpdatedAt = now
	return DB.Create(p).Error
}

func ListPlaygroundPersonas(userId int) ([]PlaygroundPersona, error) {
	var items []PlaygroundPersona
	err := DB.Where("user_id = ?", userId).Order("id DESC").Find(&items).Error
	return items, err
}

func GetPlaygroundPersona(id, userId int) (*PlaygroundPersona, error) {
	var p PlaygroundPersona
	err := DB.Where("id = ? AND user_id = ?", id, userId).First(&p).Error
	if err != nil {
		return nil, err
	}
	return &p, nil
}

func UpdatePlaygroundPersona(p *PlaygroundPersona) error {
	p.UpdatedAt = time.Now().Unix()
	res := DB.Model(p).Where("id = ? AND user_id = ?", p.Id, p.UserId).Updates(map[string]any{
		"name":          p.Name,
		"system_prompt": p.SystemPrompt,
		"updated_at":    p.UpdatedAt,
	})
	if res.Error != nil {
		return res.Error
	}
	if res.RowsAffected == 0 {
		return gorm.ErrRecordNotFound
	}
	return nil
}

func DeletePlaygroundPersona(id, userId int) error {
	res := DB.Where("id = ? AND user_id = ?", id, userId).Delete(&PlaygroundPersona{})
	if res.Error != nil {
		return res.Error
	}
	if res.RowsAffected == 0 {
		return gorm.ErrRecordNotFound
	}
	return nil
}

// --- Run helpers ---

func CreatePlaygroundRun(r *PlaygroundRun) error {
	if r.CreatedAt == 0 {
		r.CreatedAt = time.Now().Unix()
	}
	return DB.Create(r).Error
}

// GetPlaygroundRunByTaskId returns the most recent run linked to an async task,
// or gorm.ErrRecordNotFound when the task did not originate from the playground.
func GetPlaygroundRunByTaskId(taskId string) (*PlaygroundRun, error) {
	if taskId == "" {
		return nil, gorm.ErrRecordNotFound
	}
	var r PlaygroundRun
	err := DB.Where("task_id = ?", taskId).Order("id DESC").First(&r).Error
	if err != nil {
		return nil, err
	}
	return &r, nil
}

// UpdatePlaygroundRunResult points a run at a persisted output asset.
func UpdatePlaygroundRunResult(id, assetId int, resultURL string) error {
	return DB.Model(&PlaygroundRun{}).
		Where("id = ?", id).
		Updates(map[string]any{
			"asset_id":   assetId,
			"result_url": resultURL,
		}).Error
}

func ListPlaygroundRuns(userId int, modality string, offset, limit int) ([]PlaygroundRun, int64, error) {
	q := DB.Model(&PlaygroundRun{}).Where("user_id = ?", userId)
	if modality != "" {
		q = q.Where("modality = ?", modality)
	}
	var total int64
	if err := q.Count(&total).Error; err != nil {
		return nil, 0, err
	}
	var items []PlaygroundRun
	err := q.Order("id DESC").Offset(offset).Limit(limit).Find(&items).Error
	return items, total, err
}

// --- Voice helpers ---

func CreatePlaygroundVoice(v *PlaygroundVoice) error {
	if v.CreatedAt == 0 {
		v.CreatedAt = time.Now().Unix()
	}
	if v.Status == "" {
		v.Status = "pending_provider"
	}
	return DB.Create(v).Error
}

func ListPlaygroundVoices(userId int) ([]PlaygroundVoice, error) {
	var items []PlaygroundVoice
	err := DB.Where("user_id = ?", userId).Order("id DESC").Find(&items).Error
	return items, err
}

func DeletePlaygroundVoice(id, userId int) error {
	res := DB.Where("id = ? AND user_id = ?", id, userId).Delete(&PlaygroundVoice{})
	if res.Error != nil {
		return res.Error
	}
	if res.RowsAffected == 0 {
		return gorm.ErrRecordNotFound
	}
	return nil
}

// --- Inspiration helpers ---

func ListInspirationCategories() ([]InspirationCategory, error) {
	var items []InspirationCategory
	err := DB.Order("sort_order ASC, id ASC").Find(&items).Error
	return items, err
}

func ListInspirationTemplates(categorySlug, modality string, offset, limit int) ([]InspirationTemplate, int64, error) {
	q := DB.Model(&InspirationTemplate{})
	if categorySlug != "" && categorySlug != "all" {
		var cat InspirationCategory
		if err := DB.Where("slug = ?", categorySlug).First(&cat).Error; err == nil {
			q = q.Where("category_id = ?", cat.Id)
		} else if !errors.Is(err, gorm.ErrRecordNotFound) {
			return nil, 0, err
		}
	}
	if modality != "" && modality != "all" {
		q = q.Where("modality = ?", modality)
	}
	var total int64
	if err := q.Count(&total).Error; err != nil {
		return nil, 0, err
	}
	var items []InspirationTemplate
	err := q.Order("sort_order ASC, id DESC").Offset(offset).Limit(limit).Find(&items).Error
	return items, total, err
}

func IncrementInspirationUseCount(id int) error {
	return DB.Model(&InspirationTemplate{}).Where("id = ?", id).
		UpdateColumn("use_count", gorm.Expr("use_count + 1")).Error
}

// SeedInspirationIfEmpty inserts default categories/templates when tables are empty.
func SeedInspirationIfEmpty() error {
	var count int64
	if err := DB.Model(&InspirationCategory{}).Count(&count).Error; err != nil {
		return err
	}
	if count > 0 {
		return nil
	}
	now := time.Now().Unix()
	cats := []InspirationCategory{
		{Slug: "product", Name: "Product", SortOrder: 1, CreatedAt: now},
		{Slug: "portrait", Name: "Portrait", SortOrder: 2, CreatedAt: now},
		{Slug: "landscape", Name: "Landscape", SortOrder: 3, CreatedAt: now},
		{Slug: "creative", Name: "Creative", SortOrder: 4, CreatedAt: now},
		{Slug: "video", Name: "Video", SortOrder: 5, CreatedAt: now},
		{Slug: "writing", Name: "Writing", SortOrder: 6, CreatedAt: now},
	}
	for i := range cats {
		if err := DB.Create(&cats[i]).Error; err != nil {
			return err
		}
	}
	catBySlug := map[string]int{}
	for _, c := range cats {
		catBySlug[c.Slug] = c.Id
	}
	templates := []InspirationTemplate{
		{CategoryId: catBySlug["product"], Slug: "studio-product", Title: "Studio product shot", Prompt: "Studio product photo on a clean background, soft lighting, high detail", Modality: "image", SortOrder: 1, CreatedAt: now},
		{CategoryId: catBySlug["portrait"], Slug: "cinematic-portrait", Title: "Cinematic portrait", Prompt: "Cinematic portrait with shallow depth of field, natural light, film grain", Modality: "image", SortOrder: 2, CreatedAt: now},
		{CategoryId: catBySlug["landscape"], Slug: "golden-hour", Title: "Golden hour landscape", Prompt: "Wide landscape at golden hour, dramatic sky, ultra detailed", Modality: "image", SortOrder: 3, CreatedAt: now},
		{CategoryId: catBySlug["creative"], Slug: "surreal-scene", Title: "Surreal scene", Prompt: "Surreal dreamlike scene, vibrant colors, imaginative composition", Modality: "image", SortOrder: 4, CreatedAt: now},
		{CategoryId: catBySlug["video"], Slug: "product-orbit", Title: "Product orbit video", Prompt: "Slow orbit around a product on a pedestal, cinematic lighting", Modality: "video", SortOrder: 5, CreatedAt: now},
		{CategoryId: catBySlug["writing"], Slug: "product-copy", Title: "Product copywriter", Prompt: "Write concise product marketing copy for a premium consumer gadget.", Modality: "chat", SortOrder: 6, CreatedAt: now},
	}
	for i := range templates {
		if err := DB.Create(&templates[i]).Error; err != nil {
			return err
		}
	}
	common.SysLog(fmt.Sprintf("seeded %d inspiration templates", len(templates)))
	return nil
}

// --- Upload session helpers ---

func CreatePlaygroundUploadSession(s *PlaygroundUploadSession) error {
	if s.CreatedAt == 0 {
		s.CreatedAt = time.Now().Unix()
	}
	return DB.Create(s).Error
}

func GetPlaygroundUploadSessionByToken(token string) (*PlaygroundUploadSession, error) {
	var s PlaygroundUploadSession
	err := DB.Where("token = ?", token).First(&s).Error
	if err != nil {
		return nil, err
	}
	return &s, nil
}

// CompletePlaygroundUploadSession sets asset_id once and expires the session (one-shot).
// Returns false if the session was already completed or not found.
func CompletePlaygroundUploadSession(id, assetId int) (bool, error) {
	now := time.Now().Unix()
	res := DB.Model(&PlaygroundUploadSession{}).
		Where("id = ? AND asset_id = 0", id).
		Updates(map[string]any{
			"asset_id":   assetId,
			"expires_at": now, // invalidate immediately after first successful upload
		})
	if res.Error != nil {
		return false, res.Error
	}
	return res.RowsAffected > 0, nil
}

// PublicPlaygroundAssetDTO strips internal storage_key from API responses.
func PublicPlaygroundAssetDTO(a *PlaygroundAsset) map[string]any {
	if a == nil {
		return nil
	}
	return map[string]any{
		"id":         a.Id,
		"user_id":    a.UserId,
		"kind":       a.Kind,
		"name":       a.Name,
		"url":        a.URL,
		"visibility": a.Visibility,
		"public_url": a.PublicURL,
		"mime":       a.Mime,
		"size":       a.Size,
		"created_at": a.CreatedAt,
	}
}
