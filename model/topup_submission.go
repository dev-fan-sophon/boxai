package model

import (
	"errors"
	"strings"

	"github.com/QuantumNous/new-api/common"
	"gorm.io/gorm"
)

const (
	TopUpSubmissionOrderBalance            = "balance"
	TopUpSubmissionOrderSubscription       = "subscription"
	TopUpSubmissionSubmitted               = "submitted"
	TopUpSubmissionApproved                = "approved"
	TopUpSubmissionRejected                = "rejected"
	MaxTopUpSubmissionAttempts             = 5
	MaxTopUpProofBytesPerUser        int64 = 50 * 1024 * 1024
	BankQRPendingOrderWindowSeconds  int64 = 24 * 60 * 60
)

type TopUpSubmission struct {
	Id                       int     `json:"id"`
	UserId                   int     `json:"user_id" gorm:"index"`
	TradeNo                  string  `json:"trade_no" gorm:"type:varchar(255);index;not null"`
	OrderType                string  `json:"order_type" gorm:"type:varchar(20);not null"`
	BankTransactionNo        string  `json:"bank_transaction_no" gorm:"type:varchar(128);index"`
	ActiveBankTransactionKey *string `json:"-" gorm:"type:varchar(128);uniqueIndex"`
	ProofStorageKey          string  `json:"-" gorm:"type:varchar(512)"`
	ProofBackend             string  `json:"proof_backend" gorm:"type:varchar(20)"`
	ProofMime                string  `json:"proof_mime" gorm:"type:varchar(64)"`
	ProofSize                int64   `json:"proof_size"`
	Note                     string  `json:"note" gorm:"type:varchar(1000)"`
	Status                   string  `json:"status" gorm:"type:varchar(20);index;not null"`
	SubmittedAt              int64   `json:"submitted_at"`
	ReviewedAt               int64   `json:"reviewed_at"`
	ReviewedBy               int     `json:"reviewed_by"`
	ReviewNote               string  `json:"review_note" gorm:"type:varchar(1000)"`
}

var (
	ErrTopUpSubmissionNotFound           = errors.New("top-up submission not found")
	ErrTopUpSubmissionInvalid            = errors.New("top-up submission is not submitted")
	ErrTopUpSubmissionInputInvalid       = errors.New("invalid top-up submission")
	ErrTopUpSubmissionAttemptLimit       = errors.New("top-up submission attempt limit reached")
	ErrTopUpProofStorageLimit            = errors.New("top-up proof storage limit reached")
	ErrTopUpSubmissionActive             = errors.New("active top-up submission already exists")
	ErrBankTransactionDuplicate          = errors.New("bank transaction number has already been submitted")
	ErrBankQROrderInvalid                = errors.New("invalid Bank QR order")
	ErrBankQRPendingOrderLimit           = errors.New("too many pending Bank QR orders")
	ErrBankQROrderOwner                  = errors.New("Bank QR order does not belong to user")
	ErrBankQROrderNotPending             = errors.New("Bank QR order is not pending")
	ErrBankQROrderNotFound               = errors.New("Bank QR order not found")
	ErrTopUpSubmissionOwnerChanged       = errors.New("top-up submission owner changed")
	ErrTopUpCreditExceedsMaximum         = errors.New("credited quota would exceed maximum")
	ErrBankQRSubscriptionSnapshotInvalid = errors.New("invalid Bank QR subscription order snapshot")
)

