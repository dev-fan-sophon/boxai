package model

import (
	"encoding/json"
	"errors"
	"strings"
	"unicode"

	"github.com/dev-fan-sophon/boxai/common"
	"github.com/shopspring/decimal"
	"gorm.io/gorm"
)

// SePaySnapshot is immutable checkout destination data, not live configuration.
type SePaySnapshot struct {
	AutomaticConfirmation bool   `json:"automatic_confirmation"`
	SePayGateway          string `json:"-" gorm:"type:varchar(128)"`
	SePayAccount          string `json:"-" gorm:"type:varchar(128)"`
	SePaySubAccount       string `json:"-" gorm:"type:varchar(128)"`
}

type SePayTransfer struct {
	ID              int64       `json:"id"`
	Gateway         string      `json:"gateway"`
	AccountNumber   string      `json:"accountNumber"`
	SubAccount      *string     `json:"subAccount"`
	TransferType    string      `json:"transferType"`
	TransferAmount  json.Number `json:"transferAmount"`
	Code            *string     `json:"code"`
	Content         string      `json:"content"`
	ReferenceCode   string      `json:"referenceCode"`
	TransactionDate string      `json:"transactionDate"`
}

// The provider transaction ID is the primary key even for unmatched events:
// a later retry can never reassign a transfer to a different order.
type SePayEvent struct {
	ID         int64  `gorm:"primaryKey;autoIncrement:false"`
	TradeNo    string `gorm:"type:varchar(255);index"`
	Reason     string `gorm:"type:varchar(64)"`
	Payload    string `gorm:"type:text"`
	ReceivedAt int64
}

type BankQROrderStatus struct {
	Status                string `json:"status"`
	AutomaticConfirmation bool   `json:"automatic_confirmation"`
}

func GetBankQROrderStatus(userID int, tradeNo string) (BankQROrderStatus, error) {
	var topup TopUp
	err := DB.Where("trade_no = ? AND user_id = ? AND payment_provider = ?", tradeNo, userID, PaymentProviderBankQR).First(&topup).Error
	if err == nil {
		status := topup.Status
		if status == common.TopUpStatusFailed {
			status = "cancelled"
		}
		if status == common.TopUpStatusPending && topup.ExpiresAt > 0 && topup.ExpiresAt <= common.GetTimestamp() {
			status = "expired"
		}
		return BankQROrderStatus{status, topup.AutomaticConfirmation}, nil
	}
	if !errors.Is(err, gorm.ErrRecordNotFound) {
		return BankQROrderStatus{}, err
	}
	var order SubscriptionOrder
	err = DB.Where("trade_no = ? AND user_id = ? AND payment_provider = ?", tradeNo, userID, PaymentProviderBankQR).First(&order).Error
	if err != nil {
		return BankQROrderStatus{}, err
	}
	status := order.Status
	if status == common.TopUpStatusFailed {
		status = "cancelled"
	}
	if status == common.TopUpStatusPending && order.CreateTime <= common.GetTimestamp()-BankQRPendingOrderWindowSeconds {
		status = "expired"
	}
	return BankQROrderStatus{status, order.AutomaticConfirmation}, nil
}

