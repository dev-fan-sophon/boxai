package model

import (
	"fmt"
	"path/filepath"
	"sync"
	"testing"
	"time"

	"github.com/dev-fan-sophon/boxai/common"
	"github.com/dev-fan-sophon/boxai/setting/operation_setting"
	"github.com/glebarez/sqlite"
	"github.com/stretchr/testify/assert"
	"github.com/stretchr/testify/require"
	"gorm.io/gorm"
)

func setupTrialTest(t *testing.T) {
	t.Helper()
	oldDB := DB
	oldPolicy, _ := common.Marshal(operation_setting.GetRegistrationRiskPolicy())
	db, err := gorm.Open(sqlite.Open(filepath.Join(t.TempDir(), "trial.db")), &gorm.Config{})
	require.NoError(t, err)
	sqlDB, err := db.DB()
	require.NoError(t, err)
	sqlDB.SetMaxOpenConns(1)
	require.NoError(t, db.AutoMigrate(&User{}, &Token{}, &TrialGrant{}, &TrialReservation{}, &TrialDailyBudget{}, &RegistrationRiskCounter{}))
	DB = db
	t.Cleanup(func() {
		DB = oldDB
		require.NoError(t, operation_setting.SetRegistrationRiskPolicy(string(oldPolicy)))
		_ = sqlDB.Close()
	})
	p := operation_setting.GetRegistrationRiskPolicy()
	p.Enabled, p.TrialEnabled, p.TrialEligibleAfter = true, true, time.Now().Unix()-86400
	p.TrialQuota, p.TrialDailyBudget, p.TrialMaxRequestQuota = 100, 200, 80
	p.TrialModels = []string{"allowed-model"}
	p.BlockedEmailDomains = []string{"disposable.example"}
	raw, err := common.Marshal(p)
	require.NoError(t, err)
	require.NoError(t, operation_setting.SetRegistrationRiskPolicy(string(raw)))
}

func trialTestUser(t *testing.T, id int, email string) *User {
	t.Helper()
	u := &User{Id: id, Username: fmt.Sprintf("trial-%d", id), AffCode: fmt.Sprintf("aff-%d", id), Email: email, Status: common.UserStatusEnabled, Quota: 37}
	require.NoError(t, DB.Create(u).Error)
	return u
}

func approveTrialTestUser(t *testing.T, id int) {
	t.Helper()
	u := trialTestUser(t, id, fmt.Sprintf("user%d@example.com", id))
	_, err := RequestTrial(id, u.Email, "192.0.2.1")
	require.NoError(t, err)
	_, err = ReviewTrial(id, 99, true, "email and eligibility reviewed")
	require.NoError(t, err)
}

func TestTrialClaimIdentityAndEligibility(t *testing.T) {
	setupTrialTest(t)
	u := trialTestUser(t, 1, "First.Last+promo@googlemail.com")
	first, err := RequestTrial(1, u.Email, "192.0.2.1")
	require.NoError(t, err)
	again, err := RequestTrial(1, u.Email, "192.0.2.2")
	require.NoError(t, err)
	assert.Equal(t, first.ID, again.ID)
	alias := trialTestUser(t, 2, "firstlast@gmail.com")
	_, err = RequestTrial(2, alias.Email, "192.0.2.3")
	require.Error(t, err)
	require.NoError(t, DB.Delete(u).Error)
	_, err = RequestTrial(2, alias.Email, "192.0.2.3")
	require.Error(t, err, "deleted identities cannot claim again")
	for id, email := range map[int]string{3: "first.last+promo@example.com", 4: "firstlast@example.com"} {
		u := trialTestUser(t, id, email)
		_, err := RequestTrial(id, u.Email, "192.0.2.4")
		require.NoError(t, err)
	}
	blocked := trialTestUser(t, 5, "a@sub.disposable.example")
	_, err = RequestTrial(5, blocked.Email, "192.0.2.5")
	assert.ErrorIs(t, err, ErrTrialIneligible)
	old := trialTestUser(t, 6, "old@example.com")
	require.NoError(t, DB.Model(old).Update("created_at", 1).Error)
	_, err = RequestTrial(6, old.Email, "192.0.2.6")
	assert.ErrorIs(t, err, ErrTrialIneligible)
}

