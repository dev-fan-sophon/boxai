package model

import (
	"errors"
	"testing"

	"github.com/dev-fan-sophon/boxai/common"
	"github.com/dev-fan-sophon/boxai/setting/operation_setting"
	"github.com/stretchr/testify/assert"
	"github.com/stretchr/testify/require"
	"gorm.io/gorm"
)

func TestTopUpReviewNotificationAtomicEnqueueAndLeaseRecovery(t *testing.T) {
	setupTopUpSubmissionTestDB(t)
	require.NoError(t, DB.AutoMigrate(&TopUpReviewNotification{}))
	common.OptionMapRWMutex.Lock()
	oldOptions := common.OptionMap
	common.OptionMap = map[string]string{operation_setting.TopUpReviewNotificationOptionKey: `{"enabled":true,"recipients":["admin@example.com"]}`}
	common.OptionMapRWMutex.Unlock()
	t.Cleanup(func() {
		common.OptionMapRWMutex.Lock()
		common.OptionMap = oldOptions
		common.OptionMapRWMutex.Unlock()
	})

	submission := &TopUpSubmission{Id: 1}
	err := DB.Transaction(func(tx *gorm.DB) error {
		require.NoError(t, enqueueTopUpReviewNotification(tx, submission))
		return errors.New("rollback submission")
	})
	require.Error(t, err)
	var count int64
	require.NoError(t, DB.Model(&TopUpReviewNotification{}).Count(&count).Error)
	assert.Zero(t, count)
	require.NoError(t, DB.Transaction(func(tx *gorm.DB) error { return enqueueTopUpReviewNotification(tx, submission) }))
	require.Error(t, DB.Transaction(func(tx *gorm.DB) error { return enqueueTopUpReviewNotification(tx, submission) }))
	now := common.GetTimestamp()
	items, err := DueTopUpReviewNotifications(now, 10)
	require.NoError(t, err)
	require.Len(t, items, 1)
	first, second := items[0], items[0]
	claimed, err := ClaimTopUpReviewNotification(&first, now)
	require.NoError(t, err)
	assert.True(t, claimed)
	claimed, err = ClaimTopUpReviewNotification(&second, now)
	require.NoError(t, err)
	assert.False(t, claimed)
	claimed, err = ClaimTopUpReviewNotification(&second, now+121)
	require.NoError(t, err)
	assert.True(t, claimed, "a crashed worker must not strand a reminder")
	require.Error(t, FinishTopUpReviewNotification(&first, now+121, "sent"))
	require.NoError(t, FinishTopUpReviewNotification(&second, now+121, "pending"))
	items, err = DueTopUpReviewNotifications(now+180, 10)
	require.NoError(t, err)
	assert.Empty(t, items, "failed deliveries must back off")
	items, err = DueTopUpReviewNotifications(now+181, 10)
	require.NoError(t, err)
	require.Len(t, items, 1)
	claimed, err = ClaimTopUpReviewNotification(&items[0], now+181)
	require.NoError(t, err)
	require.True(t, claimed)
	require.NoError(t, FinishTopUpReviewNotification(&items[0], now+181, "sent"))
	items, err = DueTopUpReviewNotifications(now+10000, 10)
	require.NoError(t, err)
	assert.Empty(t, items, "successfully delivered reminders must not be retried")
}
