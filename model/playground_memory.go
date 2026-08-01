package model

import (
	"time"

	"gorm.io/gorm"
)

// PlaygroundUserMemory is one durable cross-conversation fact about a user,
// extracted by the platform-paid memory model or curated by the user. Injected
// into the playground system prompt when the user enables long memory.
type PlaygroundUserMemory struct {
	Id     int    `json:"id" gorm:"primaryKey;autoIncrement"`
	UserId int    `json:"user_id" gorm:"not null;index"`
	// Content is one self-contained fact, capped in the service layer.
	Content string `json:"content" gorm:"type:text"`
	// Category: profile | preference | project | other
	Category string `json:"category" gorm:"type:varchar(32)"`
	// SourceConversationId points at the thread the fact was extracted from
	// (0 when user-created).
	SourceConversationId int   `json:"source_conversation_id"`
	CreatedAt            int64 `json:"created_at" gorm:"bigint;index"`
	UpdatedAt            int64 `json:"updated_at" gorm:"bigint"`
}

func (PlaygroundUserMemory) TableName() string { return "playground_user_memories" }

func CreatePlaygroundUserMemory(m *PlaygroundUserMemory) error {
	now := time.Now().Unix()
	if m.CreatedAt == 0 {
		m.CreatedAt = now
	}
	m.UpdatedAt = now
	return DB.Create(m).Error
}

func ListPlaygroundUserMemories(userId int) ([]PlaygroundUserMemory, error) {
	var items []PlaygroundUserMemory
	err := DB.Where("user_id = ?", userId).Order("id ASC").Find(&items).Error
	return items, err
}

func CountPlaygroundUserMemories(userId int) (int64, error) {
	var count int64
	err := DB.Model(&PlaygroundUserMemory{}).Where("user_id = ?", userId).Count(&count).Error
	return count, err
}

// UpdatePlaygroundUserMemory rewrites a memory's content; an empty category
// preserves the stored classification.
func UpdatePlaygroundUserMemory(id, userId int, content, category string) error {
	updates := map[string]any{
		"content":    content,
		"updated_at": time.Now().Unix(),
	}
	if category != "" {
		updates["category"] = category
	}
	res := DB.Model(&PlaygroundUserMemory{}).
		Where("id = ? AND user_id = ?", id, userId).
		Updates(updates)
	if res.Error != nil {
		return res.Error
	}
	if res.RowsAffected == 0 {
		return gorm.ErrRecordNotFound
	}
	return nil
}

func DeletePlaygroundUserMemory(id, userId int) error {
	res := DB.Where("id = ? AND user_id = ?", id, userId).Delete(&PlaygroundUserMemory{})
	if res.Error != nil {
		return res.Error
	}
	if res.RowsAffected == 0 {
		return gorm.ErrRecordNotFound
	}
	return nil
}

func DeleteAllPlaygroundUserMemories(userId int) error {
	return DB.Where("user_id = ?", userId).Delete(&PlaygroundUserMemory{}).Error
}

// --- Conversation memory cursors ---

// UpdatePlaygroundConversationMemoryCursor advances the extraction cursor only
// forward, so concurrent maintenance runs cannot rewind each other.
func UpdatePlaygroundConversationMemoryCursor(conversationId, userId, memorySeq int) error {
	return DB.Model(&PlaygroundConversation{}).
		Where("id = ? AND user_id = ? AND memory_seq < ?", conversationId, userId, memorySeq).
		Update("memory_seq", memorySeq).Error
}

// UpdatePlaygroundConversationSummary stores the rolling summary together with
// the seq/client_key of the last message it covers. Guarded to move forward
// only. Bumps updated_at so clients polling the conversation-list cursor pick
// up the fresh summary.
func UpdatePlaygroundConversationSummary(conversationId, userId int, summary, tailKey string, summarySeq int) error {
	return DB.Model(&PlaygroundConversation{}).
		Where("id = ? AND user_id = ? AND summary_seq < ?", conversationId, userId, summarySeq).
		Updates(map[string]any{
			"summary":          summary,
			"summary_tail_key": tailKey,
			"summary_seq":      summarySeq,
			"updated_at":       time.Now().Unix(),
		}).Error
}

// ResetPlaygroundConversationSummary clears summary state after a full snapshot
// replace, because the replace renumbers seq and invalidates the tail key.
func ResetPlaygroundConversationSummary(conversationId, userId int) error {
	return DB.Model(&PlaygroundConversation{}).
		Where("id = ? AND user_id = ?", conversationId, userId).
		Updates(map[string]any{
			"summary":          "",
			"summary_tail_key": "",
			"summary_seq":      0,
			"memory_seq":       0,
		}).Error
}