func CreateTopUpSubmission(submission *TopUpSubmission) error {
	if submission == nil || submission.UserId <= 0 || strings.TrimSpace(submission.TradeNo) == "" {
		return ErrTopUpSubmissionInputInvalid
	}
	err := DB.Transaction(func(tx *gorm.DB) error {
		var user User
		if err := lockForUpdate(tx).Select("id").First(&user, submission.UserId).Error; err != nil {
			return err
		}
		orderType, err := validateBankQROrderTx(tx, submission.TradeNo, submission.UserId)
		if err != nil {
			return err
		}
		var count, active int64
		query := tx.Model(&TopUpSubmission{}).Where("trade_no = ? AND user_id = ?", submission.TradeNo, submission.UserId)
		if err := query.Count(&count).Error; err != nil {
			return err
		}
		if count >= MaxTopUpSubmissionAttempts {
			return ErrTopUpSubmissionAttemptLimit
		}
		var storedBytes int64
		if err := tx.Model(&TopUpSubmission{}).Where("user_id = ?", submission.UserId).
			Select("COALESCE(SUM(proof_size), 0)").Scan(&storedBytes).Error; err != nil {
			return err
		}
		if submission.ProofSize > 0 && storedBytes > MaxTopUpProofBytesPerUser-submission.ProofSize {
			return ErrTopUpProofStorageLimit
		}
		if err := query.Where("status = ?", TopUpSubmissionSubmitted).Count(&active).Error; err != nil {
			return err
		}
		if active > 0 {
			return ErrTopUpSubmissionActive
		}
		if submission.BankTransactionNo != "" {
			canonicalTransactionNo := strings.ToUpper(strings.TrimSpace(submission.BankTransactionNo))
			submission.ActiveBankTransactionKey = &canonicalTransactionNo
			var duplicate int64
			if err := tx.Model(&TopUpSubmission{}).
				Where("active_bank_transaction_key = ?", canonicalTransactionNo).
				Count(&duplicate).Error; err != nil {
				return err
			}
			if duplicate > 0 {
				return ErrBankTransactionDuplicate
			}
		}
		submission.OrderType = orderType
		submission.Status = TopUpSubmissionSubmitted
		submission.SubmittedAt = common.GetTimestamp()
		return tx.Create(submission).Error
	})
	if err != nil && submission.ActiveBankTransactionKey != nil {
		var duplicate int64
		if DB.Model(&TopUpSubmission{}).Where("active_bank_transaction_key = ?", *submission.ActiveBankTransactionKey).Count(&duplicate).Error == nil && duplicate > 0 {
			return ErrBankTransactionDuplicate
		}
	}
	return err
}

func countPendingBankQROrdersTx(tx *gorm.DB, userId int) (int64, error) {
	var topUpCount, subscriptionCount int64
	cutoff := common.GetTimestamp() - BankQRPendingOrderWindowSeconds
	if err := tx.Model(&TopUp{}).Where("user_id = ? AND payment_provider = ? AND status = ? AND create_time >= ?", userId, PaymentProviderBankQR, common.TopUpStatusPending, cutoff).Count(&topUpCount).Error; err != nil {
		return 0, err
	}
	if err := tx.Model(&SubscriptionOrder{}).Where("user_id = ? AND payment_provider = ? AND status = ? AND create_time >= ?", userId, PaymentProviderBankQR, common.TopUpStatusPending, cutoff).Count(&subscriptionCount).Error; err != nil {
		return 0, err
	}
	return topUpCount + subscriptionCount, nil
}

func CreatePendingBankQRTopUp(order *TopUp, maxPending int) error {
	if order == nil || order.UserId <= 0 {
		return ErrBankQROrderInvalid
	}
	return createPendingBankQROrder(order.UserId, maxPending, func(tx *gorm.DB) error {
		return tx.Create(order).Error
	})
}

func CreatePendingBankQRSubscriptionOrder(order *SubscriptionOrder, maxPending int) error {
	if order == nil || order.UserId <= 0 {
		return ErrBankQROrderInvalid
	}
	return createPendingBankQROrder(order.UserId, maxPending, func(tx *gorm.DB) error {
		return tx.Create(order).Error
	})
}

func createPendingBankQROrder(userId, maxPending int, insert func(*gorm.DB) error) error {
	return DB.Transaction(func(tx *gorm.DB) error {
		var user User
		if err := lockForUpdate(tx).Select("id").First(&user, userId).Error; err != nil {
			return err
		}
		count, err := countPendingBankQROrdersTx(tx, userId)
		if err != nil {
			return err
		}
		if count >= int64(maxPending) {
			return ErrBankQRPendingOrderLimit
		}
		return insert(tx)
	})
}

func validateBankQROrderTx(tx *gorm.DB, tradeNo string, userId int) (string, error) {
	var topup TopUp
	if err := lockForUpdate(tx).Where("trade_no = ?", tradeNo).First(&topup).Error; err == nil {
		if topup.UserId != userId {
			return "", ErrBankQROrderOwner
		}
		if topup.PaymentProvider != PaymentProviderBankQR || topup.PaymentMethod != PaymentMethodBankQR || topup.Status != common.TopUpStatusPending {
			return "", ErrBankQROrderNotPending
		}
		return TopUpSubmissionOrderBalance, nil
	} else if !errors.Is(err, gorm.ErrRecordNotFound) {
		return "", err
	}
	var order SubscriptionOrder
	if err := lockForUpdate(tx).Where("trade_no = ?", tradeNo).First(&order).Error; err != nil {
		return "", ErrBankQROrderNotFound
	}
	if order.UserId != userId {
		return "", ErrBankQROrderOwner
	}
	if order.PaymentProvider != PaymentProviderBankQR || order.PaymentMethod != PaymentMethodBankQR || order.Status != common.TopUpStatusPending {
		return "", ErrBankQROrderNotPending
	}
	return TopUpSubmissionOrderSubscription, nil
}

