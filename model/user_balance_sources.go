package model

import (
	"errors"
	"fmt"
	"strings"

	"github.com/dev-fan-sophon/boxai/common"
	"gorm.io/gorm"
)

// UserQuotaAdjustment is committed with the wallet change, unlike best-effort
// audit logs. OperatorID identifies who granted credit, not a paying customer.
type UserQuotaAdjustment struct {
	ID            int    `json:"id"`
	UserID        int    `json:"user_id" gorm:"index"`
	OperatorID    int    `json:"operator_id"`
	Mode          string `json:"mode" gorm:"type:varchar(16)"`
	Delta         int64  `json:"delta" gorm:"type:bigint"`
	BalanceBefore int    `json:"balance_before"`
	BalanceAfter  int    `json:"balance_after"`
	CreatedAt     int64  `json:"created_at"`
}

func AdjustUserQuota(userID, operatorID int, mode string, value int) (*UserQuotaAdjustment, error) {
	if userID <= 0 || operatorID <= 0 || value > common.MaxQuota || value < -common.MaxQuota {
		return nil, errors.New("invalid quota adjustment")
	}
	if mode != "override" && (value <= 0 || (mode != "add" && mode != "subtract")) {
		return nil, errors.New("invalid quota adjustment")
	}
	entry := &UserQuotaAdjustment{UserID: userID, OperatorID: operatorID, Mode: mode, CreatedAt: common.GetTimestamp()}
	err := DB.Transaction(func(tx *gorm.DB) error {
		var user User
		if err := lockForUpdate(tx).Select("id", "quota").First(&user, userID).Error; err != nil {
			return err
		}
		after := int64(value)
		switch mode {
		case "add":
			after = int64(user.Quota) + int64(value)
		case "subtract":
			after = int64(user.Quota) - int64(value)
		}
		if after > int64(common.MaxQuota) || after < -int64(common.MaxQuota) {
			return errors.New("adjusted quota exceeds storage range")
		}
		entry.BalanceBefore = user.Quota
		entry.BalanceAfter = int(after)
		entry.Delta = after - int64(user.Quota)
		if entry.Delta == 0 {
			return nil
		}
		result := tx.Model(&User{}).Where("id = ? AND quota = ?", userID, user.Quota).Update("quota", entry.BalanceAfter)
		if result.Error != nil {
			return result.Error
		}
		if result.RowsAffected != 1 {
			return errors.New("balance changed; retry adjustment")
		}
		return tx.Create(entry).Error
	})
	if err != nil {
		return nil, err
	}
	if err := invalidateUserCache(userID); err != nil {
		common.SysError("failed to invalidate user cache after adjustment: " + err.Error())
	}
	return entry, nil
}

type BalanceSourceTotal struct {
	Source string `json:"source"`
	Quota  int64  `json:"quota"`
	Count  int64  `json:"count"`
	LastAt int64  `json:"last_at"`
}

type BalanceSourceEvidence struct {
	ID         int    `json:"id"`
	CreatedAt  int64  `json:"created_at"`
	Content    string `json:"content"`
	OperatorID int    `json:"operator_id,omitempty"`
}

type UserBalanceSources struct {
	Sources             []BalanceSourceTotal    `json:"sources"`
	PaidOrderCount      int64                   `json:"paid_order_count"`
	LastPaidAt          int64                   `json:"last_paid_at"`
	Adjustments         []UserQuotaAdjustment   `json:"adjustments"`
	HistoricalEvidence  []BalanceSourceEvidence `json:"historical_evidence"`
	EvidenceUnavailable bool                    `json:"evidence_unavailable"`
	UnconvertedOrders   int64                   `json:"unconverted_orders"`
}