func TestTrialDailyBudgetAndReviewIdempotency(t *testing.T) {
	setupTrialTest(t)
	for id := 1; id <= 3; id++ {
		u := trialTestUser(t, id, fmt.Sprintf("u%d@example.com", id))
		_, err := RequestTrial(id, u.Email, "192.0.2.1")
		require.NoError(t, err)
	}
	results := make(chan error, 3)
	var wg sync.WaitGroup
	for id := 1; id <= 3; id++ {
		wg.Add(1)
		go func(id int) { defer wg.Done(); _, err := ReviewTrial(id, 99, true, "reviewed"); results <- err }(id)
	}
	wg.Wait()
	close(results)
	wins := 0
	for err := range results {
		if err == nil {
			wins++
		} else {
			assert.ErrorIs(t, err, ErrTrialCapacity)
		}
	}
	assert.Equal(t, 2, wins)
	var budget TrialDailyBudget
	require.NoError(t, DB.First(&budget).Error)
	assert.Equal(t, 200, budget.Allocated)
	var approved TrialGrant
	require.NoError(t, DB.Where("status = ?", TrialStatusApproved).First(&approved).Error)
	_, err := ReviewTrial(approved.UserID, 99, true, "retry")
	require.NoError(t, err)
	require.NoError(t, DB.First(&budget).Error)
	assert.Equal(t, 200, budget.Allocated)
	_, err = ReviewTrial(approved.UserID, 99, false, "conflicting decision")
	require.Error(t, err)
}

func TestTrialAtomicReservationLimits(t *testing.T) {
	setupTrialTest(t)
	approveTrialTestUser(t, 1)
	_, err := ReserveTrial(1, 0, "wrong-model", "other-model", 20)
	assert.ErrorIs(t, err, ErrTrialIneligible)
	_, err = ReserveTrial(1, 0, "too-much", "allowed-model", 81)
	assert.ErrorIs(t, err, ErrTrialCapacity)
	_, err = ReserveTrial(1, 12345, "bad-token", "allowed-model", 20)
	require.Error(t, err)
	g, err := GetTrialGrant(1)
	require.NoError(t, err)
	assert.Equal(t, 100, g.Remaining)
	results := make(chan error, 2)
	var wg sync.WaitGroup
	for i := 0; i < 2; i++ {
		wg.Add(1)
		go func(i int) {
			defer wg.Done()
			_, err := ReserveTrial(1, 0, fmt.Sprintf("concurrent-%d", i), "allowed-model", 60)
			results <- err
		}(i)
	}
	wg.Wait()
	close(results)
	wins := 0
	for err := range results {
		if err == nil {
			wins++
		} else {
			assert.ErrorIs(t, err, ErrTrialCapacity)
		}
	}
	assert.Equal(t, 1, wins)
	g, err = GetTrialGrant(1)
	require.NoError(t, err)
	assert.Equal(t, 40, g.Remaining)
	assert.Equal(t, 60, g.Reserved)
	var r TrialReservation
	require.NoError(t, DB.Where("state = ?", TrialReservationReserved).First(&r).Error)
	_, err = FinishTrialReservation(r.RequestID, 0, true)
	require.NoError(t, err)
	_, err = ReserveTrial(1, 0, r.RequestID, "allowed-model", 20)
	assert.ErrorIs(t, err, ErrTrialDuplicate)
	require.NoError(t, DB.Model(&TrialGrant{}).Where("user_id = ?", 1).Update("expires_at", time.Now().Unix()).Error)
	_, err = ReserveTrial(1, 0, "expired", "allowed-model", 20)
	assert.ErrorIs(t, err, ErrTrialIneligible)
}

