package model

import (
	"errors"
	"strings"

	"github.com/dev-fan-sophon/boxai/common"
	"github.com/dev-fan-sophon/boxai/pkg/vietqr"
	"github.com/dev-fan-sophon/boxai/setting/operation_setting"
	"github.com/shopspring/decimal"
	"gorm.io/gorm"
)

const PaymentMethodSePay = "sepay"
const PaymentProviderSePay = "sepay"
const SePayOrderLifetime = 24 * 60 * 60

type SePayInvoice struct {
	TradeNo         string  `json:"trade_no"`
	TransferContent string  `json:"transfer_content"`
	Amount          int64   `json:"amount"`
	Currency        string  `json:"currency"`
	Payload         string  `json:"payload"`
	BankName        string  `json:"bank_name"`
	BankBIN         string  `json:"bank_bin"`
	AccountNumber   string  `json:"account_number"`
	AccountName     string  `json:"account_name"`
	ExpiresAt       int64   `json:"expires_at"`
	Status          string  `json:"status"`
	CreditUSD       float64 `json:"credit_usd,omitempty"`
}

// SePaySubscriptionPayload is independent of manual Bank QR proof and discounts.
type SePaySubscriptionPayload struct {
	Version  int              `json:"version"`
	Amount   int64            `json:"amount"`
	Currency string           `json:"currency"`
	Plan     SubscriptionPlan `json:"plan"`
}

func CreateSePayCheckout(userID int, tradeNo string, amount int64, planID int, s operation_setting.SePaySetting) (SePayInvoice, error) {
	var invoice SePayInvoice
	err := DB.Transaction(func(tx *gorm.DB) error {
		var user User
		if err := lockForUpdate(tx).First(&user, userID).Error; err != nil {
			return err
		}
		now := common.GetTimestamp()
		var count, subscriptions int64
		if err := tx.Model(&TopUp{}).Where("user_id = ? AND payment_provider = ? AND status = ? AND create_time > ?", userID, PaymentProviderSePay, common.TopUpStatusPending, now-SePayOrderLifetime).Count(&count).Error; err != nil {
			return err
		}
		if err := tx.Model(&SubscriptionOrder{}).Where("user_id = ? AND payment_provider = ? AND status = ? AND create_time > ?", userID, PaymentProviderSePay, common.TopUpStatusPending, now-SePayOrderLifetime).Count(&subscriptions).Error; err != nil {
			return err
		}
		if count+subscriptions >= 10 {
			return errors.New("too many pending SePay orders")
		}
		var plan SubscriptionPlan
		var quote TopUpQuote
		var err error
		if planID != 0 {
			if err = tx.First(&plan, planID).Error; err != nil {
				return err
			}
			if !plan.Enabled || !strings.EqualFold(plan.Currency, "USD") || plan.PriceAmount < 0.01 || plan.PriceAmount > 100000 {
				return errors.New("invalid SePay subscription plan")
			}
			rate, rateErr := currentCreditFXRate()
			if rateErr != nil {
				return rateErr
			}
			vnd := decimal.NewFromFloat(plan.PriceAmount).Mul(rate).Round(0)
			if !vnd.IsPositive() || vnd.GreaterThanOrEqual(decimal.NewFromInt(MaxTopUpFaceVND)) {
				return ErrTopUpQuoteOutOfRange
			}
			amount = vnd.IntPart()
			if plan.MaxPurchasePerUser > 0 {
				var purchased, pending int64
				if err = tx.Model(&UserSubscription{}).Where("user_id = ? AND plan_id = ?", userID, planID).Count(&purchased).Error; err != nil {
					return err
				}
				if err = tx.Model(&SubscriptionOrder{}).Where("user_id = ? AND plan_id = ? AND status = ? AND create_time > ?", userID, planID, common.TopUpStatusPending, now-SePayOrderLifetime).Count(&pending).Error; err != nil {
					return err
				}
				if purchased+pending >= int64(plan.MaxPurchasePerUser) {
					return ErrSubscriptionPurchaseLimit
				}
			}
		} else {
			if amount < s.MinTopUp {
				return ErrTopUpQuoteOutOfRange
			}
			quote, err = QuoteVNDTopUp(amount)
			if err != nil {
				return err
			}
		}
		qr, err := vietqr.Payload(s.BankBIN, s.AccountNumber, amount, tradeNo)
		if err != nil {
			return err
		}
		invoice = SePayInvoice{TradeNo: tradeNo, TransferContent: tradeNo, Amount: amount, Currency: "VND", Payload: qr, BankName: s.BankName, BankBIN: s.BankBIN, AccountNumber: s.AccountNumber, AccountName: s.AccountName, ExpiresAt: now + SePayOrderLifetime, Status: common.TopUpStatusPending}
		if planID == 0 {
			invoice.CreditUSD = USDCents(quote.CreditCents).InexactFloat64()
		}
		data, err := common.Marshal(invoice)
		if err != nil {
			return err
		}
		snapshot := SePaySnapshot{AutomaticConfirmation: true, SePayGateway: s.BankGateway, SePayAccount: s.AccountNumber, SePaySubAccount: s.SubAccount, SePayInvoice: string(data)}
		if planID != 0 {
			data, err = common.Marshal(SePaySubscriptionPayload{Version: 1, Amount: amount, Currency: "VND", Plan: plan})
			if err != nil {
				return err
			}
			return tx.Create(&SubscriptionOrder{SePaySnapshot: snapshot, UserId: userID, PlanId: planID, Money: plan.PriceAmount, TradeNo: tradeNo, PaymentProvider: PaymentProviderSePay, PaymentMethod: PaymentMethodSePay, Status: common.TopUpStatusPending, CreateTime: now, ProviderPayload: string(data)}).Error
		}
		order := TopUp{SePaySnapshot: snapshot, UserId: userID, TradeNo: tradeNo, PaymentProvider: PaymentProviderSePay, PaymentMethod: PaymentMethodSePay, Status: common.TopUpStatusPending, CreateTime: now}
		quote.Apply(&order)
		order.PaidAmount, order.FaceAmount, order.ExpiresAt, order.CreditUSD = amount, amount, invoice.ExpiresAt, invoice.CreditUSD
		return tx.Create(&order).Error
	})
	return invoice, err
}

