package model

import (
	"sync"
	"testing"

	"github.com/dev-fan-sophon/boxai/common"
	"github.com/dev-fan-sophon/boxai/setting/operation_setting"
	"github.com/stretchr/testify/assert"
	"github.com/stretchr/testify/require"
	"gorm.io/gorm"
)

func enableRewardsForTest(t *testing.T) {
	t.Helper()
	setting := operation_setting.GetRewardSetting()
	original := *setting
	setting.Enabled = true
	setting.MinRedeemQuota = 1
	t.Cleanup(func() { *setting = original })
}

func resetRewardTables(t *testing.T) {
	t.Helper()
	require.NoError(t, DB.AutoMigrate(&User{}, &RewardCampaign{}, &RewardClaim{}, &RewardLedger{}))
	require.NoError(t, DB.Session(&gorm.Session{AllowGlobalUpdate: true}).Unscoped().Delete(&RewardLedger{}).Error)
	require.NoError(t, DB.Session(&gorm.Session{AllowGlobalUpdate: true}).Unscoped().Delete(&RewardClaim{}).Error)
	require.NoError(t, DB.Session(&gorm.Session{AllowGlobalUpdate: true}).Unscoped().Delete(&RewardCampaign{}).Error)
}

func createRewardUser(t *testing.T, username string) User {
	t.Helper()
	user := User{
		Username: username,
		Password: "password",
		Status:   common.UserStatusEnabled,
		AffCode:  username,
		Email:    username + "@example.com",
	}
	require.NoError(t, DB.Create(&user).Error)
	t.Cleanup(func() {
		_ = DB.Unscoped().Delete(&User{}, user.Id).Error
	})
	return user
}

func TestNormalizeRewardSlug(t *testing.T) {
	slug, err := NormalizeRewardSlug("  Welcome-2026  ")
	require.NoError(t, err)
	assert.Equal(t, "welcome-2026", slug)

	_, err = NormalizeRewardSlug("bad slug")
	require.ErrorIs(t, err, ErrRewardInvalidSlug)
}

func TestClaimRewardCampaignCreditsPendingBalance(t *testing.T) {
	resetQuotaReserveTestState(t)
	resetRewardTables(t)
	enableRewardsForTest(t)

	user := createRewardUser(t, "reward-claim-ok")
	campaign := &RewardCampaign{
		Slug:         "welcome-claim",
		Name:         "Welcome",
		Status:       RewardCampaignStatusEnabled,
		Quota:        189610,
		PerUserLimit: 1,
	}
	require.NoError(t, campaign.Insert())

	claim, err := ClaimRewardCampaign(user.Id, "welcome-claim", "127.0.0.1", "test")
	require.NoError(t, err)
	assert.Equal(t, 189610, claim.Quota)

	summary, err := GetUserRewardSummary(user.Id)
	require.NoError(t, err)
	assert.Equal(t, 189610, summary.RewardQuota)
	assert.Equal(t, 189610, summary.RewardHistory)

	var stored User
	require.NoError(t, DB.First(&stored, user.Id).Error)
	assert.Equal(t, 0, stored.Quota)
	assert.Equal(t, 189610, stored.RewardQuota)
}

func TestClaimRewardCampaignRejectsSecondClaim(t *testing.T) {
	resetQuotaReserveTestState(t)
	resetRewardTables(t)
	enableRewardsForTest(t)

	user := createRewardUser(t, "reward-claim-twice")
	campaign := &RewardCampaign{
		Slug:         "once-only",
		Name:         "Once",
		Status:       RewardCampaignStatusEnabled,
		Quota:        1000,
		PerUserLimit: 1,
	}
	require.NoError(t, campaign.Insert())
	_, err := ClaimRewardCampaign(user.Id, "once-only", "", "")
	require.NoError(t, err)
	_, err = ClaimRewardCampaign(user.Id, "once-only", "", "")
	require.ErrorIs(t, err, ErrRewardAlreadyClaimed)
}

func TestClaimRewardCampaignEnforcesInventory(t *testing.T) {
	resetQuotaReserveTestState(t)
	resetRewardTables(t)
	enableRewardsForTest(t)

	first := createRewardUser(t, "reward-stock-a")
	second := createRewardUser(t, "reward-stock-b")
	campaign := &RewardCampaign{
		Slug:         "limited",
		Name:         "Limited",
		Status:       RewardCampaignStatusEnabled,
		Quota:        1000,
		MaxClaims:    1,
		PerUserLimit: 1,
	}
	require.NoError(t, campaign.Insert())
	_, err := ClaimRewardCampaign(first.Id, "limited", "", "")
	require.NoError(t, err)
	_, err = ClaimRewardCampaign(second.Id, "limited", "", "")
	require.ErrorIs(t, err, ErrRewardSoldOut)
}

func TestRedeemRewardQuotaMovesToWallet(t *testing.T) {
	resetQuotaReserveTestState(t)
	resetRewardTables(t)
	enableRewardsForTest(t)

	user := createRewardUser(t, "reward-redeem-ok")
	require.NoError(t, DB.Model(&user).Updates(map[string]interface{}{
		"reward_quota":   2000,
		"reward_history": 2000,
	}).Error)

	require.NoError(t, RedeemRewardQuota(user.Id, 1500))

	var stored User
	require.NoError(t, DB.First(&stored, user.Id).Error)
	assert.Equal(t, 1500, stored.Quota)
	assert.Equal(t, 500, stored.RewardQuota)
}

func TestRedeemRewardQuotaRejectsConcurrentOverspend(t *testing.T) {
	resetQuotaReserveTestState(t)
	resetRewardTables(t)
	enableRewardsForTest(t)

	user := createRewardUser(t, "reward-redeem-race")
	require.NoError(t, DB.Model(&user).Updates(map[string]interface{}{
		"reward_quota":   100,
		"reward_history": 100,
	}).Error)

	const attempts = 2
	start := make(chan struct{})
	errs := make(chan error, attempts)
	var wait sync.WaitGroup
	for range attempts {
		wait.Add(1)
		go func() {
			defer wait.Done()
			<-start
			errs <- RedeemRewardQuota(user.Id, 60)
		}()
	}
	close(start)
	wait.Wait()
	close(errs)

	succeeded := 0
	for err := range errs {
		if err == nil {
			succeeded++
		}
	}
	assert.Equal(t, 1, succeeded)

	var stored User
	require.NoError(t, DB.First(&stored, user.Id).Error)
	assert.Equal(t, 60, stored.Quota)
	assert.Equal(t, 40, stored.RewardQuota)
}

func TestPublicRewardCampaignHidesInternalInventoryWhenUnlimited(t *testing.T) {
	resetRewardTables(t)
	enableRewardsForTest(t)
	campaign := &RewardCampaign{
		Slug:   "open-link",
		Name:   "Open",
		Status: RewardCampaignStatusEnabled,
		Quota:  1000,
	}
	require.NoError(t, campaign.Insert())
	public := campaign.ToPublic()
	assert.Equal(t, "active", public.Status)
	assert.Nil(t, public.RemainingClaims)
}
