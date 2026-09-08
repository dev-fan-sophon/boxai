package model

import (
	"fmt"
	"math"
	"path/filepath"
	"testing"

	"github.com/dev-fan-sophon/boxai/common"
	"github.com/dev-fan-sophon/boxai/setting/operation_setting"
	"github.com/glebarez/sqlite"
	"github.com/stretchr/testify/assert"
	"github.com/stretchr/testify/require"
	"gorm.io/gorm"
)

func setupTopUpDiscountTestDB(t *testing.T) {
	t.Helper()
	oldDB, oldRate, oldQuota := DB, operation_setting.USDExchangeRate, common.QuotaPerUnit
	db, err := gorm.Open(sqlite.Open(filepath.Join(t.TempDir(), "discount.db")+"?_pragma=busy_timeout(5000)&_pragma=journal_mode(WAL)"), &gorm.Config{})
	require.NoError(t, err)
	require.NoError(t, db.AutoMigrate(&User{}, &TopUp{}, &TopUpPromotion{}, &TopUpCoupon{}, &TopUpSubmission{}, &SubscriptionOrder{}, &SubscriptionPlan{}))
	DB, operation_setting.USDExchangeRate, common.QuotaPerUnit = db, 25000, 100
	t.Cleanup(func() {
		DB, operation_setting.USDExchangeRate, common.QuotaPerUnit = oldDB, oldRate, oldQuota
		sqlDB, e := db.DB()
		if e == nil {
			_ = sqlDB.Close()
		}
	})
	require.NoError(t, DB.Create(&User{Id: 1, Username: "one", AffCode: "one"}).Error)
	require.NoError(t, DB.Create(&User{Id: 2, Username: "two", AffCode: "two"}).Error)
	p := defaultTopUpPromotion()
	p.Enabled = true
	require.NoError(t, SaveTopUpPromotion(&p))
}

func discountTestOrder(userID int, trade string) *TopUp {
	return &TopUp{UserId: userID, TradeNo: trade, FaceAmountMinor: 100000, PaymentMethod: PaymentMethodBankQR, PaymentProvider: PaymentProviderBankQR, Status: common.TopUpStatusPending, CreateTime: common.GetTimestamp()}
}

func TestTopUpDiscountAmountsAndEligibility(t *testing.T) {
	setupTopUpDiscountTestDB(t)
	for _, tc := range []struct{ face, discount int64 }{{99999, 0}, {100000, 30000}, {333333, 99999}, {333334, 100000}, {499999999, 100000}} {
		s, err := QuoteTopUpDiscount(1, tc.face, "")
		require.NoError(t, err)
		assert.Equal(t, tc.discount, s.ActivityDiscount)
		assert.Equal(t, tc.face-tc.discount, s.PaidAmount)
	}
	for _, face := range []int64{-1, 0, 9999, MaxTopUpFaceVND, math.MaxInt64} {
		_, err := QuoteTopUpDiscount(1, face, "")
		assert.ErrorIs(t, err, ErrTopUpQuoteOutOfRange)
	}
	c := TopUpCoupon{Code: " welcome ", Enabled: true, MinAmount: 100000, DiscountType: "fixed", DiscountValue: 10000}
	require.NoError(t, SaveTopUpCoupon(&c, true))
	assert.Equal(t, "WELCOME", c.Code)
	s, err := QuoteTopUpDiscount(1, 100000, "welcome")
	require.NoError(t, err)
	assert.EqualValues(t, 70000, s.PaidAmount)
	assert.Empty(t, s.CouponCode)
	c.DiscountValue = 40000
	require.NoError(t, SaveTopUpCoupon(&c, false))
	s, err = QuoteTopUpDiscount(1, 100000, c.Code)
	require.NoError(t, err)
	assert.EqualValues(t, 60000, s.PaidAmount)
	assert.Zero(t, s.ActivityDiscount)
	c.Stackable = true
	c.DiscountType = "percent"
	c.DiscountValue = 10
	require.NoError(t, SaveTopUpCoupon(&c, false))
	s, err = QuoteTopUpDiscount(1, 100000, c.Code)
	require.NoError(t, err)
	assert.EqualValues(t, 63000, s.PaidAmount)
	assert.EqualValues(t, 7000, s.CouponDiscount)
	c.DiscountType = "fixed"
	c.DiscountValue = 70000
	require.NoError(t, SaveTopUpCoupon(&c, false))
	_, err = QuoteTopUpDiscount(1, 100000, c.Code)
	assert.ErrorIs(t, err, ErrTopUpDiscountNonPositive)
	c.DiscountValue = 1000
	c.UserID = 2
	require.NoError(t, SaveTopUpCoupon(&c, false))
	_, err = QuoteTopUpDiscount(1, 100000, c.Code)
	assert.ErrorIs(t, err, ErrTopUpCouponUnavailable)
	_, err = QuoteTopUpDiscount(2, 99999, c.Code)
	assert.ErrorIs(t, err, ErrTopUpCouponUnavailable)
	c.UserID = 0
	c.StartsAt = common.GetTimestamp() + 60
	require.NoError(t, SaveTopUpCoupon(&c, false))
	_, err = QuoteTopUpDiscount(1, 100000, c.Code)
	assert.ErrorIs(t, err, ErrTopUpCouponUnavailable)
	c.StartsAt = 0
	c.EndsAt = common.GetTimestamp()
	require.NoError(t, SaveTopUpCoupon(&c, false))
	_, err = QuoteTopUpDiscount(1, 100000, c.Code)
	assert.ErrorIs(t, err, ErrTopUpCouponUnavailable)
}

