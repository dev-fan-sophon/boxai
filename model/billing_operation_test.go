package model

import (
	"fmt"
	"sync"
	"testing"
	"time"

	"github.com/glebarez/sqlite"
	"github.com/stretchr/testify/require"
	"gorm.io/gorm"
)

type legacyUserSubscription struct {
	ID          int `gorm:"primaryKey"`
	UserID      int
	AmountTotal int64
	AmountUsed  int64
	Status      string
	EndTime     int64
}

func (legacyUserSubscription) TableName() string { return "user_subscriptions" }

type legacySubscriptionPreConsumeRecord struct {
	ID                 int `gorm:"primaryKey"`
	RequestID          string
	UserID             int
	UserSubscriptionID int
	PreConsumed        int64
	Status             string
}

func (legacySubscriptionPreConsumeRecord) TableName() string {
	return "subscription_pre_consume_records"
}

type legacyBillingOperation struct {
	ID             int64 `gorm:"primaryKey"`
	IdempotencyKey string
	Kind           string
	UserID         int
	TokenID        int
	SubscriptionID int
	BillingSource  string
	Delta          int
	ChargedQuota   int
	ReferenceKey   string
	State          string
}

func (legacyBillingOperation) TableName() string { return "billing_operations" }

type legacyMidjourney struct {
	ID             int `gorm:"primaryKey"`
	UserID         int
	SubscriptionID int
	BillingSource  string
	Quota          int
}

func (legacyMidjourney) TableName() string { return "midjourneys" }

func TestBillingOperationConcurrentInitialIsConditionalAndIdempotent(t *testing.T) {
	truncateTables(t)
	require.NoError(t, DB.AutoMigrate(&BillingOperation{}))
	user := User{Username: "billing-concurrent", Quota: 10}
	require.NoError(t, DB.Create(&user).Error)
	token := Token{UserId: user.Id, Key: "billing-concurrent-token", RemainQuota: 10}
	require.NoError(t, DB.Create(&token).Error)

	var wg sync.WaitGroup
	successes := 0
	var mu sync.Mutex
	for i := 0; i < 2; i++ {
		wg.Add(1)
		go func(index int) {
			defer wg.Done()
			_, _, err := ApplyBillingOperation(BillingOperationInput{IdempotencyKey: fmt.Sprintf("create-%d", index), Kind: BillingOperationInitial, UserID: user.Id, TokenID: token.Id, BillingSource: "wallet", Delta: 7, ChargedQuota: 7})
			if err == nil {
				mu.Lock()
				successes++
				mu.Unlock()
			}
		}(i)
	}
	wg.Wait()
	require.Equal(t, 1, successes)
	require.NoError(t, DB.First(&user, user.Id).Error)
	require.NoError(t, DB.First(&token, token.Id).Error)
	require.Equal(t, 3, user.Quota)
	require.Equal(t, 3, token.RemainQuota)

	_, applied, err := ApplyBillingOperation(BillingOperationInput{IdempotencyKey: "create-0", Kind: BillingOperationInitial, UserID: user.Id, TokenID: token.Id, BillingSource: "wallet", Delta: 7, ChargedQuota: 7})
	if err == nil { // create-0 may be the winning concurrent key
		require.False(t, applied)
	}
}

func TestBillingOperationMissingTokenRollsBackFunding(t *testing.T) {
	truncateTables(t)
	require.NoError(t, DB.AutoMigrate(&BillingOperation{}))
	user := User{Username: "billing-rollback", Quota: 10}
	require.NoError(t, DB.Create(&user).Error)
	_, _, err := ApplyBillingOperation(BillingOperationInput{IdempotencyKey: "missing-token", Kind: BillingOperationInitial, UserID: user.Id, TokenID: 99999, BillingSource: "wallet", Delta: 4, ChargedQuota: 4})
	require.Error(t, err)
	require.NoError(t, DB.First(&user, user.Id).Error)
	require.Equal(t, 10, user.Quota)
	var count int64
	require.NoError(t, DB.Model(&BillingOperation{}).Where("idempotency_key = ?", "missing-token").Count(&count).Error)
	require.Zero(t, count)
}