// ProcessSePayTransfer must only be called after authenticating the raw request.
func ProcessSePayTransfer(transfer SePayTransfer) error {
	if transfer.ID <= 0 {
		return errors.New("invalid SePay transaction ID")
	}
	payload, err := common.Marshal(transfer)
	if err != nil {
		return err
	}
	var userID, quota int
	var group string
	err = DB.Transaction(func(tx *gorm.DB) error {
		if err := lockTopUpDiscounts(tx); err != nil {
			return err
		}
		var existing SePayEvent
		err := tx.First(&existing, transfer.ID).Error
		if err == nil {
			return nil
		}
		if !errors.Is(err, gorm.ErrRecordNotFound) {
			return err
		}
		event := SePayEvent{ID: transfer.ID, Payload: string(payload), ReceivedAt: common.GetTimestamp(), Reason: "unmatched"}
		if transfer.TransferType != "in" {
			event.Reason = "outgoing"
			return tx.Create(&event).Error
		}
		paid, amountErr := decimal.NewFromString(string(transfer.TransferAmount))
		if amountErr != nil || len(transfer.TransferAmount) > 32 || paid.Exponent() < -10 || paid.Exponent() > 10 || !paid.IsPositive() || !paid.Equal(paid.Truncate(0)) {
			event.Reason = "invalid_amount"
			return tx.Create(&event).Error
		}
		text := transfer.Content
		if transfer.Code != nil {
			text += " " + *transfer.Code
		}
		// Match complete alphanumeric tokens, never a first substring. Query both
		// order tables so conflicting references cannot silently select a winner.
		tokens := strings.FieldsFunc(text, func(r rune) bool { return !unicode.IsLetter(r) && !unicode.IsDigit(r) })
		if len(tokens) > 256 {
			event.Reason = "ambiguous_reference"
			return tx.Create(&event).Error
		}
		var topups []TopUp
		var orders []SubscriptionOrder
		if len(tokens) > 0 {
			if err := lockForUpdate(tx).Where("trade_no IN ? AND payment_provider = ?", tokens, PaymentProviderBankQR).Find(&topups).Error; err != nil {
				return err
			}
			if err := lockForUpdate(tx).Where("trade_no IN ? AND payment_provider = ?", tokens, PaymentProviderBankQR).Find(&orders).Error; err != nil {
				return err
			}
		}
		if len(topups)+len(orders) != 1 {
			if len(topups)+len(orders) > 1 {
				event.Reason = "ambiguous_reference"
			}
			return tx.Create(&event).Error
		}
		var snapshot SePaySnapshot
		var amount int64
		var status, provider, method, orderType string
		var expired, invalidSnapshot bool
		if len(topups) == 1 {
			o := topups[0]
			snapshot, amount, userID, event.TradeNo = o.SePaySnapshot, o.PaidAmount, o.UserId, o.TradeNo
			status, provider, method, orderType = o.Status, o.PaymentProvider, o.PaymentMethod, TopUpSubmissionOrderBalance
			expired = o.ExpiresAt <= common.GetTimestamp()
		} else {
			o := orders[0]
			snapshot, userID, event.TradeNo = o.SePaySnapshot, o.UserId, o.TradeNo
			status, provider, method, orderType = o.Status, o.PaymentProvider, o.PaymentMethod, TopUpSubmissionOrderSubscription
			expired = o.CreateTime <= common.GetTimestamp()-BankQRPendingOrderWindowSeconds
			var p BankQRSubscriptionOrderPayload
			invalidSnapshot = common.UnmarshalJsonStr(o.ProviderPayload, &p) != nil || p.Version != 1 || p.Currency != "VND" || p.Plan.Id != o.PlanId
			amount = p.Amount
		}
		subAccount := ""
		if transfer.SubAccount != nil {
			subAccount = *transfer.SubAccount
		}
		exactReference := false
		for _, token := range tokens {
			if token == event.TradeNo {
				exactReference = true
			}
		}
		switch {
		case !exactReference:
			event.Reason = "unmatched"
		case !snapshot.AutomaticConfirmation || snapshot.SePayGateway == "" || snapshot.SePayAccount == "" || provider != PaymentProviderBankQR || method != PaymentMethodBankQR:
			event.Reason = "manual_order"
		case status != common.TopUpStatusPending:
			event.Reason = "order_" + status
		case expired:
			event.Reason = "expired"
		case invalidSnapshot:
			event.Reason = "invalid_snapshot"
		case snapshot.SePayGateway != transfer.Gateway || snapshot.SePayAccount != transfer.AccountNumber || snapshot.SePaySubAccount != subAccount:
			event.Reason = "destination_mismatch"
		case amount <= 0 || !paid.Equal(decimal.NewFromInt(amount)):
			event.Reason = "amount_mismatch"
		default:
			// Reuse manual settlement's quota guard, plan snapshot and audit row.
			var submission TopUpSubmission
			err := tx.Where("trade_no = ? AND status = ?", event.TradeNo, TopUpSubmissionSubmitted).First(&submission).Error
			if errors.Is(err, gorm.ErrRecordNotFound) {
				submission = TopUpSubmission{UserId: userID, TradeNo: event.TradeNo, OrderType: orderType, Status: TopUpSubmissionSubmitted, SubmittedAt: common.GetTimestamp()}
				if err = tx.Create(&submission).Error; err != nil {
					return err
				}
			} else if err != nil {
				return err
			}
			_, quota, group, err = reviewTopUpSubmissionTx(tx, submission.Id, 0, true, "Automatically confirmed by SePay")
			if err != nil {
				return err
			}
			event.Reason = "settled"
		}
		return tx.Create(&event).Error
	})
	if err == nil {
		refreshBankQRSettlementCache(userID, quota, group)
	}
	return err
}
