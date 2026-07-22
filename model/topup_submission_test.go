package model

import (
	"fmt"
	"testing"

	"github.com/QuantumNous/new-api/common"
	"github.com/glebarez/sqlite"
	"github.com/stretchr/testify/assert"
	"github.com/stretchr/testify/require"
	"gorm.io/gorm"
)

func setupTopUpSubmissionTestDB(t *testing.T) {
	t.Helper()
	oldDB, oldQuota := DB, common.QuotaPerUnit
	db, err := gorm.Open(sqlite.Open("file:"+t.Name()+"?mode=memory&cache=shared"), &gorm.Config{})
	require.NoError(t, err)
	require.NoError(t, db.AutoMigrate(&User{}, &TopUp{}, &SubscriptionPlan{}, &SubscriptionOrder{}, &UserSubscription{}, &TopUpSubmission{}))
	DB, common.QuotaPerUnit = db, 100
	t.Cleanup(func() { DB, common.QuotaPerUnit = oldDB, oldQuota })
}

func TestTopUpSubmissionOwnershipRetryAndBalanceIdempotency(t *testing.T) {
	setupTopUpSubmissionTestDB(t)
	require.NoError(t, DB.Create(&User{Id: 1, Username: "owner", AffCode: "owner-aff"}).Error)
	require.NoError(t, DB.Create(&User{Id: 2, Username: "other", AffCode: "other-aff"}).Error)
	require.NoError(t, DB.Create(&TopUp{UserId: 1, TradeNo: "BAL1", Amount: 10, PaymentMethod: PaymentMethodBankQR, PaymentProvider: PaymentProviderBankQR, Status: common.TopUpStatusPending}).Error)

	err := CreateTopUpSubmission(&TopUpSubmission{UserId: 2, TradeNo: "BAL1", BankTransactionNo: "wrong"})
	require.ErrorContains(t, err, "does not belong")
	first := &TopUpSubmission{UserId: 1, TradeNo: "BAL1", BankTransactionNo: "bank-1"}
	require.NoError(t, CreateTopUpSubmission(first))
	require.ErrorContains(t, CreateTopUpSubmission(&TopUpSubmission{UserId: 1, TradeNo: "BAL1", BankTransactionNo: "duplicate"}), "active")
	_, err = ReviewTopUpSubmission(first.Id, 99, false, "unreadable")
	require.NoError(t, err)
	require.NoError(t, DB.Create(&TopUp{UserId: 1, TradeNo: "BAL-RETRY", Amount: 10, PaymentMethod: PaymentMethodBankQR, PaymentProvider: PaymentProviderBankQR, Status: common.TopUpStatusPending}).Error)
	require.NoError(t, CreateTopUpSubmission(&TopUpSubmission{UserId: 1, TradeNo: "BAL-RETRY", BankTransactionNo: "BANK-1"}))
	second := &TopUpSubmission{UserId: 1, TradeNo: "BAL1", BankTransactionNo: "bank-2"}
	require.NoError(t, CreateTopUpSubmission(second))
	require.NoError(t, DB.Create(&TopUp{UserId: 1, TradeNo: "BAL2", Amount: 10, PaymentMethod: PaymentMethodBankQR, PaymentProvider: PaymentProviderBankQR, Status: common.TopUpStatusPending}).Error)
	require.ErrorContains(t, CreateTopUpSubmission(&TopUpSubmission{UserId: 1, TradeNo: "BAL2", BankTransactionNo: "bank-2"}), "already been submitted")
	_, err = ReviewTopUpSubmission(second.Id, 99, true, "")
	require.NoError(t, err)
	_, err = ReviewTopUpSubmission(second.Id, 99, true, "")
	require.NoError(t, err)
	var user User
	require.NoError(t, DB.First(&user, 1).Error)
	assert.Equal(t, 1000, user.Quota)
	var order TopUp
	require.NoError(t, DB.Where("trade_no = ?", "BAL1").First(&order).Error)
	assert.Equal(t, common.TopUpStatusSuccess, order.Status)
}

func TestTopUpSubmissionSubscriptionApprovalIsIdempotent(t *testing.T) {
	setupTopUpSubmissionTestDB(t)
	require.NoError(t, DB.Create(&User{Id: 1, Username: "owner", Group: "default", AffCode: "owner-aff"}).Error)
	plan := &SubscriptionPlan{Title: "Pro", PriceAmount: 5, Currency: "USD", DurationUnit: "month", DurationValue: 1, Enabled: true, TotalAmount: 1000}
	require.NoError(t, DB.Create(plan).Error)
	payload, err := common.Marshal(BankQRSubscriptionOrderPayload{Version: 1, Amount: 125000, Currency: "VND", Plan: *plan})
	require.NoError(t, err)
	require.NoError(t, DB.Create(&SubscriptionOrder{UserId: 1, PlanId: plan.Id, Money: 5, TradeNo: "SUB1", PaymentMethod: PaymentMethodBankQR, PaymentProvider: PaymentProviderBankQR, ProviderPayload: string(payload), Status: common.TopUpStatusPending}).Error)
	require.NoError(t, DB.Model(plan).Update("total_amount", 2000).Error)
	submission := &TopUpSubmission{UserId: 1, TradeNo: "SUB1", BankTransactionNo: "bank-sub"}
	require.NoError(t, CreateTopUpSubmission(submission))
	_, err = ReviewTopUpSubmission(submission.Id, 99, true, "")
	require.NoError(t, err)
	_, err = ReviewTopUpSubmission(submission.Id, 99, true, "")
	require.NoError(t, err)
	var count int64
	require.NoError(t, DB.Model(&UserSubscription{}).Where("user_id = ? AND plan_id = ?", 1, plan.Id).Count(&count).Error)
	assert.EqualValues(t, 1, count)
	var subscription UserSubscription
	require.NoError(t, DB.Where("user_id = ? AND plan_id = ?", 1, plan.Id).First(&subscription).Error)
	assert.EqualValues(t, 1000, subscription.AmountTotal)
	var order SubscriptionOrder
	require.NoError(t, DB.Where("trade_no = ?", "SUB1").First(&order).Error)
	assert.Equal(t, common.TopUpStatusSuccess, order.Status)
}

