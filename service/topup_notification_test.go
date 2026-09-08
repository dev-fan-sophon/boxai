package service

import (
	"context"
	"errors"
	"testing"

	"github.com/dev-fan-sophon/boxai/common"
	"github.com/dev-fan-sophon/boxai/model"
	"github.com/dev-fan-sophon/boxai/setting/operation_setting"
	"github.com/glebarez/sqlite"
	"github.com/stretchr/testify/assert"
	"github.com/stretchr/testify/require"
	"gorm.io/gorm"
)

func TestTopUpReviewEmailRetriesOnlyFailedRecipientsAndSkipsReviewedOrders(t *testing.T) {
	db, err := gorm.Open(sqlite.Open("file:"+t.Name()+"?mode=memory&cache=shared"), &gorm.Config{})
	require.NoError(t, err)
	require.NoError(t, db.AutoMigrate(&model.TopUp{}, &model.TopUpSubmission{}, &model.TopUpReviewNotification{}))
	oldDB := model.DB
	model.DB = db
	common.OptionMapRWMutex.Lock()
	oldOptions := common.OptionMap
	common.OptionMap = map[string]string{operation_setting.TopUpReviewNotificationOptionKey: `{"enabled":true,"recipients":["one@example.com","two@example.com"]}`}
	common.OptionMapRWMutex.Unlock()
	t.Cleanup(func() {
		model.DB = oldDB
		common.OptionMapRWMutex.Lock()
		common.OptionMap = oldOptions
		common.OptionMapRWMutex.Unlock()
	})
	order := model.TopUp{TradeNo: "ORDER1", UserId: 7, FaceAmountMinor: 100000, Money: 70000}
	require.NoError(t, db.Create(&order).Error)
	submission := model.TopUpSubmission{TradeNo: "ORDER1", UserId: 7, OrderType: "balance", Status: "submitted", BankTransactionNo: "<script>"}
	require.NoError(t, db.Create(&submission).Error)
	for _, recipient := range []string{"one@example.com", "two@example.com"} {
		require.NoError(t, db.Create(&model.TopUpReviewNotification{SubmissionId: submission.Id, Recipient: recipient, Status: "pending"}).Error)
	}
	var recipients []string
	err = deliverTopUpReviewNotifications(context.Background(), func(subject, recipient, content string) error {
		recipients = append(recipients, recipient)
		assert.Contains(t, subject, "Top-up awaiting review")
		assert.Contains(t, content, "100000 VND")
		assert.Contains(t, content, "70000 VND")
		assert.Contains(t, content, "&lt;script&gt;")
		assert.NotContains(t, content, "<script>")
		assert.Contains(t, content, "/pricing-center/topup-reviews")
		if recipient == "two@example.com" {
			return errors.New("temporary SMTP failure")
		}
		return nil
	})
	require.Error(t, err)
	assert.Equal(t, []string{"one@example.com", "two@example.com"}, recipients)
	require.NoError(t, db.Model(&model.TopUpReviewNotification{}).Where("status = ?", "pending").Update("next_attempt_at", 0).Error)
	recipients = nil
	require.NoError(t, deliverTopUpReviewNotifications(context.Background(), func(_, recipient, _ string) error {
		recipients = append(recipients, recipient)
		return nil
	}))
	assert.Equal(t, []string{"two@example.com"}, recipients)
	require.NoError(t, db.Model(&model.TopUpSubmission{}).Where("id = ?", submission.Id).Update("status", "approved").Error)
	require.NoError(t, db.Model(&model.TopUpReviewNotification{}).Where("recipient = ?", "one@example.com").Updates(map[string]any{"status": "pending", "next_attempt_at": 0}).Error)
	recipients = nil
	require.NoError(t, deliverTopUpReviewNotifications(context.Background(), func(_, recipient, _ string) error {
		recipients = append(recipients, recipient)
		return nil
	}))
	assert.Empty(t, recipients, "an already reviewed order no longer needs a reminder")
	var notification model.TopUpReviewNotification
	require.NoError(t, db.Where("recipient = ?", "one@example.com").First(&notification).Error)
	assert.Equal(t, "skipped", notification.Status)
}