func TestTrialSettlementRefundAndResizeReconcileTokens(t *testing.T) {
	setupTrialTest(t)
	approveTrialTestUser(t, 1)
	token := Token{Id: 1, UserId: 1, Key: "trial-token", Status: common.TokenStatusEnabled, ExpiredTime: -1, RemainQuota: 150}
	require.NoError(t, DB.Create(&token).Error)
	_, err := ReserveTrial(1, 1, "lower-actual", "allowed-model", 60)
	require.NoError(t, err)
	require.NoError(t, ResizeTrialReservation("lower-actual", 75))
	require.NoError(t, ResizeTrialReservation("lower-actual", 75))
	require.ErrorIs(t, ResizeTrialReservation("lower-actual", 81), ErrTrialCapacity)
	r, err := FinishTrialReservation("lower-actual", 23, false)
	require.NoError(t, err)
	assert.Equal(t, 23, r.Funded)
	_, err = FinishTrialReservation("lower-actual", 23, false)
	require.NoError(t, err)
	_, err = FinishTrialReservation("lower-actual", 0, true)
	require.NoError(t, err)
	g, err := GetTrialGrant(1)
	require.NoError(t, err)
	assert.Equal(t, 77, g.Remaining)
	assert.Zero(t, g.Reserved)
	assert.Equal(t, 23, g.Used)
	require.NoError(t, DB.First(&token, 1).Error)
	assert.Equal(t, 127, token.RemainQuota)
	assert.Equal(t, 23, token.UsedQuota)
	_, err = ReserveTrial(1, 1, "refund", "allowed-model", 31)
	require.NoError(t, err)
	_, err = FinishTrialReservation("refund", 0, true)
	require.NoError(t, err)
	_, err = FinishTrialReservation("refund", 0, true)
	require.NoError(t, err)
	require.NoError(t, DB.First(&token, 1).Error)
	assert.Equal(t, 127, token.RemainQuota)
	assert.Equal(t, 23, token.UsedQuota)
	var u User
	require.NoError(t, DB.First(&u, 1).Error)
	assert.Equal(t, 37, u.Quota, "paid wallet never changes")
}

func TestTrialOverrunPreservesActualUsageAndSuspendsGrant(t *testing.T) {
	setupTrialTest(t)
	approveTrialTestUser(t, 1)
	_, err := ReserveTrial(1, 0, "overrun", "allowed-model", 60)
	require.NoError(t, err)
	require.NoError(t, DB.Model(&TrialGrant{}).Where("user_id = ?", 1).Update("expires_at", 1).Error)
	r, err := FinishTrialReservation("overrun", 137, false)
	require.NoError(t, err)
	assert.Equal(t, 137, r.Actual)
	assert.Equal(t, 80, r.Funded)
	assert.Equal(t, 57, r.Subsidized)
	g, err := GetTrialGrant(1)
	require.NoError(t, err)
	assert.Equal(t, 20, g.Remaining)
	assert.Zero(t, g.Reserved)
	assert.Equal(t, 80, g.Used)
	assert.Equal(t, TrialStatusSuspended, g.Status)
	_, err = ReserveTrial(1, 0, "cannot-repeat", "allowed-model", 1)
	require.Error(t, err)
}

func TestRegistrationRiskCounterWindowAndCanonicalMailbox(t *testing.T) {
	setupTrialTest(t)
	require.NoError(t, TakeRegistrationRiskSlot(DB, "mail", common.EmailRiskIdentity("a.b+tag@gmail.com"), 2, 3600))
	require.NoError(t, TakeRegistrationRiskSlot(DB, "mail", common.EmailRiskIdentity("ab@googlemail.com"), 2, 3600))
	require.Error(t, TakeRegistrationRiskSlot(DB, "mail", "ab@gmail.com", 2, 3600))
	require.NoError(t, DB.Model(&RegistrationRiskCounter{}).Where("expires_at > ?", 0).Update("expires_at", 1).Error)
	require.NoError(t, TakeRegistrationRiskSlot(DB, "mail", "ab@gmail.com", 2, 3600))
	var counter RegistrationRiskCounter
	require.NoError(t, DB.First(&counter).Error)
	assert.Equal(t, 1, counter.Requests)
	assert.Equal(t, RegistrationRiskNetwork("2001:db8:1::1"), RegistrationRiskNetwork("2001:db8:1::ffff"))
	assert.NotEqual(t, RegistrationRiskNetwork("2001:db8:1::1"), RegistrationRiskNetwork("2001:db8:2::1"))
}

