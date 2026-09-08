package model

import (
	"errors"
	"regexp"
	"strings"

	"github.com/dev-fan-sophon/boxai/common"
	"gorm.io/gorm"
	"gorm.io/gorm/clause"
)

// The singleton also serializes reservation, submission, review and cancellation
// transactions. Taking a write lock before any reads works on SQLite as well as
// MySQL/Postgres and avoids snapshot write-skew across different users/coupons.
type TopUpPromotion struct {
	ID             int    `json:"id" gorm:"primaryKey"`
	Enabled        bool   `json:"enabled"`
	StartsAt       int64  `json:"starts_at"`
	EndsAt         int64  `json:"ends_at"`
	MinAmount      int64  `json:"min_amount"`
	PercentOff     int64  `json:"percent_off"`
	MaxDiscount    int64  `json:"max_discount"`
	PerUserLimit   int64  `json:"per_user_limit"`
	TotalBudget    int64  `json:"total_budget"`
	BannerEnabled  bool   `json:"banner_enabled"`
	BannerPosition string `json:"banner_position" gorm:"type:varchar(16)"`
	BannerText     string `json:"banner_text" gorm:"type:text"`
}

type TopUpCoupon struct {
	ID            int    `json:"id" gorm:"primaryKey"`
	Code          string `json:"code" gorm:"type:varchar(64);uniqueIndex"`
	Enabled       bool   `json:"enabled"`
	StartsAt      int64  `json:"starts_at"`
	EndsAt        int64  `json:"ends_at"`
	MinAmount     int64  `json:"min_amount"`
	DiscountType  string `json:"discount_type" gorm:"type:varchar(16)"`
	DiscountValue int64  `json:"discount_value"`
	MaxDiscount   int64  `json:"max_discount"`
	TotalLimit    int64  `json:"total_limit"`
	PerUserLimit  int64  `json:"per_user_limit"`
	UserID        int    `json:"user_id"`
	Stackable     bool   `json:"stackable"`
}

// Orders are the reservation ledger: pending holds, successful redemptions and
// immutable price/FX snapshots live together, so credit cannot bypass a hold.
type TopUpDiscountSnapshot struct {
	PaidAmount       int64   `json:"paid_amount"`
	FaceAmount       int64   `json:"face_amount"`
	ActivityDiscount int64   `json:"activity_discount"`
	CouponDiscount   int64   `json:"coupon_discount"`
	CouponCode       string  `json:"coupon_code" gorm:"type:varchar(64)"`
	CouponID         int     `json:"-" gorm:"index"`
	CreditUSD        float64 `json:"credit_usd"`
	ExpiresAt        int64   `json:"expires_at" gorm:"index"`
	SubmissionStatus string  `json:"submission_status" gorm:"type:varchar(20)"`
}

var ErrTopUpDiscountInvalid = errors.New("invalid top-up discount configuration")
var ErrTopUpCouponUnavailable = errors.New("coupon is invalid, ineligible or exhausted")
var ErrTopUpDiscountNonPositive = errors.New("discount must leave a positive payment amount")
var ErrBankQROrderExpired = errors.New("Bank QR order has expired")

var topUpCouponCodePattern = regexp.MustCompile(`^[A-Z0-9_-]{1,64}$`)

func defaultTopUpPromotion() TopUpPromotion {
	return TopUpPromotion{ID: 1, MinAmount: 100000, PercentOff: 30, MaxDiscount: 100000, BannerPosition: "console_top"}
}

func lockTopUpDiscounts(tx *gorm.DB) error {
	p := defaultTopUpPromotion()
	if err := tx.Clauses(clause.OnConflict{DoNothing: true}).Create(&p).Error; err != nil {
		return err
	}
	return tx.Model(&TopUpPromotion{}).Where("id = ?", 1).UpdateColumn("id", 1).Error
}

func GetTopUpPromotion() (TopUpPromotion, error) {
	p := defaultTopUpPromotion()
	err := DB.First(&p, 1).Error
	if errors.Is(err, gorm.ErrRecordNotFound) {
		return defaultTopUpPromotion(), nil
	}
	return p, err
}

func validTopUpDiscountWindow(start, end, minimum, cap int64) bool {
	return start >= 0 && end >= 0 && (end == 0 || end > start) && minimum >= 0 && minimum < MaxTopUpFaceVND && cap >= 0 && cap < MaxTopUpFaceVND
}

func SaveTopUpPromotion(p *TopUpPromotion) error {
	if p == nil || !validTopUpDiscountWindow(p.StartsAt, p.EndsAt, p.MinAmount, p.MaxDiscount) || p.PercentOff < 1 || p.PercentOff > 100 || p.PerUserLimit < 0 || p.PerUserLimit > 1_000_000_000 || p.TotalBudget < 0 || p.TotalBudget > 1_000_000_000_000_000 || len(p.BannerText) > 4000 {
		return ErrTopUpDiscountInvalid
	}
	if p.BannerPosition == "" {
		p.BannerPosition = "console_top"
	}
	if p.BannerPosition != "console_top" && p.BannerPosition != "billing" && p.BannerPosition != "both" {
		return ErrTopUpDiscountInvalid
	}
	p.ID = 1
	return DB.Transaction(func(tx *gorm.DB) error {
		if err := lockTopUpDiscounts(tx); err != nil {
			return err
		}
		return tx.Save(p).Error
	})
}

