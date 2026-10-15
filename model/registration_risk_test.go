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
	assert.Error(t, CheckRegistrationEmail("test@sub.disposable.example", RegisterSourcePassword))
	assert.NoError(t, CheckRegistrationEmail("test@notdisposable.example", RegisterSourcePassword))
	require.NoError(t, TakeRegistrationRiskSlot(DB, "mail", common.EmailRiskIdentity("a.b+tag@gmail.com"), 2, 3600))
	require.NoError(t, TakeRegistrationRiskSlot(DB, "mail", common.EmailRiskIdentity("ab@googlemail.com"), 2, 3600))
	require.Error(t, TakeRegistrationRiskSlot(DB, "mail", "ab@gmail.com", 2, 3600))
	require.NoError(t, DB.Model(&RegistrationRiskCounter{}).Where("expires_at > ?", 0).Update("expires_at", 1).Error)
	require.NoError(t, TakeRegistrationRiskSlot(DB, "mail", "ab@gmail.com", 2, 3600))
	require.NoError(t, TakeRegistrationRiskSlot(DB, "mail", "ab@gmail.com", 2, 3600))
	require.Error(t, TakeRegistrationRiskSlot(DB, "mail", "ab@gmail.com", 2, 3600))
	assert.Equal(t, RegistrationRiskNetwork("2001:db8:1::1"), RegistrationRiskNetwork("2001:db8:1::2"))
}

func TestRegistrationRiskEmailDomainReputation(t *testing.T) {
	setupUserUpdateTestState(t)
	require.NoError(t, DB.AutoMigrate(&RegistrationRiskCounter{}))
	require.NoError(t, DB.Where("1 = 1").Delete(&RegistrationRiskCounter{}).Error)
	old, err := common.Marshal(operation_setting.GetRegistrationRiskPolicy())
	require.NoError(t, err)
	t.Cleanup(func() { require.NoError(t, operation_setting.SetRegistrationRiskPolicy(string(old))) })

	// Rejecting untrusted domains without a trusted list would reject every
	// signup, and one domain cannot be both blocked and trusted.
	_, err = operation_setting.ParseRegistrationRiskPolicy(`{"enabled":true,"registration_ip_daily":20,"email_ip_hourly":10,"email_identity_hourly":3,"reject_untrusted_oauth_email":true}`)
	assert.Error(t, err)
	_, err = operation_setting.ParseRegistrationRiskPolicy(`{"enabled":true,"registration_ip_daily":20,"email_ip_hourly":10,"email_identity_hourly":3,"blocked_email_domains":["dup.example"],"trusted_email_domains":["dup.example"]}`)
	assert.Error(t, err)

	policy := `{"enabled":true,"registration_ip_daily":20,"email_ip_hourly":10,"email_identity_hourly":3,"blocked_email_domains":["blocked.example"],"trusted_email_domains":["trusted.example"],"reject_untrusted_oauth_email":true,"reject_untrusted_password_email":false}`
	require.NoError(t, operation_setting.SetRegistrationRiskPolicy(policy))
	assert.Equal(t, EmailDomainTrusted, EmailDomainReputationFor("trusted.example"))
	assert.Equal(t, EmailDomainTrusted, EmailDomainReputationFor("mail.trusted.example"))
	assert.Equal(t, EmailDomainBlocked, EmailDomainReputationFor("sub.blocked.example"))
	assert.Equal(t, EmailDomainUntrusted, EmailDomainReputationFor("self-owned.example"))

	cases := []struct {
		name   string
		email  string
		source string
	}{
		{"trusted provider on oauth", "user@trusted.example", "oauth:google"},
		{"trusted provider subdomain on oauth", "user@mail.trusted.example", "oauth:google"},
		{"untrusted domain on password", "user@self-owned.example", RegisterSourcePassword},
		{"no email on phone-based oauth", "", "oauth:zalo"},
	}
	for _, tc := range cases {
		assert.NoError(t, CheckRegistrationEmail(tc.email, tc.source), tc.name)
	}
	assert.Error(t, CheckRegistrationEmail("user@blocked.example", "oauth:google"))
	assert.Error(t, CheckRegistrationEmail("user@sub.blocked.example", RegisterSourcePassword))
	assert.Error(t, CheckRegistrationEmail("user@self-owned.example", "oauth:google"), "self-owned oauth domain is rejected")

	// The source decides: the same untrusted address registers with a password
	// (mailbox verified) and is refused through OAuth, at the insert boundary.
	oauthUser := &User{Username: "reputation-oauth", Email: "person@self-owned.example", RegisterSource: "oauth:google", RegisterIp: "192.0.2.9"}
	assert.Error(t, oauthUser.Insert(0))
	passwordUser := &User{Username: "reputation-password", Email: "person@self-owned.example", RegisterSource: RegisterSourcePassword, RegisterIp: "192.0.2.9"}
	require.NoError(t, passwordUser.Insert(0))

	require.NoError(t, operation_setting.SetRegistrationRiskPolicy(`{"enabled":true,"registration_ip_daily":20,"email_ip_hourly":10,"email_identity_hourly":3,"blocked_email_domains":[],"trusted_email_domains":["trusted.example"],"reject_untrusted_oauth_email":true,"reject_untrusted_password_email":true}`))
	assert.Error(t, CheckRegistrationEmail("user@self-owned.example", RegisterSourcePassword))
	assert.NoError(t, CheckRegistrationEmail("user@trusted.example", RegisterSourcePassword))
}
