package model

import (
	"crypto/sha256"
	"errors"
	"fmt"
	"strings"
	"time"

	"github.com/dev-fan-sophon/boxai/common"
	"github.com/dev-fan-sophon/boxai/setting/operation_setting"
	"gorm.io/gorm"
	"gorm.io/gorm/clause"
)

const (
	TrialStatusPending   = "pending"
	TrialStatusApproved  = "approved"
	TrialStatusRejected  = "rejected"
	TrialStatusSuspended = "suspended"

	TrialReservationReserved = "reserved"
	TrialReservationSettled  = "settled"
	TrialReservationRefunded = "refunded"
)

var (
	ErrTrialUnavailable = errors.New("trial unavailable")
	ErrTrialIneligible  = errors.New("user is not eligible for a trial")
	ErrTrialDuplicate   = errors.New("trial reservation request already exists")
	ErrTrialCapacity    = errors.New("trial capacity exceeded")
)

type TrialGrant struct {
	ID              int64  `json:"id"`
	UserID          int    `json:"user_id" gorm:"uniqueIndex;not null"`
	IdentityHash    string `json:"-" gorm:"type:char(64);uniqueIndex;not null"`
	ClaimIP         string `json:"-" gorm:"type:varchar(64)"`
	Status          string `json:"status" gorm:"type:varchar(16);index;not null"`
	Total           int    `json:"total"`
	Remaining       int    `json:"remaining"`
	Reserved        int    `json:"reserved"`
	Used            int    `json:"used"`
	ExpiresAt       int64  `json:"expires_at"`
	Models          string `json:"models" gorm:"type:text"`
	MaxConcurrency  int    `json:"max_concurrency"`
	MaxRequestQuota int    `json:"max_request_quota"`
	ReviewerID      int    `json:"reviewer_id"`
	ReviewReason    string `json:"review_reason" gorm:"type:text"`
	CreatedAt       int64  `json:"created_at" gorm:"autoCreateTime"`
	ReviewedAt      int64  `json:"reviewed_at"`
}

type TrialDailyBudget struct {
	Date      string `json:"date" gorm:"type:varchar(10);primaryKey"`
	Allocated int    `json:"allocated"`
}

type TrialReservation struct {
	RequestID      string `json:"request_id" gorm:"type:varchar(191);primaryKey"`
	UserID         int    `json:"user_id" gorm:"index;not null"`
	TokenID        int    `json:"token_id"`
	TokenUnlimited bool   `json:"-"`
	Model          string `json:"model" gorm:"type:varchar(191)"`
	Reserved       int    `json:"reserved"`
	Funded         int    `json:"funded"`
	Actual         int    `json:"actual"`
	Subsidized     int    `json:"subsidized"`
	State          string `json:"state" gorm:"type:varchar(16);index"`
	CreatedAt      int64  `json:"created_at" gorm:"autoCreateTime"`
	UpdatedAt      int64  `json:"updated_at" gorm:"autoUpdateTime"`
}

func trialIdentity(email string) string {
	return fmt.Sprintf("%x", sha256.Sum256([]byte(common.EmailRiskIdentity(email))))
}

func trialPolicyEnabled() (operation_setting.RegistrationRiskPolicy, error) {
	p := operation_setting.GetRegistrationRiskPolicy()
	if !p.Enabled || !p.TrialEnabled {
		return p, ErrTrialUnavailable
	}
	return p, nil
}

func trialDomainBlocked(email string, blocked []string) bool {
	_, domain, ok := strings.Cut(strings.ToLower(strings.TrimSpace(email)), "@")
	if !ok || domain == "" {
		return true
	}
	for _, b := range blocked {
		if domain == b || strings.HasSuffix(domain, "."+b) {
			return true
		}
	}
	return false
}

func eligibleTrialUser(tx *gorm.DB, userID int, email string, p operation_setting.RegistrationRiskPolicy) (*User, error) {
	var user User
	if err := tx.Where("id = ?", userID).First(&user).Error; err != nil {
		return nil, ErrTrialIneligible
	}
	normalized := strings.ToLower(strings.TrimSpace(email))
	if user.Status != common.UserStatusEnabled || user.CreatedAt < p.TrialEligibleAfter || normalized == "" || strings.ToLower(strings.TrimSpace(user.Email)) != normalized || trialDomainBlocked(normalized, p.BlockedEmailDomains) {
		return nil, ErrTrialIneligible
	}
	return &user, nil
}