func TestBillingOperationDoesNotSettleOrRefundIntoANewerSubscriptionPeriod(t *testing.T) {
	truncateTables(t)
	require.NoError(t, DB.AutoMigrate(&BillingOperation{}))
	user := User{Username: "period-boundary"}
	require.NoError(t, DB.Create(&user).Error)
	subscription := UserSubscription{UserId: user.Id, AmountTotal: 1000, AmountUsed: 100, UsageGeneration: 1, Status: "active", EndTime: time.Now().Add(time.Hour).Unix()}
	require.NoError(t, DB.Create(&subscription).Error)

	initial, _, err := ApplyBillingOperation(BillingOperationInput{
		IdempotencyKey: "period-initial", Kind: BillingOperationInitial, UserID: user.Id,
		SubscriptionID: subscription.Id, SubscriptionUsageGeneration: 1,
		BillingSource: "subscription", ChargedQuota: 100, ReferenceKey: "period-initial",
	})
	require.NoError(t, err)
	require.EqualValues(t, 1, initial.SubscriptionUsageGeneration)
	require.NoError(t, DB.Model(&subscription).Updates(map[string]any{"amount_used": 60, "usage_generation": 2}).Error)

	_, applied, err := ApplyBillingOperation(BillingOperationInput{
		IdempotencyKey: "period-settle", Kind: BillingOperationSettle, UserID: user.Id,
		SubscriptionID: subscription.Id, SubscriptionUsageGeneration: initial.SubscriptionUsageGeneration,
		BillingSource: "subscription", Delta: 50, ChargedQuota: 150, ReferenceKey: initial.IdempotencyKey,
	})
	require.NoError(t, err)
	require.True(t, applied)
	_, applied, err = ApplyBillingOperation(BillingOperationInput{
		IdempotencyKey: "period-refund", Kind: BillingOperationRefund, UserID: user.Id,
		SubscriptionID: subscription.Id, SubscriptionUsageGeneration: initial.SubscriptionUsageGeneration,
		BillingSource: "subscription", Delta: -100, ReferenceKey: initial.IdempotencyKey,
	})
	require.NoError(t, err)
	require.True(t, applied)

	require.NoError(t, DB.First(&subscription, subscription.Id).Error)
	require.EqualValues(t, 60, subscription.AmountUsed)
	require.EqualValues(t, 2, subscription.UsageGeneration)
}

func TestBillingOperationResetsADueSubscriptionBeforeFreshReservation(t *testing.T) {
	truncateTables(t)
	require.NoError(t, DB.AutoMigrate(&BillingOperation{}))
	now := GetDBTimestamp()
	user := User{Username: "due-period-boundary"}
	require.NoError(t, DB.Create(&user).Error)
	plan := SubscriptionPlan{Title: "Daily", DurationUnit: SubscriptionDurationMonth, DurationValue: 1, TotalAmount: 100, QuotaResetPeriod: SubscriptionResetDaily}
	require.NoError(t, DB.Create(&plan).Error)
	subscription := UserSubscription{
		UserId: user.Id, PlanId: plan.Id, AmountTotal: 100, AmountUsed: 100, UsageGeneration: 1,
		Status: "active", StartTime: now - 2*24*3600, EndTime: now + 30*24*3600,
		LastResetTime: now - 24*3600 - 1, NextResetTime: now - 1,
	}
	require.NoError(t, DB.Create(&subscription).Error)

	operation, applied, err := ApplyBillingOperation(BillingOperationInput{
		IdempotencyKey: "fresh-due-reservation", Kind: BillingOperationInitial, UserID: user.Id,
		BillingSource: "subscription", Delta: 50, ChargedQuota: 50,
	})
	require.NoError(t, err)
	require.True(t, applied)
	require.NoError(t, DB.First(&subscription, subscription.Id).Error)
	require.EqualValues(t, 50, subscription.AmountUsed)
	require.EqualValues(t, 2, subscription.UsageGeneration)
	require.Equal(t, subscription.Id, operation.SubscriptionID)
	require.EqualValues(t, 2, operation.SubscriptionUsageGeneration)
}