func TestTopUpSubmissionApprovalRejectsCumulativeQuotaOverflow(t *testing.T) {
	setupTopUpSubmissionTestDB(t)
	require.NoError(t, DB.Create(&User{Id: 1, Username: "owner", AffCode: "owner-aff", Quota: common.MaxQuota - 999}).Error)
	require.NoError(t, DB.Create(&TopUp{UserId: 1, TradeNo: "OVERFLOW", Amount: 10, PaymentMethod: PaymentMethodBankQR, PaymentProvider: PaymentProviderBankQR, Status: common.TopUpStatusPending}).Error)
	submission := &TopUpSubmission{UserId: 1, TradeNo: "OVERFLOW", BankTransactionNo: "overflow-bank"}
	require.NoError(t, CreateTopUpSubmission(submission))

	_, err := ReviewTopUpSubmission(submission.Id, 99, true, "")
	require.ErrorContains(t, err, "exceed maximum")

	var user User
	require.NoError(t, DB.First(&user, 1).Error)
	assert.Equal(t, common.MaxQuota-999, user.Quota)
	var order TopUp
	require.NoError(t, DB.Where("trade_no = ?", "OVERFLOW").First(&order).Error)
	assert.Equal(t, common.TopUpStatusPending, order.Status)
	var storedSubmission TopUpSubmission
	require.NoError(t, DB.First(&storedSubmission, submission.Id).Error)
	assert.Equal(t, TopUpSubmissionSubmitted, storedSubmission.Status)
	assert.Zero(t, storedSubmission.ReviewedAt)
	assert.Zero(t, storedSubmission.ReviewedBy)
	assert.NotNil(t, storedSubmission.ActiveBankTransactionKey)
}

func TestBankQRPerUserPendingOrderAndProofStorageLimits(t *testing.T) {
	setupTopUpSubmissionTestDB(t)
	require.NoError(t, DB.Create(&User{Id: 1, Username: "owner", AffCode: "owner-aff"}).Error)
	now := common.GetTimestamp()
	for i := 0; i < 10; i++ {
		require.NoError(t, DB.Create(&TopUp{UserId: 1, TradeNo: fmt.Sprintf("PENDING-%d", i), PaymentMethod: PaymentMethodBankQR, PaymentProvider: PaymentProviderBankQR, Status: common.TopUpStatusPending, CreateTime: now}).Error)
	}
	err := CreatePendingBankQRTopUp(&TopUp{UserId: 1, TradeNo: "PENDING-OVERFLOW", PaymentMethod: PaymentMethodBankQR, PaymentProvider: PaymentProviderBankQR, Status: common.TopUpStatusPending}, 10)
	require.ErrorContains(t, err, "too many pending")

	require.NoError(t, DB.Model(&TopUp{}).Where("user_id = ?", 1).Update("create_time", now-BankQRPendingOrderWindowSeconds-1).Error)
	require.NoError(t, CreatePendingBankQRTopUp(&TopUp{UserId: 1, TradeNo: "PENDING-AFTER-WINDOW", PaymentMethod: PaymentMethodBankQR, PaymentProvider: PaymentProviderBankQR, Status: common.TopUpStatusPending}, 10))

	require.NoError(t, DB.Create(&User{Id: 2, Username: "proof-owner", AffCode: "proof-owner-aff"}).Error)
	require.NoError(t, DB.Create(&TopUp{UserId: 2, TradeNo: "PROOF-LIMIT", PaymentMethod: PaymentMethodBankQR, PaymentProvider: PaymentProviderBankQR, Status: common.TopUpStatusPending}).Error)
	require.NoError(t, DB.Create(&TopUpSubmission{UserId: 2, TradeNo: "OLD-PROOF", OrderType: TopUpSubmissionOrderBalance, Status: TopUpSubmissionRejected, ProofSize: MaxTopUpProofBytesPerUser}).Error)
	err = CreateTopUpSubmission(&TopUpSubmission{UserId: 2, TradeNo: "PROOF-LIMIT", ProofSize: 1, ProofStorageKey: "topup-proofs/2/test.png"})
	require.ErrorContains(t, err, "storage limit")
}