func RequestTrial(userID int, email, ip string) (*TrialGrant, error) {
	p, err := trialPolicyEnabled()
	if err != nil {
		return nil, err
	}
	var grant TrialGrant
	err = DB.Transaction(func(tx *gorm.DB) error {
		// Serialize same-user claims before insert; on PostgreSQL a uniqueness
		// error aborts the transaction, so never query inside a failed insert.
		var user User
		if err := lockForUpdate(tx).First(&user, userID).Error; err != nil {
			return err
		}
		if _, err := eligibleTrialUser(tx, userID, email, p); err != nil {
			return err
		}
		if err := tx.Where("user_id = ?", userID).First(&grant).Error; err == nil {
			return nil
		} else if !errors.Is(err, gorm.ErrRecordNotFound) {
			return err
		}
		grant = TrialGrant{UserID: userID, IdentityHash: trialIdentity(email), ClaimIP: ip, Status: TrialStatusPending}
		return tx.Create(&grant).Error
	})
	return &grant, err
}

func GetTrialGrant(userID int) (*TrialGrant, error) {
	var g TrialGrant
	err := DB.Where("user_id = ?", userID).First(&g).Error
	if errors.Is(err, gorm.ErrRecordNotFound) {
		return nil, nil
	}
	return &g, err
}

func ReviewTrial(userID, reviewerID int, approve bool, reason string) (*TrialGrant, error) {
	p, err := trialPolicyEnabled()
	if err != nil {
		return nil, err
	}
	var g TrialGrant
	err = DB.Transaction(func(tx *gorm.DB) error {
		if err := lockForUpdate(tx).Where("user_id = ?", userID).First(&g).Error; err != nil {
			return err
		}
		want := TrialStatusRejected
		if approve {
			want = TrialStatusApproved
		}
		if g.Status == want {
			return nil
		}
		if g.Status != TrialStatusPending {
			return errors.New("trial has already been reviewed")
		}
		var user User
		if err := tx.Where("id = ?", userID).First(&user).Error; err != nil {
			return ErrTrialIneligible
		}
		if _, err := eligibleTrialUser(tx, userID, user.Email, p); err != nil || trialIdentity(user.Email) != g.IdentityHash {
			return ErrTrialIneligible
		}
		now := time.Now().Unix()
		g.Status, g.ReviewerID, g.ReviewReason, g.ReviewedAt = want, reviewerID, reason, now
		if !approve {
			return tx.Save(&g).Error
		}
		models, err := common.Marshal(p.TrialModels)
		if err != nil {
			return err
		}
		g.Total, g.Remaining, g.Models = p.TrialQuota, p.TrialQuota, string(models)
		g.ExpiresAt = now + int64(p.TrialDays)*86400
		g.MaxConcurrency, g.MaxRequestQuota = p.TrialMaxConcurrency, p.TrialMaxRequestQuota
		date := time.Unix(now, 0).UTC().Format("2006-01-02")
		if err := tx.Clauses(clause.OnConflict{DoNothing: true}).Create(&TrialDailyBudget{Date: date}).Error; err != nil {
			return err
		}
		var budget TrialDailyBudget
		if err := lockForUpdate(tx).Where("date = ?", date).First(&budget).Error; err != nil {
			return err
		}
		result := tx.Model(&TrialDailyBudget{}).Where("date = ? AND allocated <= ?", date, p.TrialDailyBudget-p.TrialQuota).Update("allocated", gorm.Expr("allocated + ?", p.TrialQuota))
		if result.Error != nil {
			return result.Error
		}
		if result.RowsAffected != 1 {
			return ErrTrialCapacity
		}
		return tx.Save(&g).Error
	})
	return &g, err
}

func trialModelAllowed(modelsJSON, model string, current []string) bool {
	var snapshot []string
	if common.UnmarshalJsonStr(modelsJSON, &snapshot) != nil {
		return false
	}
	in := func(xs []string) bool {
		for _, x := range xs {
			if x == model {
				return true
			}
		}
		return false
	}
	return in(snapshot) && in(current)
}

func validTrialToken(tx *gorm.DB, userID, tokenID int, now int64) (*Token, error) {
	if tokenID == 0 {
		return nil, nil
	}
	var token Token
	if err := lockForUpdate(tx).Where("id = ? AND user_id = ?", tokenID, userID).First(&token).Error; err != nil {
		return nil, ErrTrialIneligible
	}
	if token.Status != common.TokenStatusEnabled || (token.ExpiredTime != -1 && token.ExpiredTime < now) {
		return nil, ErrTrialIneligible
	}
	return &token, nil
}

// Finalization must remain possible after a token is disabled, expires, or is
// soft-deleted; otherwise its already-reserved quota could never be reconciled.
func trialReservationToken(tx *gorm.DB, userID, tokenID int) (*Token, error) {
	if tokenID == 0 {
		return nil, nil
	}
	var token Token
	if err := lockForUpdate(tx.Unscoped()).Where("id = ? AND user_id = ?", tokenID, userID).First(&token).Error; err != nil {
		return nil, err
	}
	return &token, nil
}

