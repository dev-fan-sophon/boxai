package model

import (
	"testing"

	"github.com/dev-fan-sophon/boxai/common"
	"github.com/stretchr/testify/assert"
	"github.com/stretchr/testify/require"
)

func sePayFixture(t *testing.T) (TopUp, SePayTransfer) {
	t.Helper()
	setupTopUpSubmissionTestDB(t)
	require.NoError(t, DB.AutoMigrate(&SePayEvent{}))
	require.NoError(t, DB.Create(&User{Id: 1, Username: "sepay", AffCode: "sepay"}).Error)
	order := TopUp{UserId: 1, TradeNo: "BOX123456789ABC", Amount: 1000, AmountUnit: TopUpAmountUnitUSDCent, PaymentMethod: PaymentMethodBankQR, PaymentProvider: PaymentProviderBankQR, Status: common.TopUpStatusPending,
		SePaySnapshot:         SePaySnapshot{AutomaticConfirmation: true, SePayGateway: "MBBank", SePayAccount: "12345"},
		TopUpDiscountSnapshot: TopUpDiscountSnapshot{FaceAmount: 100000, PaidAmount: 90000, ExpiresAt: common.GetTimestamp() + 3600}}
	require.NoError(t, DB.Create(&order).Error)
	return order, SePayTransfer{ID: 123, Gateway: "MBBank", AccountNumber: "12345", TransferType: "in", TransferAmount: "90000", Content: "payment BOX123456789ABC", TransactionDate: "2026-10-20 12:00:00"}
}

func TestSePaySettlementBeforeManualReview(t *testing.T) {
	order, transfer := sePayFixture(t)
	proof := &TopUpSubmission{UserId: 1, TradeNo: order.TradeNo}
	require.NoError(t, CreateTopUpSubmission(proof))
	require.NoError(t, ProcessSePayTransfer(transfer))
	require.NoError(t, ProcessSePayTransfer(transfer))
	transfer.ID++
	require.NoError(t, ProcessSePayTransfer(transfer))
	_, err := ReviewTopUpSubmission(proof.Id, 99, true, "approve again")
	require.NoError(t, err)
	var user User
	require.NoError(t, DB.First(&user, 1).Error)
	assert.Equal(t, 1000, user.Quota)
	status, err := GetBankQROrderStatus(1, order.TradeNo)
	require.NoError(t, err)
	assert.Equal(t, BankQROrderStatus{"success", true}, status)
	_, err = GetBankQROrderStatus(2, order.TradeNo)
	require.Error(t, err)
}

func TestSePayReconciliationAndImmutableTransactionID(t *testing.T) {
	cases := []struct {
		name, reason string
		change       func(*TopUp, *SePayTransfer)
	}{
		{"outgoing", "outgoing", func(o *TopUp, p *SePayTransfer) { p.TransferType = "out" }},
		{"face amount", "amount_mismatch", func(o *TopUp, p *SePayTransfer) { p.TransferAmount = "100000" }},
		{"fraction", "invalid_amount", func(o *TopUp, p *SePayTransfer) { p.TransferAmount = "90000.1" }},
		{"negative", "invalid_amount", func(o *TopUp, p *SePayTransfer) { p.TransferAmount = "-90000" }},
		{"huge exponent", "invalid_amount", func(o *TopUp, p *SePayTransfer) { p.TransferAmount = "1e2147483647" }},
		{"gateway", "destination_mismatch", func(o *TopUp, p *SePayTransfer) { p.Gateway = "Other" }},
		{"account", "destination_mismatch", func(o *TopUp, p *SePayTransfer) { p.AccountNumber = "other" }},
		{"subaccount", "destination_mismatch", func(o *TopUp, p *SePayTransfer) { v := "other"; p.SubAccount = &v }},
		{"manual", "manual_order", func(o *TopUp, p *SePayTransfer) { o.SePaySnapshot = SePaySnapshot{} }},
		{"expired", "expired", func(o *TopUp, p *SePayTransfer) { o.ExpiresAt = common.GetTimestamp() - 1 }},
		{"cancelled", "order_cancelled", func(o *TopUp, p *SePayTransfer) { o.Status = "cancelled" }},
		{"substring", "unmatched", func(o *TopUp, p *SePayTransfer) { p.Content = "X" + o.TradeNo }},
		{"ambiguous", "ambiguous_reference", func(o *TopUp, p *SePayTransfer) { p.Content += " BOXOTHER" }},
	}
	for _, tc := range cases {
		t.Run(tc.name, func(t *testing.T) {
			order, transfer := sePayFixture(t)
			require.NoError(t, DB.Create(&TopUp{TradeNo: "BOXOTHER", UserId: 1, PaymentProvider: PaymentProviderBankQR}).Error)
			tc.change(&order, &transfer)
			require.NoError(t, DB.Save(&order).Error)
			require.NoError(t, ProcessSePayTransfer(transfer))
			var event SePayEvent
			require.NoError(t, DB.First(&event, transfer.ID).Error)
			assert.Equal(t, tc.reason, event.Reason)
			originalTrade := event.TradeNo
			transfer.Content = "BOXOTHER"
			require.NoError(t, ProcessSePayTransfer(transfer))
			require.NoError(t, DB.First(&event, transfer.ID).Error)
			assert.Equal(t, originalTrade, event.TradeNo)
			assert.Equal(t, tc.reason, event.Reason)
			var user User
			require.NoError(t, DB.First(&user, 1).Error)
			assert.Zero(t, user.Quota)
		})
	}
}