func GetUserTopUpSubmissions(tradeNo string, userId int) ([]TopUpSubmission, error) {
	if _, err := validateBankQROrderOwnership(tradeNo, userId); err != nil {
		return nil, err
	}
	var items []TopUpSubmission
	err := DB.Where("trade_no = ? AND user_id = ?", tradeNo, userId).Order("id desc").Find(&items).Error
	return items, err
}

func validateBankQROrderOwnership(tradeNo string, userId int) (string, error) {
	var topup TopUp
	if err := DB.Where("trade_no = ?", tradeNo).First(&topup).Error; err == nil {
		if topup.UserId != userId {
			return "", ErrBankQROrderOwner
		}
		return TopUpSubmissionOrderBalance, nil
	}
	var order SubscriptionOrder
	if err := DB.Where("trade_no = ?", tradeNo).First(&order).Error; err != nil {
		return "", ErrBankQROrderNotFound
	}
	if order.UserId != userId {
		return "", ErrBankQROrderOwner
	}
	return TopUpSubmissionOrderSubscription, nil
}

func GetTopUpSubmission(id int) (*TopUpSubmission, error) {
	var item TopUpSubmission
	if err := DB.First(&item, id).Error; err != nil {
		return nil, ErrTopUpSubmissionNotFound
	}
	return &item, nil
}

type TopUpReview struct {
	TopUpSubmission
	Username        string  `json:"username"`
	Amount          int64   `json:"amount"`
	Money           float64 `json:"money"`
	Currency        string  `json:"currency"`
	PlanId          int     `json:"plan_id"`
	PlanTitle       string  `json:"plan_title"`
	ProviderPayload string  `json:"-"`
}

func ListTopUpReviews(status, keyword string, limit, offset int) ([]TopUpReview, int64, error) {
	q := DB.Table("top_up_submissions s").Joins("LEFT JOIN users u ON u.id = s.user_id").
		Joins("LEFT JOIN top_ups t ON t.trade_no = s.trade_no AND s.order_type = ?", TopUpSubmissionOrderBalance).
		Joins("LEFT JOIN subscription_orders o ON o.trade_no = s.trade_no AND s.order_type = ?", TopUpSubmissionOrderSubscription).
		Joins("LEFT JOIN subscription_plans p ON p.id = o.plan_id")
	if status != "" {
		q = q.Where("s.status = ?", status)
	}
	if keyword != "" {
		q = q.Where("s.trade_no LIKE ? OR s.bank_transaction_no LIKE ? OR u.username LIKE ?", "%"+keyword+"%", "%"+keyword+"%", "%"+keyword+"%")
	}
	var total int64
	if err := q.Count(&total).Error; err != nil {
		return nil, 0, err
	}
	var items []TopUpReview
	err := q.Select("s.*, u.username, COALESCE(t.amount, 0) amount, COALESCE(t.money, o.money, 0) money, CASE WHEN s.order_type = 'subscription' THEN COALESCE(p.currency, 'USD') ELSE 'VND' END currency, COALESCE(o.plan_id, 0) plan_id, COALESCE(p.title, '') plan_title, COALESCE(o.provider_payload, '') provider_payload").Order("s.id desc").Limit(limit).Offset(offset).Scan(&items).Error
	if err != nil {
		return nil, 0, err
	}
	for i := range items {
		if items[i].OrderType != TopUpSubmissionOrderSubscription || items[i].ProviderPayload == "" {
			continue
		}
		var payment struct {
			Amount   int64  `json:"amount"`
			Currency string `json:"currency"`
		}
		if common.UnmarshalJsonStr(items[i].ProviderPayload, &payment) == nil && payment.Amount > 0 {
			items[i].Money = float64(payment.Amount)
			items[i].Currency = payment.Currency
		}
	}
	return items, total, err
}

