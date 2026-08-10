package model

import (
	"errors"
	"fmt"
	"time"

	"gorm.io/gorm"
	"gorm.io/gorm/clause"
)

const (
	BillingOperationInitial  = "initial"
	BillingOperationReserve  = "reserve"
	BillingOperationSettle   = "settle"
	BillingOperationRefund   = "refund"
	BillingOperationRollback = "rollback"
	// UnknownSubscriptionUsageGeneration is used only for legacy durable work
	// that predates period capture. It intentionally never matches a live period.
	UnknownSubscriptionUsageGeneration int64 = -1
)

// BillingOperation is the single durable authority for asynchronous billing.
// The journal row, funding mutation, and token mutation commit together.
type BillingOperation struct {
	ID                          int64  `gorm:"primaryKey"`
	IdempotencyKey              string `gorm:"type:varchar(191);uniqueIndex"`
	Kind                        string `gorm:"type:varchar(16);index"`
	UserID                      int    `gorm:"index"`
	TokenID                     int
	SubscriptionID              int
	SubscriptionUsageGeneration int64 `gorm:"not null;default:-1"`
	OverageSubscriptionID       int
	OverageUsageGeneration      int64  `gorm:"not null;default:-1"`
	BillingSource               string `gorm:"type:varchar(32)"`
	Delta                       int
	ChargedQuota                int
	ReferenceKey                string `gorm:"type:varchar(191);index"`
	State                       string `gorm:"type:varchar(16);index"`
	CacheProjectionCompleted    bool   `gorm:"index;not null;default:false"`
	CreatedAt                   int64
	UpdatedAt                   int64
}

type BillingOperationInput struct {
	IdempotencyKey              string
	Kind                        string
	UserID                      int
	TokenID                     int
	SubscriptionID              int
	SubscriptionUsageGeneration int64
	OverageSubscriptionID       int
	OverageUsageGeneration      int64
	BillingSource               string
	Delta                       int
	ChargedQuota                int
	ReferenceKey                string
	// SetChargeToTarget derives Delta from the latest committed operation in
	// ReferenceKey's lineage while holding the lineage rows locked.
	SetChargeToTarget bool
}