func TestTopUpDiscountReservationLifecycleAndSnapshot(t *testing.T) {
	setupTopUpDiscountTestDB(t)
	c := TopUpCoupon{Code: "ONCE", Enabled: true, DiscountType: "fixed", DiscountValue: 10000, Stackable: true, TotalLimit: 1, PerUserLimit: 1}
	require.NoError(t, SaveTopUpCoupon(&c, true))
	first := discountTestOrder(1, "FIRST")
	require.NoError(t, CreateDiscountedBankQRTopUp(first, c.Code, 10))
	assert.EqualValues(t, 60000, first.PaidAmount)
	assert.EqualValues(t, 400, first.Amount)
	_, err := QuoteTopUpDiscount(2, 100000, c.Code)
	assert.ErrorIs(t, err, ErrTopUpCouponUnavailable)
	require.ErrorIs(t, CancelBankQRTopUp(2, first.TradeNo), ErrBankQROrderNotFound)
	require.NoError(t, CancelBankQRTopUp(1, first.TradeNo))
	require.NoError(t, CancelBankQRTopUp(1, first.TradeNo))
	require.ErrorIs(t, CreateTopUpSubmission(&TopUpSubmission{UserId: 1, TradeNo: first.TradeNo}), ErrBankQROrderNotPending)
	expired := discountTestOrder(1, "EXPIRED")
	require.NoError(t, CreateDiscountedBankQRTopUp(expired, c.Code, 10))
	require.NoError(t, DB.Model(expired).Update("expires_at", common.GetTimestamp()-1).Error)
	require.ErrorIs(t, CreateTopUpSubmission(&TopUpSubmission{UserId: 1, TradeNo: expired.TradeNo}), ErrBankQROrderExpired)
	held := discountTestOrder(1, "HELD")
	require.NoError(t, CreateDiscountedBankQRTopUp(held, c.Code, 10))
	sub := &TopUpSubmission{UserId: 1, TradeNo: held.TradeNo, BankTransactionNo: "BANK1"}
	require.NoError(t, CreateTopUpSubmission(sub))
	require.NoError(t, DB.Model(held).Update("expires_at", common.GetTimestamp()-1).Error)
	require.ErrorIs(t, CancelBankQRTopUp(1, held.TradeNo), ErrTopUpSubmissionActive)
	_, err = QuoteTopUpDiscount(2, 100000, c.Code)
	assert.ErrorIs(t, err, ErrTopUpCouponUnavailable)
	// Changing live pricing/FX does not change the reserved face credit or bill.
	p := defaultTopUpPromotion()
	p.Enabled = false
	require.NoError(t, SaveTopUpPromotion(&p))
	c.DiscountValue = 20000
	require.NoError(t, SaveTopUpCoupon(&c, false))
	operation_setting.USDExchangeRate = 50000
	_, err = ReviewTopUpSubmission(sub.Id, 99, true, "")
	require.NoError(t, err)
	_, err = ReviewTopUpSubmission(sub.Id, 99, true, "")
	require.NoError(t, err)
	var user User
	require.NoError(t, DB.First(&user, 1).Error)
	assert.Equal(t, 400, user.Quota)
	var saved TopUp
	require.NoError(t, DB.First(&saved, held.Id).Error)
	assert.EqualValues(t, 60000, saved.Money)
	assert.Equal(t, "25000", saved.CreditFXRate)
	assert.Equal(t, TopUpSubmissionApproved, saved.SubmissionStatus)
	_, err = QuoteTopUpDiscount(2, 100000, c.Code)
	assert.ErrorIs(t, err, ErrTopUpCouponUnavailable)
	items, _, err := ListTopUpReviews("", "", 10, 0)
	require.NoError(t, err)
	require.Len(t, items, 1)
	assert.EqualValues(t, 60000, items[0].PaidAmount)
	assert.EqualValues(t, 100000, items[0].FaceAmount)
}