func ReserveTrial(userID, tokenID int, requestID, modelName string, amount int) (*TrialReservation, error) {
	if amount < 1 || int64(amount) > int64(^uint32(0)>>1) || requestID == "" || len(requestID) > 191 {
		return nil, ErrTrialCapacity
	}
	p, err := trialPolicyEnabled()
	if err != nil {
		return nil, err
	}
	var r TrialReservation
	err = DB.Transaction(func(tx *gorm.DB) error {
		var g TrialGrant
		if err := lockForUpdate(tx).Where("user_id = ?", userID).First(&g).Error; err != nil {
			return ErrTrialIneligible
		}
		now := time.Now().Unix()
		if g.Status != TrialStatusApproved || now >= g.ExpiresAt || !trialModelAllowed(g.Models, modelName, p.TrialModels) {
			return ErrTrialIneligible
		}
		var user User
		if err := tx.Where("id = ? AND status = ?", userID, common.UserStatusEnabled).First(&user).Error; err != nil {
			return ErrTrialIneligible
		}
		maxReq := g.MaxRequestQuota
		if p.TrialMaxRequestQuota < maxReq {
			maxReq = p.TrialMaxRequestQuota
		}
		if amount > maxReq || amount > g.Remaining {
			return ErrTrialCapacity
		}
		maxConcurrent := g.MaxConcurrency
		if p.TrialMaxConcurrency < maxConcurrent {
			maxConcurrent = p.TrialMaxConcurrency
		}
		var count int64
		if err := tx.Model(&TrialReservation{}).Where("user_id = ? AND state = ?", userID, TrialReservationReserved).Count(&count).Error; err != nil {
			return err
		}
		if count >= int64(maxConcurrent) {
			return ErrTrialCapacity
		}
		var existing TrialReservation
		if err := tx.Where("request_id = ?", requestID).First(&existing).Error; err == nil {
			return ErrTrialDuplicate
		} else if !errors.Is(err, gorm.ErrRecordNotFound) {
			return err
		}
		token, err := validTrialToken(tx, userID, tokenID, now)
		if err != nil {
			return err
		}
		if token != nil {
			if !token.UnlimitedQuota && token.RemainQuota < amount {
				return ErrTrialCapacity
			}
			updates := map[string]any{"used_quota": gorm.Expr("used_quota + ?", amount), "accessed_time": now}
			if !token.UnlimitedQuota {
				updates["remain_quota"] = gorm.Expr("remain_quota - ?", amount)
			}
			if err := tx.Model(token).Updates(updates).Error; err != nil {
				return err
			}
		}
		if res := tx.Model(&TrialGrant{}).Where("id = ? AND remaining >= ?", g.ID, amount).Updates(map[string]any{"remaining": gorm.Expr("remaining - ?", amount), "reserved": gorm.Expr("reserved + ?", amount)}); res.Error != nil || res.RowsAffected != 1 {
			if res.Error != nil {
				return res.Error
			}
			return ErrTrialCapacity
		}
		r = TrialReservation{RequestID: requestID, UserID: userID, TokenID: tokenID, Model: modelName, Reserved: amount, State: TrialReservationReserved}
		if token != nil {
			r.TokenUnlimited = token.UnlimitedQuota
		}
		return tx.Create(&r).Error
	})
	return &r, err
}