func TestUsageGenerationMigrationFailsClosedForLegacyDurableRows(t *testing.T) {
	legacyDB, err := gorm.Open(sqlite.Open("file:"+t.Name()+"?mode=memory&cache=shared"), &gorm.Config{})
	require.NoError(t, err)
	require.NoError(t, legacyDB.AutoMigrate(&legacyUserSubscription{}, &legacySubscriptionPreConsumeRecord{}, &legacyBillingOperation{}, &legacyMidjourney{}))
	require.NoError(t, legacyDB.Create(&legacyUserSubscription{ID: 1, UserID: 1, AmountUsed: 60, AmountTotal: 1000, Status: "active", EndTime: 4102444800}).Error)
	require.NoError(t, legacyDB.Create(&legacySubscriptionPreConsumeRecord{ID: 1, RequestID: "legacy-preconsume", UserID: 1, UserSubscriptionID: 1, PreConsumed: 100, Status: "consumed"}).Error)
	require.NoError(t, legacyDB.Create(&legacyBillingOperation{ID: 1, IdempotencyKey: "legacy-initial", Kind: BillingOperationInitial, UserID: 1, SubscriptionID: 1, BillingSource: "subscription", ChargedQuota: 100, ReferenceKey: "legacy-initial", State: "committed"}).Error)
	require.NoError(t, legacyDB.Create(&legacyMidjourney{ID: 1, UserID: 1, SubscriptionID: 1, BillingSource: "subscription", Quota: 100}).Error)
	require.NoError(t, legacyDB.AutoMigrate(&UserSubscription{}, &SubscriptionPreConsumeRecord{}, &BillingOperation{}, &Midjourney{}))

	var subscription UserSubscription
	var preConsume SubscriptionPreConsumeRecord
	var initial BillingOperation
	var midjourney Midjourney
	require.NoError(t, legacyDB.First(&subscription, 1).Error)
	require.NoError(t, legacyDB.First(&preConsume, 1).Error)
	require.NoError(t, legacyDB.First(&initial, 1).Error)
	require.NoError(t, legacyDB.First(&midjourney, 1).Error)
	require.EqualValues(t, 1, subscription.UsageGeneration)
	require.EqualValues(t, UnknownSubscriptionUsageGeneration, preConsume.UsageGeneration)
	require.EqualValues(t, UnknownSubscriptionUsageGeneration, initial.SubscriptionUsageGeneration)
	require.EqualValues(t, UnknownSubscriptionUsageGeneration, midjourney.SubscriptionUsageGeneration)

	previousDB, previousLogDB := DB, LOG_DB
	DB, LOG_DB = legacyDB, legacyDB
	t.Cleanup(func() { DB, LOG_DB = previousDB, previousLogDB })
	require.NoError(t, RefundSubscriptionPreConsume(preConsume.RequestId))
	_, _, err = ApplyBillingOperation(BillingOperationInput{
		IdempotencyKey: "legacy-refund", Kind: BillingOperationRefund, UserID: 1,
		SubscriptionID: 1, SubscriptionUsageGeneration: initial.SubscriptionUsageGeneration,
		BillingSource: "subscription", Delta: -100, ReferenceKey: initial.IdempotencyKey,
	})
	require.NoError(t, err)
	require.NoError(t, legacyDB.First(&subscription, 1).Error)
	require.EqualValues(t, 60, subscription.AmountUsed)
}

func TestBillingOperationDelayedSubscriptionRefundStillUpdatesToken(t *testing.T) {
	truncateTables(t)
	require.NoError(t, DB.AutoMigrate(&BillingOperation{}))
	user := User{Username: "deleted-subscription"}
	require.NoError(t, DB.Create(&user).Error)
	token := Token{UserId: user.Id, Key: "deleted-sub-token", RemainQuota: 10, UsedQuota: 90}
	require.NoError(t, DB.Create(&token).Error)

	_, applied, err := ApplyBillingOperation(BillingOperationInput{
		IdempotencyKey: "deleted-sub-refund", Kind: BillingOperationRefund, UserID: user.Id, TokenID: token.Id,
		SubscriptionID: 999999, SubscriptionUsageGeneration: 1, BillingSource: "subscription", Delta: -40, ReferenceKey: "deleted-sub-initial",
	})
	require.NoError(t, err)
	require.True(t, applied)
	require.NoError(t, DB.First(&token, token.Id).Error)
	require.Equal(t, 50, token.RemainQuota)
	require.Equal(t, 50, token.UsedQuota)
}

