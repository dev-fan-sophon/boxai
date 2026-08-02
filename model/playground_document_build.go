package model

import (
	"time"

	"gorm.io/gorm"
)

// PlaygroundDocumentBuild records one execution of a model-authored build script in the sandbox.
// A single user request can produce several rows: the first attempt plus any self-heal retries,
// each with the traceback that caused the retry.
//
// The row exists mainly so the rollout can be judged on evidence. Build success rate per authoring
// model is the number that decides whether weak models need a fallback, and it cannot be
// reconstructed after the fact, so it is written from the first build onward.
type PlaygroundDocumentBuild struct {
	Id     int `json:"id" gorm:"primaryKey;autoIncrement"`
	UserId int `json:"-" gorm:"not null;index"`
	// RunId is retained for historical rows created before boxai-chat took over
	// document orchestration. New builds use ExternalRunId.
	RunId int `json:"run_id" gorm:"index"`
	// ExternalRunId is the boxai-chat run identifier for builds requested through the
	// internal API, so the self-heal attempt cap survives service restarts.
	ExternalRunId  string `json:"external_run_id,omitempty" gorm:"type:varchar(64);index"`
	ConversationId int    `json:"conversation_id" gorm:"index"`
	// SandboxKey is the conversation-scoped container identity, doc:{user_id}:{conversation_id}.
	SandboxKey string `json:"-" gorm:"type:varchar(191);index"`
	Status     string `json:"status" gorm:"type:varchar(32);not null;index"` // building | completed | failed
	Attempt    int    `json:"attempt"`
	// ChatModel is the model that authored the script, which is whichever model the user had
	// selected. Success rate is grouped by this column.
	ChatModel     string `json:"chat_model" gorm:"type:varchar(191);index"`
	Instance      string `json:"-" gorm:"type:varchar(32)"`
	Code          string `json:"-" gorm:"type:text"`
	ArtifactsJson string `json:"-" gorm:"type:text"`
	// StderrTail is the traceback handed back to the model on a retry. Truncated before it is
	// stored; the sandbox can emit far more than is useful.
	StderrTail   string `json:"-" gorm:"type:text"`
	ExitCode     int    `json:"exit_code"`
	DurationMs   int    `json:"duration_ms"`
	ErrorMessage string `json:"error,omitempty" gorm:"type:text"`
	CreatedAt    int64  `json:"created_at" gorm:"bigint;index"`
	UpdatedAt    int64  `json:"updated_at" gorm:"bigint"`
}

func (PlaygroundDocumentBuild) TableName() string { return "playground_document_builds" }

const (
	PlaygroundDocumentBuildBuilding  = "building"
	PlaygroundDocumentBuildCompleted = "completed"
	PlaygroundDocumentBuildFailed    = "failed"
)

func UpdatePlaygroundDocumentBuild(id int, updates map[string]any) error {
	updates["updated_at"] = time.Now().Unix()
	return DB.Model(&PlaygroundDocumentBuild{}).Where("id = ?", id).Updates(updates).Error
}

// CreateInternalPlaygroundDocumentBuildAttempt atomically claims the next
// self-heal attempt for a chat-service run. Locking the owning user row gives
// every supported SQL dialect a stable row to serialize on, so concurrent
// requests cannot both spend the same attempt.
func CreateInternalPlaygroundDocumentBuildAttempt(build *PlaygroundDocumentBuild, maxAttempts int) (bool, error) {
	claimed := false
	err := DB.Transaction(func(tx *gorm.DB) error {
		var user User
		if err := lockForUpdate(tx).Select("id").First(&user, build.UserId).Error; err != nil {
			return err
		}
		var attempts int64
		if err := tx.Model(&PlaygroundDocumentBuild{}).
			Where("external_run_id = ? AND user_id = ?", build.ExternalRunId, build.UserId).
			Count(&attempts).Error; err != nil {
			return err
		}
		if int(attempts) >= maxAttempts {
			return nil
		}
		now := time.Now().Unix()
		build.Attempt = int(attempts) + 1
		build.CreatedAt = now
		build.UpdatedAt = now
		if err := tx.Create(build).Error; err != nil {
			return err
		}
		claimed = true
		return nil
	})
	return claimed, err
}

// LatestCompletedPlaygroundDocumentBuild finds the document a follow-up request should edit
// rather than regenerate. Scoped to the conversation because that is the boundary a user
// perceives as "the document we were working on".
func LatestCompletedPlaygroundDocumentBuild(userId, conversationId int) (*PlaygroundDocumentBuild, error) {
	var build PlaygroundDocumentBuild
	err := DB.Where("user_id = ? AND conversation_id = ? AND status = ?", userId, conversationId, PlaygroundDocumentBuildCompleted).
		Order("id desc").First(&build).Error
	if err != nil {
		return nil, err
	}
	return &build, nil
}