func TestTopUpDiscountRejectedExpiredHoldReleases(t *testing.T) {
	setupTopUpDiscountTestDB(t)
	p := defaultTopUpPromotion()
	p.Enabled = true
	p.TotalBudget = 30000
	p.PerUserLimit = 1
	require.NoError(t, SaveTopUpPromotion(&p))
	order := discountTestOrder(1, "REJECT")
	require.NoError(t, CreateDiscountedBankQRTopUp(order, "", 10))
	sub := &TopUpSubmission{UserId: 1, TradeNo: order.TradeNo}
	require.NoError(t, CreateTopUpSubmission(sub))
	require.NoError(t, DB.Model(order).Update("expires_at", common.GetTimestamp()-1).Error)
	s, err := QuoteTopUpDiscount(2, 100000, "")
	require.NoError(t, err)
	assert.Zero(t, s.ActivityDiscount)
	_, err = ReviewTopUpSubmission(sub.Id, 99, false, "invalid")
	require.NoError(t, err)
	s, err = QuoteTopUpDiscount(1, 100000, "")
	require.NoError(t, err)
	assert.EqualValues(t, 30000, s.ActivityDiscount)
	require.ErrorIs(t, CreateTopUpSubmission(&TopUpSubmission{UserId: 1, TradeNo: order.TradeNo}), ErrBankQROrderExpired)
}

func TestTopUpDiscountConcurrentLimits(t *testing.T) {
	for _, kind := range []string{"coupon-total", "coupon-user", "activity-budget", "activity-user"} {
		t.Run(kind, func(t *testing.T) {
			setupTopUpDiscountTestDB(t)
			p := defaultTopUpPromotion()
			p.Enabled = true
			code := ""
			if kind == "activity-budget" {
				p.TotalBudget = 30000
			}
			if kind == "activity-user" {
				p.PerUserLimit = 1
			}
			require.NoError(t, SaveTopUpPromotion(&p))
			if kind == "coupon-total" || kind == "coupon-user" {
				c := TopUpCoupon{Code: "LAST", Enabled: true, DiscountType: "fixed", DiscountValue: 40000}
				if kind == "coupon-total" {
					c.TotalLimit = 1
				} else {
					c.PerUserLimit = 1
				}
				require.NoError(t, SaveTopUpCoupon(&c, true))
				code = c.Code
			}
			start := make(chan struct{})
			results := make(chan error, 2)
			for i := 1; i <= 2; i++ {
				userID := i
				if kind == "coupon-user" || kind == "activity-user" {
					userID = 1
				}
				order := discountTestOrder(userID, fmt.Sprintf("RACE%d", i))
				go func() { <-start; results <- CreateDiscountedBankQRTopUp(order, code, 10) }()
			}
			close(start)
			failures := 0
			for i := 0; i < 2; i++ {
				err := <-results
				if err != nil {
					require.ErrorIs(t, err, ErrTopUpCouponUnavailable)
					failures++
				}
			}
			var orders []TopUp
			require.NoError(t, DB.Find(&orders).Error)
			var discounted int
			for _, o := range orders {
				if (code != "" && o.CouponDiscount > 0) || (code == "" && o.ActivityDiscount > 0) {
					discounted++
				}
			}
			assert.Equal(t, 1, discounted)
			if code != "" {
				assert.Equal(t, 1, failures)
			} else {
				assert.Zero(t, failures)
				assert.Len(t, orders, 2)
			}
		})
	}
}

func TestTopUpDiscountConfigurationBounds(t *testing.T) {
	setupTopUpDiscountTestDB(t)
	for _, v := range []int64{-1, 0, 101, math.MaxInt64} {
		p := defaultTopUpPromotion()
		p.PercentOff = v
		assert.ErrorIs(t, SaveTopUpPromotion(&p), ErrTopUpDiscountInvalid)
		c := TopUpCoupon{Code: "BAD", DiscountType: "percent", DiscountValue: v}
		assert.ErrorIs(t, SaveTopUpCoupon(&c, true), ErrTopUpDiscountInvalid)
	}
	p := defaultTopUpPromotion()
	p.TotalBudget = math.MaxInt64
	assert.ErrorIs(t, SaveTopUpPromotion(&p), ErrTopUpDiscountInvalid)
	c := TopUpCoupon{Code: "SAFE", Enabled: true, DiscountType: "fixed", DiscountValue: 1000}
	require.NoError(t, SaveTopUpCoupon(&c, true))
	c.Code = "RENAMED"
	assert.ErrorIs(t, SaveTopUpCoupon(&c, false), ErrTopUpDiscountInvalid)
	c.Code = "BAD SPACE"
	assert.ErrorIs(t, SaveTopUpCoupon(&c, true), ErrTopUpDiscountInvalid)
}