func SaveTopUpCoupon(c *TopUpCoupon, create bool) error {
	if c == nil {
		return ErrTopUpDiscountInvalid
	}
	c.Code = strings.ToUpper(strings.TrimSpace(c.Code))
	if !topUpCouponCodePattern.MatchString(c.Code) || !validTopUpDiscountWindow(c.StartsAt, c.EndsAt, c.MinAmount, c.MaxDiscount) || c.DiscountValue <= 0 || c.DiscountValue >= MaxTopUpFaceVND || (c.DiscountType != "fixed" && c.DiscountType != "percent") || (c.DiscountType == "percent" && c.DiscountValue > 100) || c.TotalLimit < 0 || c.TotalLimit > 1_000_000_000 || c.PerUserLimit < 0 || c.PerUserLimit > 1_000_000_000 || c.UserID < 0 {
		return ErrTopUpDiscountInvalid
	}
	return DB.Transaction(func(tx *gorm.DB) error {
		if err := lockTopUpDiscounts(tx); err != nil {
			return err
		}
		if c.UserID > 0 {
			var user User
			if err := tx.Select("id").First(&user, c.UserID).Error; err != nil {
				return err
			}
		}
		if create {
			c.ID = 0
			return tx.Create(c).Error
		}
		var old TopUpCoupon
		if err := tx.First(&old, c.ID).Error; err != nil {
			return err
		}
		// A code's identity is permanent; renaming would allow confusing reuse of
		// an old code while historical reservations still count against this ID.
		if old.Code != c.Code {
			return ErrTopUpDiscountInvalid
		}
		return tx.Save(c).Error
	})
}

func ListTopUpCoupons(limit, offset int) ([]TopUpCoupon, int64, error) {
	items := make([]TopUpCoupon, 0)
	var total int64
	if err := DB.Model(&TopUpCoupon{}).Count(&total).Error; err != nil {
		return nil, 0, err
	}
	err := DB.Order("id desc").Limit(limit).Offset(offset).Find(&items).Error
	return items, total, err
}

func topUpDiscountActive(enabled bool, start, end, now int64) bool {
	return enabled && (start == 0 || start <= now) && (end == 0 || now < end)
}

// Integer flooring is intentional: discounts never round above their advertised
// percentage. Inputs are bounded below 500M VND and 100%, so no overflow occurs.
func topUpDiscountAmount(base, value, cap int64, percentage bool) int64 {
	discount := value
	if percentage {
		discount = base * value / 100
	}
	if cap > 0 && discount > cap {
		discount = cap
	}
	return discount
}

func heldTopUpDiscounts(tx *gorm.DB, now int64) *gorm.DB {
	active := tx.Model(&TopUpSubmission{}).Select("trade_no").Where("status = ?", TopUpSubmissionSubmitted)
	return tx.Model(&TopUp{}).Where("payment_provider = ?", PaymentProviderBankQR).
		Where("status = ? OR (status = ? AND (expires_at > ? OR trade_no IN (?)))", common.TopUpStatusSuccess, common.TopUpStatusPending, now, active)
}