func GetSePayInvoice(userID int, tradeNo string, cancel bool) (SePayInvoice, error) {
	var invoice SePayInvoice
	err := DB.Transaction(func(tx *gorm.DB) error {
		var topup TopUp
		var order SubscriptionOrder
		var row any
		var data, status string
		err := lockForUpdate(tx).Where("user_id = ? AND trade_no = ? AND payment_provider = ? AND se_pay_invoice <> ?", userID, tradeNo, PaymentProviderSePay, "").First(&topup).Error
		if err == nil {
			row, data, status = &topup, topup.SePayInvoice, topup.Status
		} else if errors.Is(err, gorm.ErrRecordNotFound) {
			if err = lockForUpdate(tx).Where("user_id = ? AND trade_no = ? AND payment_provider = ?", userID, tradeNo, PaymentProviderSePay).First(&order).Error; err != nil {
				return err
			}
			row, data, status = &order, order.SePayInvoice, order.Status
		} else {
			return err
		}
		if err = common.UnmarshalJsonStr(data, &invoice); err != nil {
			return err
		}
		if status == common.TopUpStatusFailed {
			status = "cancelled"
		}
		if status == common.TopUpStatusPending && invoice.ExpiresAt <= common.GetTimestamp() {
			status = "expired"
		}
		if cancel && status != "cancelled" {
			if status != common.TopUpStatusPending {
				return ErrTopUpStatusInvalid
			}
			if err = tx.Model(row).Update("status", common.TopUpStatusFailed).Error; err != nil {
				return err
			}
			status = "cancelled"
		}
		invoice.Status = status
		return nil
	})
	return invoice, err
}

// fulfillSePayOrderTx credits a verified provider order, never inventing a proof submission.
func fulfillSePayOrderTx(tx *gorm.DB, topups []TopUp, orders []SubscriptionOrder) (int, string, error) {
	if len(topups) == 1 {
		o := topups[0]
		var user User
		if err := lockForUpdate(tx).First(&user, o.UserId).Error; err != nil {
			return 0, "", err
		}
		quota, err := TopUpQuota(&o)
		if err != nil {
			return 0, "", err
		}
		if quota <= 0 || quota > common.MaxQuota || user.Quota > common.MaxQuota-quota {
			return 0, "", ErrTopUpCreditExceedsMaximum
		}
		if err = tx.Model(&user).Update("quota", gorm.Expr("quota + ?", quota)).Error; err != nil {
			return 0, "", err
		}
		o.Status, o.CompleteTime = common.TopUpStatusSuccess, common.GetTimestamp()
		return quota, "", tx.Save(&o).Error
	}
	o := orders[0]
	var payload SePaySubscriptionPayload
	if common.UnmarshalJsonStr(o.ProviderPayload, &payload) != nil || payload.Version != 1 || payload.Plan.Id != o.PlanId || payload.Currency != "VND" || payload.Plan.Currency != "USD" || payload.Plan.PriceAmount != o.Money {
		return 0, "", ErrBankQRSubscriptionSnapshotInvalid
	}
	if _, err := CreateUserSubscriptionFromPlanTx(tx, o.UserId, &payload.Plan, "order"); err != nil {
		return 0, "", err
	}
	if err := upsertSubscriptionTopUpTx(tx, &o); err != nil {
		return 0, "", err
	}
	o.Status, o.CompleteTime = common.TopUpStatusSuccess, common.GetTimestamp()
	return 0, strings.TrimSpace(payload.Plan.UpgradeGroup), tx.Save(&o).Error
}
