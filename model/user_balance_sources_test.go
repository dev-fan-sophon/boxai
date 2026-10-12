package model

import (
	"testing"

	"github.com/dev-fan-sophon/boxai/common"
	"github.com/glebarez/sqlite"
	"github.com/stretchr/testify/assert"
	"github.com/stretchr/testify/require"
	"gorm.io/gorm"
)

func setupBalanceSourcesTest(t *testing.T) {
	t.Helper()
	previousDB, previousLogDB := DB, LOG_DB
	db, err := gorm.Open(sqlite.Open(":memory:"), &gorm.Config{})
	require.NoError(t, err)
	DB, LOG_DB = db, db
	require.NoError(t, db.AutoMigrate(&User{}, &TopUp{}, &SubscriptionOrder{}, &RewardLedger{}, &Redemption{}, &Checkin{}, &UserQuotaAdjustment{}, &Log{}))
	t.Cleanup(func() {
		DB, LOG_DB = previousDB, previousLogDB
		sqlDB, err := db.DB()
		require.NoError(t, err)
		require.NoError(t, sqlDB.Close())
	})
}

func TestBalanceSourcesSeparatePaymentsGiftsAndRefunds(t *testing.T) {
	setupBalanceSourcesTest(t)
	oldUnit := common.QuotaPerUnit
	common.QuotaPerUnit = 500000
	t.Cleanup(func() { common.QuotaPerUnit = oldUnit })
	orders := []TopUp{
		{UserId: 27, TradeNo: "paid", Status: common.TopUpStatusSuccess, Amount: 123, AmountUnit: TopUpAmountUnitUSDCent, Money: 1.23, PaymentMethod: "stripe", CompleteTime: 10},
		{UserId: 27, TradeNo: "gift", Status: common.TopUpStatusSuccess, Amount: 400, AmountUnit: TopUpAmountUnitQuota, Money: 0, CompleteTime: 11},
		{UserId: 27, TradeNo: "subscription", Status: common.TopUpStatusSuccess, Amount: 0, Money: 9, PaymentMethod: "stripe", CompleteTime: 12},
		{UserId: 27, TradeNo: "wallet", Status: common.TopUpStatusSuccess, Amount: 0, Money: 8, PaymentMethod: PaymentMethodBalance, CompleteTime: 15},
		{UserId: 27, TradeNo: "pending", Status: common.TopUpStatusPending, Amount: 99, Money: 99, CompleteTime: 20},
		{UserId: 270, TradeNo: "other", Status: common.TopUpStatusSuccess, Amount: 44, Money: 44, CompleteTime: 30},
	}
	require.NoError(t, DB.Create(&orders).Error)
	require.NoError(t, DB.Create(&SubscriptionOrder{UserId: 27, TradeNo: "subscription"}).Error)
	require.NoError(t, DB.Create(&[]RewardLedger{
		{UserId: 27, Type: RewardLedgerTypeClaim, Delta: 900, RefType: "campaign"},
		{UserId: 27, Type: RewardLedgerTypeRedeem, Delta: -600, RefType: "wallet", CreatedTime: 31},
		{UserId: 270, Type: RewardLedgerTypeRedeem, Delta: -800, RefType: "wallet"},
	}).Error)
	require.NoError(t, DB.Create(&Redemption{UsedUserId: 27, Status: common.RedemptionCodeStatusUsed, Quota: 17, Key: "used"}).Error)
	require.NoError(t, DB.Where("used_user_id = ?", 27).Delete(&Redemption{}).Error)
	require.NoError(t, DB.Create(&Checkin{UserId: 27, QuotaAwarded: 3, CheckinDate: "2026-10-12"}).Error)
	require.NoError(t, DB.Create(&User{Id: 27, Username: "funding", Quota: 100}).Error)
	_, err := AdjustUserQuota(27, 1, "add", 30)
	require.NoError(t, err)
	_, err = AdjustUserQuota(27, 2, "override", 90)
	require.NoError(t, err)
	require.NoError(t, DB.Create(&[]Log{
		{UserId: 27, Type: LogTypeRefund, Quota: 9999},
		{UserId: 27, Type: LogTypeSystem, Content: "Registration gift (historical currency)"},
		{UserId: 1, Type: LogTypeManage, Content: "Administrator credit", Other: `{"op":{"action":"user.quota_add","params":{"target_user_id":27}}}`},
		{UserId: 1, Type: LogTypeManage, Content: "Other customer", Other: `{"op":{"action":"user.quota_add","params":{"target_user_id":270}}}`},
		{UserId: 27, Type: LogTypeManage, Content: "Adjustment to somebody else", Other: `{"op":{"action":"user.quota_add","params":{"target_user_id":28}}}`},
	}).Error)
	result, err := GetUserBalanceSources(27)
	require.NoError(t, err)
	assert.Equal(t, int64(2), result.PaidOrderCount)
	assert.Equal(t, int64(12), result.LastPaidAt)
	got := map[string]int64{}
	for _, source := range result.Sources {
		got[source.Source] = source.Quota
	}
	assert.Equal(t, map[string]int64{"paid_topup": 615000, "reward_transfer": 600, "redemption": 17, "checkin": 3, "admin_credit": 30, "admin_debit": 40}, got)
	require.Len(t, result.Adjustments, 2)
	assert.Equal(t, 2, result.Adjustments[0].OperatorID)
	assert.Equal(t, int64(-40), result.Adjustments[0].Delta)
	require.Len(t, result.HistoricalEvidence, 2)
	assert.Equal(t, "Administrator credit", result.HistoricalEvidence[0].Content)
	assert.Equal(t, 1, result.HistoricalEvidence[0].OperatorID)
	assert.False(t, result.EvidenceUnavailable)
	empty, err := GetUserBalanceSources(999)
	require.NoError(t, err)
	assert.Zero(t, empty.PaidOrderCount)
	assert.Empty(t, empty.Adjustments)
	assert.Empty(t, empty.HistoricalEvidence)
	for _, source := range empty.Sources {
		assert.Zero(t, source.Quota)
		assert.Zero(t, source.Count)
	}
	// Missing log storage cannot turn missing evidence into a zero paid balance.
	require.NoError(t, DB.Migrator().DropTable(&Log{}))
	result, err = GetUserBalanceSources(27)
	require.NoError(t, err)
	assert.True(t, result.EvidenceUnavailable)
	assert.Equal(t, int64(2), result.PaidOrderCount)
}