func TestBillingOperationUnlimitedTokenDoesNotChangeTokenCounters(t *testing.T) {
	truncateTables(t)
	require.NoError(t, DB.AutoMigrate(&BillingOperation{}))
	user := User{Username: "unlimited-token", Quota: 100}
	require.NoError(t, DB.Create(&user).Error)
	token := Token{UserId: user.Id, Key: "unlimited-token-key", UnlimitedQuota: true, RemainQuota: 7, UsedQuota: 11}
	require.NoError(t, DB.Create(&token).Error)

	_, applied, err := ApplyBillingOperation(BillingOperationInput{IdempotencyKey: "unlimited", Kind: BillingOperationInitial, UserID: user.Id, TokenID: token.Id, BillingSource: "wallet", Delta: 30, ChargedQuota: 30, ReferenceKey: "unlimited"})
	require.NoError(t, err)
	require.True(t, applied)
	require.NoError(t, DB.First(&token, token.Id).Error)
	require.Equal(t, 7, token.RemainQuota)
	require.Equal(t, 11, token.UsedQuota)
}

func TestBillingOperationSetsLineageChargeToTargetIdempotently(t *testing.T) {
	truncateTables(t)
	require.NoError(t, DB.AutoMigrate(&BillingOperation{}))
	user := User{Username: "billing-target", Quota: 100}
	require.NoError(t, DB.Create(&user).Error)
	initial, _, err := ApplyBillingOperation(BillingOperationInput{
		IdempotencyKey: "target-initial", Kind: BillingOperationInitial, UserID: user.Id,
		BillingSource: "wallet", Delta: 30, ChargedQuota: 30, ReferenceKey: "target-initial",
	})
	require.NoError(t, err)

	input := BillingOperationInput{
		IdempotencyKey: "target-settle", Kind: BillingOperationSettle, UserID: user.Id,
		BillingSource: "wallet", ChargedQuota: 45, ReferenceKey: initial.IdempotencyKey,
		SetChargeToTarget: true,
	}
	operation, applied, err := ApplyBillingOperation(input)
	require.NoError(t, err)
	require.True(t, applied)
	require.Equal(t, 15, operation.Delta)
	_, applied, err = ApplyBillingOperation(input)
	require.NoError(t, err)
	require.False(t, applied)
	require.NoError(t, DB.First(&user, user.Id).Error)
	require.Equal(t, 55, user.Quota)
}

func TestBillingOperationRejectsWrongOwnerWithoutTreatingSubscriptionAsDeleted(t *testing.T) {
	truncateTables(t)
	require.NoError(t, DB.AutoMigrate(&BillingOperation{}))
	owner := User{Username: "subscription-owner", AffCode: "subscription-owner-aff"}
	other := User{Username: "subscription-other", AffCode: "subscription-other-aff"}
	require.NoError(t, DB.Create(&owner).Error)
	require.NoError(t, DB.Create(&other).Error)
	subscription := UserSubscription{UserId: owner.Id, AmountTotal: 100, AmountUsed: 50, UsageGeneration: 1, Status: "active", EndTime: time.Now().Add(time.Hour).Unix()}
	require.NoError(t, DB.Create(&subscription).Error)

	_, _, err := ApplyBillingOperation(BillingOperationInput{
		IdempotencyKey: "wrong-owner-refund", Kind: BillingOperationRefund, UserID: other.Id,
		SubscriptionID: subscription.Id, SubscriptionUsageGeneration: 1,
		BillingSource: "subscription", Delta: -10, ChargedQuota: 0, ReferenceKey: "missing-lineage",
	})
	require.ErrorContains(t, err, "does not belong")
	require.NoError(t, DB.First(&subscription, subscription.Id).Error)
	require.EqualValues(t, 50, subscription.AmountUsed)
	var count int64
	require.NoError(t, DB.Model(&BillingOperation{}).Where("idempotency_key = ?", "wrong-owner-refund").Count(&count).Error)
	require.Zero(t, count)
}
