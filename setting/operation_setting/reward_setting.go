package operation_setting

import "github.com/dev-fan-sophon/boxai/setting/config"

// RewardSetting controls the first-party Rewards ledger and claim links.
type RewardSetting struct {
	Enabled             bool `json:"enabled"`
	RequireVerified     bool `json:"require_verified"`
	ExpirePendingDays   int  `json:"expire_pending_days"`
	MinRedeemQuota      int  `json:"min_redeem_quota"`
	DefaultPerUserLimit int  `json:"default_per_user_limit"`
}

var rewardSetting = RewardSetting{
	Enabled:             false,
	RequireVerified:     false,
	ExpirePendingDays:   0,
	MinRedeemQuota:      0,
	DefaultPerUserLimit: 1,
}

func init() {
	config.GlobalConfig.Register("reward_setting", &rewardSetting)
}

func GetRewardSetting() *RewardSetting {
	return &rewardSetting
}

func IsRewardEnabled() bool {
	return rewardSetting.Enabled
}

func RewardMinRedeemQuota() int {
	if rewardSetting.MinRedeemQuota > 0 {
		return rewardSetting.MinRedeemQuota
	}
	return 0
}