func TestSePayQuotaCeilingRollsBackEventAndSettlement(t *testing.T) {
	order, transfer := sePayFixture(t)
	require.NoError(t, DB.Model(&User{}).Where("id = ?", 1).Update("quota", common.MaxQuota-999).Error)
	require.ErrorIs(t, ProcessSePayTransfer(transfer), ErrTopUpCreditExceedsMaximum)
	var count int64
	require.NoError(t, DB.Model(&SePayEvent{}).Count(&count).Error)
	assert.Zero(t, count)
	status, err := GetBankQROrderStatus(1, order.TradeNo)
	require.NoError(t, err)
	assert.Equal(t, "pending", status.Status)
	require.NoError(t, DB.Model(&User{}).Where("id = ?", 1).Update("quota", 0).Error)
	require.NoError(t, ProcessSePayTransfer(transfer))
}

func TestSePaySubscriptionUsesPlanSnapshot(t *testing.T) {
	_, transfer := sePayFixture(t)
	plan := SubscriptionPlan{Title: "Original", PriceAmount: 5, Currency: "USD", DurationUnit: "month", DurationValue: 1, Enabled: true, TotalAmount: 1000}
	require.NoError(t, DB.Create(&plan).Error)
	payload, err := common.Marshal(BankQRSubscriptionOrderPayload{Version: 1, Amount: 90000, Currency: "VND", Plan: plan})
	require.NoError(t, err)
	order := SubscriptionOrder{UserId: 1, PlanId: plan.Id, TradeNo: "BOXSUB", Money: 5, PaymentProvider: PaymentProviderBankQR, PaymentMethod: PaymentMethodBankQR, Status: common.TopUpStatusPending, CreateTime: common.GetTimestamp(), ProviderPayload: string(payload), SePaySnapshot: SePaySnapshot{AutomaticConfirmation: true, SePayGateway: "MBBank", SePayAccount: "12345"}}
	require.NoError(t, DB.Create(&order).Error)
	require.NoError(t, DB.Model(&plan).Update("total_amount", 2000).Error)
	transfer.Content = order.TradeNo
	require.NoError(t, ProcessSePayTransfer(transfer))
	transfer.ID++
	require.NoError(t, ProcessSePayTransfer(transfer))
	var subscriptions []UserSubscription
	require.NoError(t, DB.Find(&subscriptions).Error)
	require.Len(t, subscriptions, 1)
	assert.EqualValues(t, 1000, subscriptions[0].AmountTotal)
	status, err := GetBankQROrderStatus(1, order.TradeNo)
	require.NoError(t, err)
	assert.Equal(t, BankQROrderStatus{"success", true}, status)
}

func TestSePaySettlementAfterManualReview(t *testing.T) {
	order, transfer := sePayFixture(t)
	proof := &TopUpSubmission{UserId: 1, TradeNo: order.TradeNo}
	require.NoError(t, CreateTopUpSubmission(proof))
	_, err := ReviewTopUpSubmission(proof.Id, 99, true, "verified")
	require.NoError(t, err)
	require.NoError(t, ProcessSePayTransfer(transfer))
	var user User
	require.NoError(t, DB.First(&user, 1).Error)
	assert.Equal(t, 1000, user.Quota)
	var event SePayEvent
	require.NoError(t, DB.First(&event, transfer.ID).Error)
	assert.Equal(t, "order_success", event.Reason)
}

func TestSePayExpiredSubscriptionRemainsForReconciliation(t *testing.T) {
	_, transfer := sePayFixture(t)
	order := SubscriptionOrder{UserId: 1, TradeNo: "BOXSUBOLD", PaymentProvider: PaymentProviderBankQR, PaymentMethod: PaymentMethodBankQR, Status: common.TopUpStatusPending, CreateTime: common.GetTimestamp() - BankQRPendingOrderWindowSeconds - 1,
		SePaySnapshot: SePaySnapshot{AutomaticConfirmation: true, SePayGateway: "MBBank", SePayAccount: "12345"}}
	require.NoError(t, DB.Create(&order).Error)
	transfer.Content = order.TradeNo
	require.NoError(t, ProcessSePayTransfer(transfer))
	var event SePayEvent
	require.NoError(t, DB.First(&event, transfer.ID).Error)
	assert.Equal(t, "expired", event.Reason)
	status, err := GetBankQROrderStatus(1, order.TradeNo)
	require.NoError(t, err)
	assert.Equal(t, BankQROrderStatus{"expired", true}, status)
	_, err = GetBankQROrderStatus(2, order.TradeNo)
	require.Error(t, err)
}