func TestTrialKillSwitchAllowsFinalizationButNotNewSpending(t *testing.T) {
	setupTrialTest(t)
	approveTrialTestUser(t, 1)
	token := Token{Id: 1, UserId: 1, Key: "limited", Status: common.TokenStatusEnabled, ExpiredTime: -1, RemainQuota: 19}
	require.NoError(t, DB.Create(&token).Error)
	_, err := ReserveTrial(1, 1, "too-large", "allowed-model", 20)
	require.ErrorIs(t, err, ErrTrialCapacity)
	_, err = ReserveTrial(1, 1, "in-flight", "allowed-model", 13)
	require.NoError(t, err)
	p := operation_setting.GetRegistrationRiskPolicy()
	p.TrialEnabled = false
	raw, err := common.Marshal(p)
	require.NoError(t, err)
	require.NoError(t, operation_setting.SetRegistrationRiskPolicy(string(raw)))
	_, err = ReserveTrial(1, 0, "new", "allowed-model", 1)
	require.ErrorIs(t, err, ErrTrialUnavailable)
	require.ErrorIs(t, ResizeTrialReservation("in-flight", 14), ErrTrialUnavailable)
	require.NoError(t, DB.Delete(&token).Error)
	r, err := FinishTrialReservation("in-flight", 7, false)
	require.NoError(t, err)
	assert.Equal(t, 7, r.Funded)
	require.NoError(t, DB.Unscoped().First(&token, 1).Error)
	assert.Equal(t, 12, token.RemainQuota)
	g, err := GetTrialGrant(1)
	require.NoError(t, err)
	assert.Equal(t, 93, g.Remaining)
	assert.Zero(t, g.Reserved)
}

func TestRegistrationRiskSharedBudgetAndNoAutomaticGifts(t *testing.T) {
	setupTrialTest(t)
	oldGift, oldRedis := common.QuotaForNewUser, common.RedisEnabled
	common.QuotaForNewUser, common.RedisEnabled = 123, false
	t.Cleanup(func() { common.QuotaForNewUser, common.RedisEnabled = oldGift, oldRedis })
	p := operation_setting.GetRegistrationRiskPolicy()
	p.RegistrationIPDaily = 2
	raw, err := common.Marshal(p)
	require.NoError(t, err)
	require.NoError(t, operation_setting.SetRegistrationRiskPolicy(string(raw)))
	password := &User{Username: "password", Email: "password@example.com", RegisterSource: RegisterSourcePassword, RegisterIp: "192.0.2.1", Status: common.UserStatusEnabled}
	require.NoError(t, password.Insert(0))
	oauth := &User{Username: "oauth", Email: "oauth@example.com", RegisterSource: RegisterSourceOAuth, RegisterIp: "192.0.2.1", Status: common.UserStatusEnabled}
	require.NoError(t, DB.Transaction(func(tx *gorm.DB) error { return oauth.InsertWithTx(tx, 0) }))
	for _, id := range []int{password.Id, oauth.Id} {
		var stored User
		require.NoError(t, DB.First(&stored, id).Error)
		assert.Zero(t, stored.Quota, "trial mode must not also issue a wallet gift")
	}
	third := &User{Username: "third", RegisterSource: RegisterSourceOAuth, RegisterIp: "192.0.2.1"}
	require.Error(t, DB.Transaction(func(tx *gorm.DB) error { return third.InsertWithTx(tx, 0) }))
	admin := &User{Username: "admin-created", RegisterSource: RegisterSourceAdmin, RegisterIp: "192.0.2.1"}
	require.NoError(t, DB.Transaction(func(tx *gorm.DB) error { return admin.InsertWithTx(tx, 0) }))
	blocked := &User{Username: "blocked", Email: "a@sub.disposable.example", RegisterSource: RegisterSourceOAuth, RegisterIp: "192.0.2.2"}
	require.Error(t, DB.Transaction(func(tx *gorm.DB) error { return blocked.InsertWithTx(tx, 0) }))
	var count int64
	require.NoError(t, DB.Model(&User{}).Count(&count).Error)
	assert.EqualValues(t, 3, count)
}
