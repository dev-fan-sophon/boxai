package model

import (
	"testing"

	"github.com/dev-fan-sophon/boxai/common"
	"github.com/dev-fan-sophon/boxai/setting/operation_setting"
	"github.com/stretchr/testify/assert"
	"github.com/stretchr/testify/require"
	"gorm.io/gorm"
)

func TestRegistrationRiskAutomaticCreditAndMailboxBudget(t *testing.T) {
	setupUserUpdateTestState(t)
	require.NoError(t, DB.AutoMigrate(&RegistrationRiskCounter{}))
	require.NoError(t, DB.Where("1 = 1").Delete(&RegistrationRiskCounter{}).Error)
	old, err := common.Marshal(operation_setting.GetRegistrationRiskPolicy())
	require.NoError(t, err)
	oldGift := common.QuotaForNewUser
	common.QuotaForNewUser = 123
	t.Cleanup(func() {
		common.QuotaForNewUser = oldGift
		require.NoError(t, operation_setting.SetRegistrationRiskPolicy(string(old)))
	})
	require.NoError(t, operation_setting.SetRegistrationRiskPolicy(`{"enabled":true,"registration_ip_daily":2,"email_ip_hourly":10,"email_identity_hourly":3,"blocked_email_domains":["disposable.example"]}`))
	for i, source := range []string{RegisterSourcePassword, RegisterSourceOAuth} {
		u := &User{Username: source, Email: source + "@example.com", RegisterSource: source, RegisterIp: "192.0.2.1", Status: common.UserStatusEnabled}
		if i == 0 {
			require.NoError(t, u.Insert(0))
		} else {
			require.NoError(t, DB.Transaction(func(tx *gorm.DB) error { return u.InsertWithTx(tx, 0) }))
		}
		var stored User
		require.NoError(t, DB.First(&stored, u.Id).Error)
		assert.Equal(t, 123, stored.Quota, "credit is automatic normal wallet quota, without a claim or review")
	}
	third := &User{Username: "third", RegisterSource: RegisterSourceOAuth, RegisterIp: "192.0.2.1"}
	require.Error(t, third.Insert(0))
	assert.Error(t, CheckRegistrationEmail("test@sub.disposable.example"))
	assert.NoError(t, CheckRegistrationEmail("test@notdisposable.example"))
	require.NoError(t, TakeRegistrationRiskSlot(DB, "mail", common.EmailRiskIdentity("a.b+tag@gmail.com"), 2, 3600))
	require.NoError(t, TakeRegistrationRiskSlot(DB, "mail", common.EmailRiskIdentity("ab@googlemail.com"), 2, 3600))
	require.Error(t, TakeRegistrationRiskSlot(DB, "mail", "ab@gmail.com", 2, 3600))
	require.NoError(t, DB.Model(&RegistrationRiskCounter{}).Where("expires_at > ?", 0).Update("expires_at", 1).Error)
	require.NoError(t, TakeRegistrationRiskSlot(DB, "mail", "ab@gmail.com", 2, 3600))
	require.NoError(t, TakeRegistrationRiskSlot(DB, "mail", "ab@gmail.com", 2, 3600))
	require.Error(t, TakeRegistrationRiskSlot(DB, "mail", "ab@gmail.com", 2, 3600))
	assert.Equal(t, RegistrationRiskNetwork("2001:db8:1::1"), RegistrationRiskNetwork("2001:db8:1::2"))
}