// Totals describe recorded lifetime inflows, not the composition of today's
// balance. Refunds are not new funding. Never infer payments from topup logs:
// they also contain gifts, reward transfers and wallet subscription purchases.
func GetUserBalanceSources(userID int) (*UserBalanceSources, error) {
	result := &UserBalanceSources{Sources: []BalanceSourceTotal{}, Adjustments: []UserQuotaAdjustment{}, HistoricalEvidence: []BalanceSourceEvidence{}}
	paid := BalanceSourceTotal{Source: "paid_topup"}
	var orders []TopUp
	if err := DB.Where("user_id = ? AND status = ? AND money > 0 AND payment_method <> ? AND payment_provider <> ?", userID, common.TopUpStatusSuccess, PaymentMethodBalance, PaymentProviderBalance).Find(&orders).Error; err != nil {
		return nil, err
	}
	var subscriptionTrades []string
	if err := DB.Model(&SubscriptionOrder{}).Where("user_id = ?", userID).Pluck("trade_no", &subscriptionTrades).Error; err != nil {
		return nil, err
	}
	subscriptions := make(map[string]bool, len(subscriptionTrades))
	for _, trade := range subscriptionTrades {
		subscriptions[trade] = true
	}
	for _, order := range orders {
		result.PaidOrderCount++
		result.LastPaidAt = max(result.LastPaidAt, order.CompleteTime)
		// Subscription mirrors record payment but do not credit the wallet.
		if subscriptions[order.TradeNo] || order.Amount == 0 {
			continue
		}
		quota, err := TopUpQuota(&order)
		if err != nil {
			result.UnconvertedOrders++
			continue
		}
		paid.Quota += int64(quota)
		paid.Count++
		paid.LastAt = max(paid.LastAt, order.CompleteTime)
	}
	result.Sources = append(result.Sources, paid)
	for _, source := range []struct {
		name  string
		query *gorm.DB
	}{
		{"reward_transfer", DB.Model(&RewardLedger{}).Select("COALESCE(SUM(-delta), 0) AS quota, COUNT(*) AS count, COALESCE(MAX(created_time), 0) AS last_at").Where("user_id = ? AND type = ? AND ref_type = ? AND delta < 0", userID, RewardLedgerTypeRedeem, "wallet")},
		{"redemption", DB.Unscoped().Model(&Redemption{}).Select("COALESCE(SUM(quota), 0) AS quota, COUNT(*) AS count, COALESCE(MAX(redeemed_time), 0) AS last_at").Where("used_user_id = ? AND status = ?", userID, common.RedemptionCodeStatusUsed)},
		{"checkin", DB.Model(&Checkin{}).Select("COALESCE(SUM(quota_awarded), 0) AS quota, COUNT(*) AS count, COALESCE(MAX(created_at), 0) AS last_at").Where("user_id = ?", userID)},
		{"admin_credit", DB.Model(&UserQuotaAdjustment{}).Select("COALESCE(SUM(delta), 0) AS quota, COUNT(*) AS count, COALESCE(MAX(created_at), 0) AS last_at").Where("user_id = ? AND delta > 0", userID)},
		{"admin_debit", DB.Model(&UserQuotaAdjustment{}).Select("COALESCE(SUM(-delta), 0) AS quota, COUNT(*) AS count, COALESCE(MAX(created_at), 0) AS last_at").Where("user_id = ? AND delta < 0", userID)},
	} {
		var total BalanceSourceTotal
		if err := source.query.Scan(&total).Error; err != nil {
			return nil, err
		}
		total.Source = source.name
		result.Sources = append(result.Sources, total)
	}
	if err := DB.Where("user_id = ?", userID).Order("id DESC").Limit(20).Find(&result.Adjustments).Error; err != nil {
		return nil, err
	}
	// Legacy amounts were formatted with historical currency settings. Retain
	// their original evidence instead of converting text with today's FX rate.
	var logs []Log
	err := LOG_DB.Where("(user_id = ? AND type IN ?) OR (type = ? AND other LIKE ?)", userID, []int{LogTypeTopup, LogTypeSystem, LogTypeManage}, LogTypeManage, fmt.Sprintf("%%\"target_user_id\":%d%%", userID)).
		Order("id DESC").Limit(200).Find(&logs).Error
	if err != nil {
		result.EvidenceUnavailable = true
		common.SysError("failed to read balance source evidence: " + err.Error())
		return result, nil
	}
	for _, log := range logs {
		operatorID := 0
		if log.Type == LogTypeManage {
			var other struct {
				Op struct {
					Action string `json:"action"`
					Params struct {
						TargetUserID int `json:"target_user_id"`
					} `json:"params"`
				} `json:"op"`
			}
			if common.UnmarshalJsonStr(log.Other, &other) != nil || !strings.HasPrefix(other.Op.Action, "user.quota_") {
				continue
			}
			target := other.Op.Params.TargetUserID
			if target == 0 {
				target = log.UserId
			}
			if target != userID {
				continue
			}
			operatorID = log.UserId
		}
		result.HistoricalEvidence = append(result.HistoricalEvidence, BalanceSourceEvidence{ID: log.Id, CreatedAt: log.CreatedAt, Content: log.Content, OperatorID: operatorID})
		if len(result.HistoricalEvidence) == 20 {
			break
		}
	}
	return result, nil
}