func ApplyBillingOperation(in BillingOperationInput) (*BillingOperation, bool, error) {
	if in.IdempotencyKey == "" || in.UserID <= 0 {
		return nil, false, errors.New("billing operation requires key and user")
	}
	if in.SetChargeToTarget {
		if in.ReferenceKey == "" {
			return nil, false, errors.New("target billing operation requires reference key")
		}
		if err := FlushBillingQuotaBatches(in.UserID, in.TokenID); err != nil {
			return nil, false, err
		}
	}
	dbNow := GetDBTimestamp()
	var operation BillingOperation
	applied := false
	err := DB.Transaction(func(tx *gorm.DB) error {
		now := time.Now().Unix()
		if in.SetChargeToTarget {
			var lineageRoot BillingOperation
			if err := lockForUpdate(tx).Where("idempotency_key = ? AND state = ?", in.ReferenceKey, "committed").First(&lineageRoot).Error; err != nil {
				return err
			}
			if lineageRoot.UserID != in.UserID || lineageRoot.TokenID != in.TokenID || lineageRoot.BillingSource != in.BillingSource ||
				(in.SubscriptionID > 0 && lineageRoot.SubscriptionID != in.SubscriptionID) {
				return errors.New("billing target does not match reference lineage")
			}
			in.SubscriptionID = lineageRoot.SubscriptionID
			in.SubscriptionUsageGeneration = lineageRoot.SubscriptionUsageGeneration
			if err := tx.Where("idempotency_key = ?", in.IdempotencyKey).First(&operation).Error; err == nil {
				if operation.Kind != in.Kind || operation.UserID != in.UserID || operation.TokenID != in.TokenID ||
					operation.SubscriptionID != in.SubscriptionID || operation.SubscriptionUsageGeneration != in.SubscriptionUsageGeneration ||
					operation.BillingSource != in.BillingSource || operation.ChargedQuota != in.ChargedQuota || operation.ReferenceKey != in.ReferenceKey {
					return errors.New("billing idempotency key reused with different operation")
				}
				if operation.State == "committed" {
					return nil
				}
			} else if !errors.Is(err, gorm.ErrRecordNotFound) {
				return err
			}
			var previous BillingOperation
			if err := lockForUpdate(tx).Where("reference_key = ? AND state = ?", in.ReferenceKey, "committed").Order("id DESC").First(&previous).Error; err != nil {
				return err
			}
			if previous.UserID != in.UserID || previous.TokenID != in.TokenID || previous.BillingSource != in.BillingSource ||
				previous.SubscriptionID != in.SubscriptionID || previous.SubscriptionUsageGeneration != in.SubscriptionUsageGeneration {
				return errors.New("billing target does not match reference lineage")
			}
			in.Delta = in.ChargedQuota - previous.ChargedQuota
			in.OverageSubscriptionID = previous.OverageSubscriptionID
			in.OverageUsageGeneration = previous.OverageUsageGeneration
		}
		operation = BillingOperation{IdempotencyKey: in.IdempotencyKey, Kind: in.Kind, UserID: in.UserID,
			TokenID: in.TokenID, SubscriptionID: in.SubscriptionID, SubscriptionUsageGeneration: in.SubscriptionUsageGeneration, BillingSource: in.BillingSource,
			OverageSubscriptionID: in.OverageSubscriptionID, OverageUsageGeneration: in.OverageUsageGeneration,
			Delta: in.Delta, ChargedQuota: in.ChargedQuota, ReferenceKey: in.ReferenceKey,
			State: "pending", CreatedAt: now, UpdatedAt: now}
		result := tx.Clauses(clause.OnConflict{DoNothing: true}).Create(&operation)
		if result.Error != nil {
			return result.Error
		}
		if result.RowsAffected == 0 {
			if err := tx.Where("idempotency_key = ?", in.IdempotencyKey).First(&operation).Error; err != nil {
				return err
			}
			if operation.Kind != in.Kind || operation.UserID != in.UserID || operation.TokenID != in.TokenID ||
				(in.SubscriptionID > 0 && operation.SubscriptionID != in.SubscriptionID) ||
				(in.SubscriptionUsageGeneration > 0 && operation.SubscriptionUsageGeneration != in.SubscriptionUsageGeneration) ||
				operation.BillingSource != in.BillingSource ||
				operation.Delta != in.Delta || operation.ChargedQuota != in.ChargedQuota || operation.ReferenceKey != in.ReferenceKey {
				return errors.New("billing idempotency key reused with different operation")
			}
			if operation.State == "committed" {
				return nil
			}
		}

		if in.BillingSource == "subscription" {
			var sub UserSubscription
			if in.SubscriptionID > 0 {
				err := lockForUpdate(tx).Unscoped().Where("id = ?", in.SubscriptionID).First(&sub).Error
				if errors.Is(err, gorm.ErrRecordNotFound) && in.SubscriptionUsageGeneration != 0 {
					// A delayed settle/refund may outlive the subscription row. Skip
					// period funding, but still commit its token bookkeeping below.
					sub = UserSubscription{Id: in.SubscriptionID, UsageGeneration: UnknownSubscriptionUsageGeneration}
				} else if err != nil {
					return err
				} else if sub.UserId != in.UserID {
					return errors.New("subscription does not belong to billing user")
				}
			} else {
				var subs []UserSubscription
				if err := lockForUpdate(tx).Where("user_id = ? AND status = ? AND end_time > ?", in.UserID, "active", dbNow).
					Order("end_time asc, id asc").Find(&subs).Error; err != nil {
					return err
				}
				for _, candidate := range subs {
					plan, err := getSubscriptionPlanByIdTx(tx, candidate.PlanId)
					if err != nil {
						return err
					}
					if err := maybeResetUserSubscriptionWithPlanTx(tx, &candidate, plan, dbNow); err != nil {
						return err
					}
				}
				if err := lockForUpdate(tx).
					Where("user_id = ? AND status = ? AND end_time > ?", in.UserID, "active", dbNow).
					Where("amount_total = 0 OR amount_used <= amount_total - ?", in.Delta).
					Order("end_time asc, id asc").First(&sub).Error; err != nil {
					return fmt.Errorf("subscription quota insufficient, need=%d", in.Delta)
				}
			}
			generation := in.SubscriptionUsageGeneration
			if generation == 0 {
				generation = sub.UsageGeneration
			}
			operation.SubscriptionID = sub.Id
			operation.SubscriptionUsageGeneration = generation
			if in.Delta != 0 && sub.UsageGeneration == generation {
				newUsed := sub.AmountUsed + int64(in.Delta)
				if newUsed < 0 || (sub.AmountTotal > 0 && newUsed > sub.AmountTotal) {
					return fmt.Errorf("subscription quota insufficient, need=%d", in.Delta)
				}
				if err := tx.Model(&sub).Update("amount_used", newUsed).Error; err != nil {
					return err
				}
			}
		}
		if in.OverageSubscriptionID > 0 && in.Delta != 0 {
			var overageSub UserSubscription
			if err := lockForUpdate(tx).Unscoped().Where("id = ?", in.OverageSubscriptionID).First(&overageSub).Error; err != nil {
				if !errors.Is(err, gorm.ErrRecordNotFound) {
					return err
				}
			} else {
				if overageSub.UserId != in.UserID {
					return errors.New("overage subscription does not belong to billing user")
				}
				if overageSub.UsageGeneration == in.OverageUsageGeneration {
					newOverage := overageSub.OverageUsed + int64(in.Delta)
					if newOverage < 0 {
						newOverage = 0
					}
					if err := tx.Model(&overageSub).Update("overage_used", newOverage).Error; err != nil {
						return err
					}
				}
			}
		}

		if in.Delta != 0 {
			if in.BillingSource != "subscription" {
				query := tx.Model(&User{}).Where("id = ?", in.UserID)
				if in.Delta > 0 {
					query = query.Where("quota >= ?", in.Delta)
				}
				result := query.Update("quota", gorm.Expr("quota - ?", in.Delta))
				if result.Error != nil || result.RowsAffected != 1 {
					if result.Error != nil {
						return result.Error
					}
					return errors.New("wallet quota insufficient")
				}
			}
			if in.TokenID > 0 {
				var token Token
				if err := lockForUpdate(tx).Where("id = ? AND user_id = ?", in.TokenID, in.UserID).First(&token).Error; err != nil {
					return err
				}
				if !token.UnlimitedQuota {
					query := tx.Model(&Token{}).Where("id = ? AND user_id = ?", in.TokenID, in.UserID)
					if in.Delta > 0 {
						query = query.Where("remain_quota >= ?", in.Delta)
					}
					result := query.Updates(map[string]any{"remain_quota": gorm.Expr("remain_quota - ?", in.Delta), "used_quota": gorm.Expr("used_quota + ?", in.Delta)})
					if result.Error != nil || result.RowsAffected != 1 {
						if result.Error != nil {
							return result.Error
						}
						return errors.New("token quota insufficient")
					}
				}
			}
		}
		operation.State = "committed"
		operation.UpdatedAt = now
		if err := tx.Save(&operation).Error; err != nil {
			return err
		}
		applied = true
		return nil
	})
	return &operation, applied, err
}