func ResizeTrialReservation(requestID string, target int) error {
	if target < 0 || target > common.MaxQuota {
		return ErrTrialCapacity
	}
	return DB.Transaction(func(tx *gorm.DB) error {
		var probe TrialReservation
		if err := tx.Where("request_id = ?", requestID).First(&probe).Error; err != nil {
			return err
		}
		var g TrialGrant
		if err := lockForUpdate(tx).Where("user_id = ?", probe.UserID).First(&g).Error; err != nil {
			return err
		}
		var r TrialReservation
		if err := lockForUpdate(tx).Where("request_id = ?", requestID).First(&r).Error; err != nil {
			return err
		}
		if r.State != TrialReservationReserved {
			return errors.New("trial reservation is final")
		}
		if target == r.Reserved {
			return nil
		}
		if target > r.Reserved {
			p, err := trialPolicyEnabled()
			if err != nil {
				return err
			}
			if g.Status != TrialStatusApproved || time.Now().Unix() >= g.ExpiresAt || !trialModelAllowed(g.Models, r.Model, p.TrialModels) || target > g.MaxRequestQuota || target > p.TrialMaxRequestQuota || target-r.Reserved > g.Remaining {
				return ErrTrialCapacity
			}
		}
		delta := r.Reserved - target
		if r.TokenID > 0 {
			token, err := trialReservationToken(tx, r.UserID, r.TokenID)
			if err != nil {
				return err
			}
			if delta < 0 && (token.DeletedAt.Valid || token.Status != common.TokenStatusEnabled || (token.ExpiredTime != -1 && token.ExpiredTime < time.Now().Unix()) || (!r.TokenUnlimited && token.RemainQuota < -delta) || token.UnlimitedQuota != r.TokenUnlimited) {
				return ErrTrialCapacity
			}
			updates := map[string]any{"used_quota": gorm.Expr("used_quota - ?", delta)}
			if !r.TokenUnlimited {
				updates["remain_quota"] = gorm.Expr("remain_quota + ?", delta)
			}
			if err = tx.Unscoped().Model(token).Updates(updates).Error; err != nil {
				return err
			}
		}
		if err := tx.Model(&g).Updates(map[string]any{"remaining": gorm.Expr("remaining + ?", delta), "reserved": gorm.Expr("reserved - ?", delta)}).Error; err != nil {
			return err
		}
		r.Reserved = target
		return tx.Save(&r).Error
	})
}

func FinishTrialReservation(requestID string, actual int, refund bool) (*TrialReservation, error) {
	if actual < 0 || actual > common.MaxQuota {
		return nil, ErrTrialCapacity
	}
	var r TrialReservation
	err := DB.Transaction(func(tx *gorm.DB) error {
		var probe TrialReservation
		if err := tx.Where("request_id = ?", requestID).First(&probe).Error; err != nil {
			return err
		}
		var g TrialGrant
		if err := lockForUpdate(tx).Where("user_id = ?", probe.UserID).First(&g).Error; err != nil {
			return err
		}
		if err := lockForUpdate(tx).Where("request_id = ?", requestID).First(&r).Error; err != nil {
			return err
		}
		if r.State != TrialReservationReserved {
			return nil
		}
		token, err := trialReservationToken(tx, r.UserID, r.TokenID)
		if err != nil {
			return err
		}
		if refund {
			if token != nil {
				u := map[string]any{"used_quota": gorm.Expr("used_quota - ?", r.Reserved)}
				if !r.TokenUnlimited {
					u["remain_quota"] = gorm.Expr("remain_quota + ?", r.Reserved)
				}
				if err := tx.Unscoped().Model(token).Updates(u).Error; err != nil {
					return err
				}
			}
			if err := tx.Model(&g).Updates(map[string]any{"remaining": gorm.Expr("remaining + ?", r.Reserved), "reserved": gorm.Expr("reserved - ?", r.Reserved)}).Error; err != nil {
				return err
			}
			r.State = TrialReservationRefunded
			r.Actual = actual
			return tx.Save(&r).Error
		}
		extra := actual - r.Reserved
		if extra < 0 {
			extra = 0
		}
		available := g.Remaining
		if perRequest := g.MaxRequestQuota - r.Reserved; perRequest < available {
			available = perRequest
		}
		if token != nil && (!r.TokenUnlimited || !token.UnlimitedQuota) && token.RemainQuota < available {
			available = token.RemainQuota
		}
		if token != nil && token.UnlimitedQuota != r.TokenUnlimited {
			available = 0
		}
		if available < 0 {
			available = 0
		}
		fundedExtra := extra
		if fundedExtra > available {
			fundedExtra = available
		}
		funded := r.Reserved + fundedExtra
		if funded > actual {
			funded = actual
		}
		giveBack := r.Reserved - funded
		if giveBack < 0 {
			giveBack = 0
		}
		if token != nil {
			delta := funded - r.Reserved
			u := map[string]any{"used_quota": gorm.Expr("used_quota + ?", delta)}
			if !r.TokenUnlimited {
				u["remain_quota"] = gorm.Expr("remain_quota - ?", delta)
			}
			if err := tx.Unscoped().Model(token).Updates(u).Error; err != nil {
				return err
			}
		}
		updates := map[string]any{"reserved": gorm.Expr("reserved - ?", r.Reserved), "remaining": gorm.Expr("remaining - ? + ?", fundedExtra, giveBack), "used": gorm.Expr("used + ?", funded)}
		if actual > funded {
			updates["status"] = TrialStatusSuspended
		}
		if err := tx.Model(&g).Updates(updates).Error; err != nil {
			return err
		}
		r.State, r.Actual, r.Funded, r.Subsidized = TrialReservationSettled, actual, funded, actual-funded
		return tx.Save(&r).Error
	})
	return &r, err
}