func quoteTopUpDiscountTx(tx *gorm.DB, userID int, face int64, code string, now int64) (TopUpDiscountSnapshot, error) {
	s := TopUpDiscountSnapshot{FaceAmount: face, PaidAmount: face, ExpiresAt: now + BankQRPendingOrderWindowSeconds}
	if userID <= 0 || face < MinTopUpFaceVND || face >= MaxTopUpFaceVND {
		return s, ErrTopUpQuoteOutOfRange
	}
	var p TopUpPromotion
	if err := tx.First(&p, 1).Error; err != nil {
		return s, err
	}
	if topUpDiscountActive(p.Enabled, p.StartsAt, p.EndsAt, now) && face >= p.MinAmount {
		discount := topUpDiscountAmount(face, p.PercentOff, p.MaxDiscount, true)
		var count, used int64
		if err := heldTopUpDiscounts(tx, now).Where("activity_discount > 0 AND user_id = ?", userID).Count(&count).Error; err != nil {
			return s, err
		}
		if err := heldTopUpDiscounts(tx, now).Select("COALESCE(SUM(activity_discount), 0)").Scan(&used).Error; err != nil {
			return s, err
		}
		if (p.PerUserLimit == 0 || count < p.PerUserLimit) && (p.TotalBudget == 0 || discount <= p.TotalBudget-used) {
			s.ActivityDiscount = discount
		}
	}
	code = strings.ToUpper(strings.TrimSpace(code))
	if code != "" {
		if !topUpCouponCodePattern.MatchString(code) {
			return s, ErrTopUpCouponUnavailable
		}
		var c TopUpCoupon
		if err := tx.Where("code = ?", code).First(&c).Error; err != nil {
			if errors.Is(err, gorm.ErrRecordNotFound) {
				return s, ErrTopUpCouponUnavailable
			}
			return s, err
		}
		if !topUpDiscountActive(c.Enabled, c.StartsAt, c.EndsAt, now) || face < c.MinAmount || (c.UserID != 0 && c.UserID != userID) {
			return s, ErrTopUpCouponUnavailable
		}
		var count, userCount int64
		if err := heldTopUpDiscounts(tx, now).Where("coupon_id = ?", c.ID).Count(&count).Error; err != nil {
			return s, err
		}
		if err := heldTopUpDiscounts(tx, now).Where("coupon_id = ? AND user_id = ?", c.ID, userID).Count(&userCount).Error; err != nil {
			return s, err
		}
		if (c.TotalLimit > 0 && count >= c.TotalLimit) || (c.PerUserLimit > 0 && userCount >= c.PerUserLimit) {
			return s, ErrTopUpCouponUnavailable
		}
		base := face
		if c.Stackable {
			base -= s.ActivityDiscount
		}
		discount := topUpDiscountAmount(base, c.DiscountValue, c.MaxDiscount, c.DiscountType == "percent")
		if c.Stackable || discount > s.ActivityDiscount {
			if !c.Stackable {
				s.ActivityDiscount = 0
			}
			if discount > 0 {
				s.CouponDiscount, s.CouponID, s.CouponCode = discount, c.ID, c.Code
			}
		}
	}
	s.PaidAmount = face - s.ActivityDiscount - s.CouponDiscount
	if s.PaidAmount <= 0 {
		return s, ErrTopUpDiscountNonPositive
	}
	return s, nil
}

func QuoteTopUpDiscount(userID int, face int64, code string) (TopUpDiscountSnapshot, error) {
	var s TopUpDiscountSnapshot
	err := DB.Transaction(func(tx *gorm.DB) error {
		if err := lockTopUpDiscounts(tx); err != nil {
			return err
		}
		var err error
		s, err = quoteTopUpDiscountTx(tx, userID, face, code, common.GetTimestamp())
		return err
	})
	return s, err
}

func CreateDiscountedBankQRTopUp(order *TopUp, code string, maxPending int) error {
	if order == nil || order.UserId <= 0 || order.PaymentProvider != PaymentProviderBankQR || order.PaymentMethod != PaymentMethodBankQR || order.Status != common.TopUpStatusPending {
		return ErrBankQROrderInvalid
	}
	return DB.Transaction(func(tx *gorm.DB) error {
		if err := lockTopUpDiscounts(tx); err != nil {
			return err
		}
		var user User
		if err := lockForUpdate(tx).Select("id").First(&user, order.UserId).Error; err != nil {
			return err
		}
		count, err := countPendingBankQROrdersTx(tx, order.UserId)
		if err != nil {
			return err
		}
		if count >= int64(maxPending) {
			return ErrBankQRPendingOrderLimit
		}
		// Recompute both FX and discounts inside the reservation transaction.
		quote, err := QuoteVNDTopUp(order.FaceAmountMinor)
		if err != nil {
			return err
		}
		quote.Apply(order)
		s, err := quoteTopUpDiscountTx(tx, order.UserId, order.FaceAmountMinor, code, common.GetTimestamp())
		if err != nil {
			return err
		}
		s.CreditUSD = USDCents(quote.CreditCents).InexactFloat64()
		order.TopUpDiscountSnapshot = s
		order.Money = float64(s.PaidAmount)
		return tx.Create(order).Error
	})
}

func CancelBankQRTopUp(userID int, tradeNo string) error {
	return DB.Transaction(func(tx *gorm.DB) error {
		if err := lockTopUpDiscounts(tx); err != nil {
			return err
		}
		var order TopUp
		if err := lockForUpdate(tx).Where("trade_no = ? AND user_id = ?", tradeNo, userID).First(&order).Error; err != nil {
			return ErrBankQROrderNotFound
		}
		if order.PaymentProvider != PaymentProviderBankQR || order.PaymentMethod != PaymentMethodBankQR {
			return ErrBankQROrderInvalid
		}
		if order.Status == "cancelled" {
			return nil
		}
		if order.Status != common.TopUpStatusPending {
			return ErrBankQROrderNotPending
		}
		var active int64
		if err := tx.Model(&TopUpSubmission{}).Where("trade_no = ? AND status = ?", tradeNo, TopUpSubmissionSubmitted).Count(&active).Error; err != nil {
			return err
		}
		if active > 0 {
			return ErrTopUpSubmissionActive
		}
		return tx.Model(&order).Update("status", "cancelled").Error
	})
}