func GetCommittedBillingOperation(key string) (*BillingOperation, error) {
	var operation BillingOperation
	if err := DB.Where("idempotency_key = ? AND state = ?", key, "committed").First(&operation).Error; err != nil {
		return nil, err
	}
	return &operation, nil
}

// GetCommittedBillingCharge returns the journal's current committed charge for
// a canonical initial operation, including reserves and prior settlements.
// ChargedQuota is the resulting charge after each operation; unlike Delta it
// also represents pre-journal legacy reservations imported with a zero delta.
func GetCommittedBillingCharge(referenceKey string) (int, error) {
	var operation BillingOperation
	err := DB.
		Where("reference_key = ? AND state = ?", referenceKey, "committed").
		Order("id DESC").First(&operation).Error
	return operation.ChargedQuota, err
}

func PendingBillingOperationProjections(limit int) []BillingOperation {
	var operations []BillingOperation
	_ = DB.Where("state = ? AND cache_projection_completed = ?", "committed", false).Order("id").Limit(limit).Find(&operations).Error
	return operations
}

func CompleteBillingOperationProjection(id int64) error {
	return DB.Model(&BillingOperation{}).Where("id = ? AND state = ?", id, "committed").Update("cache_projection_completed", true).Error
}

func HasPendingBillingOperationProjections() bool {
	var count int64
	return DB.Model(&BillingOperation{}).Where("state = ? AND cache_projection_completed = ?", "committed", false).Limit(1).Count(&count).Error == nil && count > 0
}