func ReviewTopUpSubmission(id, reviewer int, approve bool, reason string) (*TopUpSubmission, error) {
	var result TopUpSubmission
	var creditedQuota int
	var upgradeGroup string
	err := DB.Transaction(func(tx *gorm.DB) error {
		var identity TopUpSubmission
		if err := tx.Select("id", "user_id").First(&identity, id).Error; err != nil {
			return ErrTopUpSubmissionNotFound
		}
		var user User
		if err := lockForUpdate(tx).Select("id", "quota").First(&user, identity.UserId).Error; err != nil {
			return err
		}
		if err := lockForUpdate(tx).First(&result, id).Error; err != nil {
			return ErrTopUpSubmissionNotFound
		}
		if result.UserId != identity.UserId {
			return ErrTopUpSubmissionOwnerChanged
		}
		if result.Status == TopUpSubmissionApproved && approve {
			return nil
		}
		if result.Status != TopUpSubmissionSubmitted {
			return ErrTopUpSubmissionInvalid
		}
		now := common.GetTimestamp()
		if !approve {
			result.Status, result.ReviewedAt, result.ReviewedBy, result.ReviewNote = TopUpSubmissionRejected, now, reviewer, reason
			result.ActiveBankTransactionKey = nil
			return tx.Save(&result).Error
		}
		if result.OrderType == TopUpSubmissionOrderBalance {
			var order TopUp
			if err := lockForUpdate(tx).Where("trade_no = ?", result.TradeNo).First(&order).Error; err != nil {
				return err
			}
			if order.UserId != result.UserId || order.Status != common.TopUpStatusPending || order.PaymentProvider != PaymentProviderBankQR || order.PaymentMethod != PaymentMethodBankQR {
				return ErrTopUpStatusInvalid
			}
			quota, err := BankQRQuota(order.Amount)
			if err != nil {
				return err
			}
			if int64(user.Quota)+int64(quota) > int64(common.MaxQuota) {
				return ErrTopUpCreditExceedsMaximum
			}
			if err := tx.Model(&User{}).Where("id = ?", order.UserId).Update("quota", gorm.Expr("quota + ?", quota)).Error; err != nil {
				return err
			}
			creditedQuota = quota
			order.Status, order.CompleteTime = common.TopUpStatusSuccess, now
			if err := tx.Save(&order).Error; err != nil {
				return err
			}
		} else {
			var order SubscriptionOrder
			if err := lockForUpdate(tx).Where("trade_no = ?", result.TradeNo).First(&order).Error; err != nil {
				return err
			}
			if order.UserId != result.UserId || order.Status != common.TopUpStatusPending || order.PaymentProvider != PaymentProviderBankQR || order.PaymentMethod != PaymentMethodBankQR {
				return ErrSubscriptionOrderStatusInvalid
			}
			var payload BankQRSubscriptionOrderPayload
			if err := common.UnmarshalJsonStr(order.ProviderPayload, &payload); err != nil || payload.Version != 1 || payload.Plan.Id != order.PlanId {
				return ErrBankQRSubscriptionSnapshotInvalid
			}
			if _, err := CreateUserSubscriptionFromPlanTx(tx, order.UserId, &payload.Plan, "order"); err != nil {
				return err
			}
			upgradeGroup = strings.TrimSpace(payload.Plan.UpgradeGroup)
			if err := upsertSubscriptionTopUpTx(tx, &order); err != nil {
				return err
			}
			order.Status, order.CompleteTime = common.TopUpStatusSuccess, now
			if err := tx.Save(&order).Error; err != nil {
				return err
			}
		}
		result.Status, result.ReviewedAt, result.ReviewedBy, result.ReviewNote = TopUpSubmissionApproved, now, reviewer, reason
		return tx.Save(&result).Error
	})
	if err == nil && creditedQuota > 0 {
		if cacheErr := cacheIncrUserQuota(result.UserId, int64(creditedQuota)); cacheErr != nil {
			common.SysLog("failed to increase user quota cache after Bank QR approval: " + cacheErr.Error())
			_ = InvalidateUserCache(result.UserId)
		}
	}
	if err == nil && upgradeGroup != "" {
		if cacheErr := UpdateUserGroupCache(result.UserId, upgradeGroup); cacheErr != nil {
			common.SysLog("failed to update user group cache after Bank QR approval: " + cacheErr.Error())
			_ = InvalidateUserCache(result.UserId)
		}
	}
	return &result, err
}
