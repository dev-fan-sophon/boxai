package model

import (
	"errors"

	"github.com/dev-fan-sophon/boxai/common"
	"github.com/dev-fan-sophon/boxai/setting/operation_setting"
	"gorm.io/gorm"
)

// Each recipient has its own delivery row so retrying a failed recipient never
// resends to recipients whose delivery already succeeded.
type TopUpReviewNotification struct {
	Id            int    `gorm:"primaryKey"`
	SubmissionId  int    `gorm:"uniqueIndex:idx_topup_notification_recipient"`
	Recipient     string `gorm:"type:varchar(254);uniqueIndex:idx_topup_notification_recipient"`
	Status        string `gorm:"type:varchar(16);index"`
	Attempts      int
	NextAttemptAt int64  `gorm:"bigint;index"`
	LockedUntil   int64  `gorm:"bigint"`
	ClaimToken    string `gorm:"type:varchar(64)"`
	SentAt        int64  `gorm:"bigint"`
}

func enqueueTopUpReviewNotification(tx *gorm.DB, submission *TopUpSubmission) error {
	setting := operation_setting.GetTopUpReviewNotificationSetting()
	if !setting.Enabled {
		return nil
	}
	for _, recipient := range setting.Recipients {
		item := TopUpReviewNotification{SubmissionId: submission.Id, Recipient: recipient, Status: "pending", NextAttemptAt: common.GetTimestamp()}
		if err := tx.Create(&item).Error; err != nil {
			return err
		}
	}
	return nil
}

func DueTopUpReviewNotifications(now int64, limit int) ([]TopUpReviewNotification, error) {
	var items []TopUpReviewNotification
	err := DB.Where("status = ? AND next_attempt_at <= ? AND locked_until <= ?", "pending", now, now).
		Order("id").Limit(limit).Find(&items).Error
	return items, err
}

func ClaimTopUpReviewNotification(item *TopUpReviewNotification, now int64) (bool, error) {
	token, err := common.GenerateRandomCharsKey(32)
	if err != nil {
		return false, err
	}
	result := DB.Model(&TopUpReviewNotification{}).
		Where("id = ? AND status = ? AND next_attempt_at <= ? AND locked_until <= ?", item.Id, "pending", now, now).
		Updates(map[string]any{"locked_until": now + 120, "claim_token": token})
	if result.Error != nil || result.RowsAffected != 1 {
		return false, result.Error
	}
	item.ClaimToken = token
	return true, nil
}

// SMTP delivery is at-least-once: a process crash after SMTP acceptance but
// before this write can resend the same reminder, never credit an order twice.
func FinishTopUpReviewNotification(item *TopUpReviewNotification, now int64, status string) error {
	if status != "sent" && status != "skipped" && status != "pending" {
		return errors.New("invalid notification delivery status")
	}
	attempts := min(item.Attempts+1, 30)
	delay := int64(60) << min(attempts-1, 6)
	updates := map[string]any{"status": status, "attempts": attempts, "locked_until": 0, "claim_token": "", "next_attempt_at": now + min(delay, 3600)}
	if status == "sent" {
		updates["sent_at"] = now
	}
	result := DB.Model(&TopUpReviewNotification{}).Where("id = ? AND claim_token = ? AND status = ?", item.Id, item.ClaimToken, "pending").Updates(updates)
	if result.Error != nil {
		return result.Error
	}
	if result.RowsAffected != 1 {
		return errors.New("top-up notification lease lost")
	}
	return nil
}