func TestAdminAdjustmentAtomicHistoryAndBounds(t *testing.T) {
	setupBalanceSourcesTest(t)
	require.NoError(t, DB.Create(&User{Id: 7, Username: "adjustment", Quota: 45}).Error)
	entry, err := AdjustUserQuota(7, 1, "subtract", 12)
	require.NoError(t, err)
	assert.Equal(t, 45, entry.BalanceBefore)
	assert.Equal(t, 33, entry.BalanceAfter)
	for _, input := range []struct {
		mode  string
		value int
	}{{"add", common.MaxQuota}, {"subtract", -1}, {"invalid", 12}} {
		_, err = AdjustUserQuota(7, 1, input.mode, input.value)
		require.Error(t, err)
	}
	_, err = AdjustUserQuota(7, 1, "override", 33)
	require.NoError(t, err)
	var count int64
	require.NoError(t, DB.Model(&UserQuotaAdjustment{}).Count(&count).Error)
	assert.Equal(t, int64(1), count)
	// A history write failure must roll back the credit itself.
	require.NoError(t, DB.Migrator().DropTable(&UserQuotaAdjustment{}))
	_, err = AdjustUserQuota(7, 1, "add", 19)
	require.Error(t, err)
	var user User
	require.NoError(t, DB.First(&user, 7).Error)
	assert.Equal(t, 33, user.Quota)
}
