package model

import (
	"sync"
	"testing"
	"time"

	"github.com/alicebob/miniredis/v2"
	"github.com/dev-fan-sophon/boxai/common"
	"github.com/go-redis/redis/v8"
	"github.com/stretchr/testify/assert"
	"github.com/stretchr/testify/require"
)

func resetQuotaReserveTestState(t *testing.T) {
	t.Helper()
	truncateTables(t)
	oldRedisEnabled, oldRDB := common.RedisEnabled, common.RDB
	oldBatchEnabled := common.BatchUpdateEnabled
	common.RedisEnabled = false
	common.BatchUpdateEnabled = false
	for i := 0; i < BatchUpdateTypeCount; i++ {
		batchUpdateLocks[i].Lock()
		batchUpdateStores[i] = make(map[int]int)
		batchUpdateLocks[i].Unlock()
	}
	t.Cleanup(func() {
		common.RedisEnabled, common.RDB = oldRedisEnabled, oldRDB
		common.BatchUpdateEnabled = oldBatchEnabled
		for i := 0; i < BatchUpdateTypeCount; i++ {
			batchUpdateLocks[i].Lock()
			batchUpdateStores[i] = make(map[int]int)
			batchUpdateLocks[i].Unlock()
		}
	})
}

func useQuotaReserveRedis(t *testing.T) *miniredis.Miniredis {
	t.Helper()
	server := miniredis.RunT(t)
	client := redis.NewClient(&redis.Options{Addr: server.Addr()})
	common.RedisEnabled = true
	common.RDB = client
	t.Cleanup(func() {
		_ = client.Close()
	})
	return server
}

func createQuotaReserveUser(t *testing.T, quota int) User {
	t.Helper()
	user := User{
		Username: "reserve-user-" + common.GetRandomString(8),
		Password: "unused-password-hash",
		Role:     common.RoleCommonUser,
		Status:   common.UserStatusEnabled,
		Group:    "default",
		Quota:    quota,
		AffCode:  "reserve-aff-" + common.GetRandomString(8),
	}
	require.NoError(t, DB.Create(&user).Error)
	return user
}

func createQuotaReserveToken(t *testing.T, userID int, quota int) Token {
	t.Helper()
	token := Token{
		UserId:      userID,
		Key:         "reserve-token-" + common.GetRandomString(10),
		Name:        "reserve-test",
		Status:      common.TokenStatusEnabled,
		ExpiredTime: -1,
		RemainQuota: quota,
	}
	require.NoError(t, DB.Create(&token).Error)
	return token
}

func TestTryReserveQuotaAtomicallyRejectsConcurrentOverspend(t *testing.T) {
	resetQuotaReserveTestState(t)

	user := createQuotaReserveUser(t, 100)
	token := createQuotaReserveToken(t, user.Id, 100)

	const attempts = 8
	userWins := make(chan bool, attempts)
	tokenWins := make(chan bool, attempts)
	userErrors := make(chan error, attempts)
	tokenErrors := make(chan error, attempts)
	var wg sync.WaitGroup
	for range attempts {
		wg.Add(2)
		go func() {
			defer wg.Done()
			reserved, err := TryReserveUserQuota(user.Id, 60)
			userWins <- reserved
			userErrors <- err
		}()
		go func() {
			defer wg.Done()
			reserved, err := TryReserveTokenQuota(token.Id, token.Key, 60, false)
			tokenWins <- reserved
			tokenErrors <- err
		}()
	}
	wg.Wait()
	close(userWins)
	close(tokenWins)
	close(userErrors)
	close(tokenErrors)
	for err := range userErrors {
		require.NoError(t, err)
	}
	for err := range tokenErrors {
		require.NoError(t, err)
	}
	countWins := func(results <-chan bool) int {
		wins := 0
		for reserved := range results {
			if reserved {
				wins++
			}
		}
		return wins
	}
	assert.Equal(t, 1, countWins(userWins))
	assert.Equal(t, 1, countWins(tokenWins))

	var storedUser User
	require.NoError(t, DB.First(&storedUser, user.Id).Error)
	assert.Equal(t, 40, storedUser.Quota)
	var storedToken Token
	require.NoError(t, DB.First(&storedToken, token.Id).Error)
	assert.Equal(t, 40, storedToken.RemainQuota)
	assert.Equal(t, 60, storedToken.UsedQuota)
}

func TestBatchModeKeepsSpendableQuotaDatabaseAuthoritative(t *testing.T) {
	resetQuotaReserveTestState(t)
	useQuotaReserveRedis(t)
	common.BatchUpdateEnabled = true

	user := createQuotaReserveUser(t, 10)
	require.NoError(t, populateUserCache(user))
	reserved, err := TryReserveUserQuota(user.Id, 8)
	require.NoError(t, err)
	assert.True(t, reserved)
	reserved, err = TryReserveUserQuota(user.Id, 3)
	require.NoError(t, err)
	assert.False(t, reserved)

	token := createQuotaReserveToken(t, user.Id, 9)
	_, err = GetTokenByKey(token.Key, true)
	require.NoError(t, err)
	reserved, err = TryReserveTokenQuota(token.Id, token.Key, 7, false)
	require.NoError(t, err)
	assert.True(t, reserved)
	reserved, err = TryReserveTokenQuota(token.Id, token.Key, 3, false)
	require.NoError(t, err)
	assert.False(t, reserved)

	var storedUser User
	require.NoError(t, DB.First(&storedUser, user.Id).Error)
	assert.Equal(t, 2, storedUser.Quota)
	var storedToken Token
	require.NoError(t, DB.First(&storedToken, token.Id).Error)
	assert.Equal(t, 2, storedToken.RemainQuota)
	assert.Equal(t, 7, storedToken.UsedQuota)

	// Batch mode still aggregates non-authoritative usage counters, but it must
	// not defer spendable wallet or token balance mutations.
	batchUpdate()
	require.NoError(t, DB.First(&storedUser, user.Id).Error)
	assert.Equal(t, 2, storedUser.Quota)
	require.NoError(t, DB.First(&storedToken, token.Id).Error)
	assert.Equal(t, 2, storedToken.RemainQuota)
	assert.Equal(t, 7, storedToken.UsedQuota)
}

func TestSettlementDeltasWriteThroughInBatchMode(t *testing.T) {
	resetQuotaReserveTestState(t)
	server := useQuotaReserveRedis(t)
	common.BatchUpdateEnabled = true

	user := createQuotaReserveUser(t, 100)
	token := createQuotaReserveToken(t, user.Id, 100)
	require.NoError(t, populateUserCache(user))
	_, err := GetTokenByKey(token.Key, true)
	require.NoError(t, err)

	require.NoError(t, DecreaseUserQuota(user.Id, 30, false))
	require.NoError(t, DecreaseTokenQuota(token.Id, token.Key, 30))
	require.NoError(t, IncreaseUserQuota(user.Id, 10, false))
	require.NoError(t, IncreaseTokenQuota(token.Id, token.Key, 10))
	batchUpdate()

	var storedUser User
	require.NoError(t, DB.First(&storedUser, user.Id).Error)
	assert.Equal(t, 80, storedUser.Quota)
	var storedToken Token
	require.NoError(t, DB.First(&storedToken, token.Id).Error)
	assert.Equal(t, 80, storedToken.RemainQuota)
	assert.Equal(t, 20, storedToken.UsedQuota)

	server.FastForward(time.Duration(userCacheFenceSeconds+1) * time.Second)
	userQuota, err := GetUserQuota(user.Id, false)
	require.NoError(t, err)
	assert.Equal(t, 80, userQuota)
	freshToken, err := GetTokenByKey(token.Key, false)
	require.NoError(t, err)
	assert.Equal(t, 80, freshToken.RemainQuota)
}

func TestReserveIgnoresStaleCacheAfterRedisOutage(t *testing.T) {
	resetQuotaReserveTestState(t)
	server := useQuotaReserveRedis(t)

	user := createQuotaReserveUser(t, 20)
	token := createQuotaReserveToken(t, user.Id, 15)
	require.NoError(t, populateUserCache(user))
	_, err := GetTokenByKey(token.Key, true)
	require.NoError(t, err)
	server.Close()

	userQuota, err := GetUserQuota(user.Id, false)
	require.NoError(t, err)
	assert.Equal(t, 20, userQuota)
	cachedToken, err := GetTokenByKey(token.Key, false)
	require.NoError(t, err)
	assert.Equal(t, 15, cachedToken.RemainQuota)

	reserved, err := TryReserveUserQuota(user.Id, 5)
	require.NoError(t, err)
	assert.True(t, reserved)
	reserved, err = TryReserveTokenQuota(token.Id, token.Key, 6, false)
	require.NoError(t, err)
	assert.True(t, reserved)

	var storedUser User
	require.NoError(t, DB.First(&storedUser, user.Id).Error)
	assert.Equal(t, 15, storedUser.Quota)
	var storedToken Token
	require.NoError(t, DB.First(&storedToken, token.Id).Error)
	assert.Equal(t, 9, storedToken.RemainQuota)
	assert.Equal(t, 6, storedToken.UsedQuota)

	// The invalidations above could not reach Redis. After recovery its old
	// higher balances remain, but they cannot authorize another database spend.
	require.NoError(t, server.Restart())
	staleUser, err := cacheGetUserBase(user.Id)
	require.NoError(t, err)
	assert.Equal(t, 20, staleUser.Quota)
	staleToken, err := cacheGetTokenByKey(token.Key)
	require.NoError(t, err)
	assert.Equal(t, 15, staleToken.RemainQuota)

	reserved, err = TryReserveUserQuota(user.Id, 16)
	require.NoError(t, err)
	assert.False(t, reserved)
	reserved, err = TryReserveTokenQuota(token.Id, token.Key, 10, false)
	require.NoError(t, err)
	assert.False(t, reserved)
}

func TestSubscriptionPreConsumeAtomicallyRejectsConcurrentOverspend(t *testing.T) {
	resetQuotaReserveTestState(t)
	require.NoError(t, DB.AutoMigrate(&SubscriptionPreConsumeRecord{}))
	require.NoError(t, DB.Exec("DELETE FROM subscription_pre_consume_records").Error)
	t.Cleanup(func() { _ = DB.Exec("DELETE FROM subscription_pre_consume_records").Error })

	user := createQuotaReserveUser(t, 0)
	now := GetDBTimestamp()
	plan := SubscriptionPlan{
		Title: "concurrent reserve", DurationUnit: SubscriptionDurationMonth,
		DurationValue: 1, TotalAmount: 100, QuotaResetPeriod: SubscriptionResetNever,
	}
	require.NoError(t, DB.Create(&plan).Error)
	subscription := UserSubscription{
		UserId: user.Id, PlanId: plan.Id, AmountTotal: 100, UsageGeneration: 1,
		StartTime: now, EndTime: now + 86400, Status: "active", AllowWalletOverflow: true,
	}
	require.NoError(t, DB.Create(&subscription).Error)

	const attempts = 6
	results := make(chan bool, attempts)
	errs := make(chan error, attempts)
	var wg sync.WaitGroup
	for range attempts {
		wg.Add(1)
		go func() {
			defer wg.Done()
			_, err := PreConsumeUserSubscription(
				"subscription-concurrent-"+common.GetRandomString(8), user.Id, "gpt-test", 0, 60,
			)
			results <- err == nil
			errs <- err
		}()
	}
	wg.Wait()
	close(results)
	close(errs)
	wins := 0
	for success := range results {
		if success {
			wins++
		}
	}
	failures := 0
	for err := range errs {
		if err != nil {
			assert.ErrorContains(t, err, "subscription quota insufficient")
			failures++
		}
	}
	assert.Equal(t, 1, wins)
	assert.Equal(t, attempts-1, failures)

	var stored UserSubscription
	require.NoError(t, DB.First(&stored, subscription.Id).Error)
	assert.EqualValues(t, 60, stored.AmountUsed)
}

func TestReserveRejectsMissingRowsAndUsesDatabaseTokenIdentity(t *testing.T) {
	resetQuotaReserveTestState(t)

	user := createQuotaReserveUser(t, 10)
	require.NoError(t, DB.Delete(&user).Error)
	reserved, err := TryReserveUserQuota(user.Id, 6)
	assert.False(t, reserved)
	require.NoError(t, err)

	token := createQuotaReserveToken(t, user.Id, 0)
	reserved, err = TryReserveTokenQuota(token.Id, token.Key, 7, true)
	require.NoError(t, err)
	assert.False(t, reserved, "a stale caller flag must not bypass the database quota")

	require.NoError(t, DB.Model(&token).Update("unlimited_quota", true).Error)
	reserved, err = TryReserveTokenQuota(token.Id, token.Key, 7, true)
	require.NoError(t, err)
	assert.True(t, reserved)
	var stored Token
	require.NoError(t, DB.First(&stored, token.Id).Error)
	assert.Equal(t, -7, stored.RemainQuota)
	assert.Equal(t, 7, stored.UsedQuota)

	reserved, err = TryReserveTokenQuota(token.Id, "wrong-key", 7, true)
	require.NoError(t, err)
	assert.False(t, reserved)

	require.NoError(t, DB.Delete(&token).Error)
	reserved, err = TryReserveTokenQuota(token.Id, token.Key, 7, false)
	assert.False(t, reserved)
	require.NoError(t, err)
}

func TestUserCacheFenceRejectsStaleSnapshot(t *testing.T) {
	resetQuotaReserveTestState(t)
	server := useQuotaReserveRedis(t)

	user := createQuotaReserveUser(t, 100)
	require.NoError(t, populateUserCache(user))
	stale := user

	require.NoError(t, DecreaseUserQuota(user.Id, 70, false))
	require.NoError(t, populateUserCache(stale))
	_, err := cacheGetUserBase(user.Id)
	assert.Error(t, err)

	server.FastForward(time.Duration(userCacheFenceSeconds+1) * time.Second)
	fresh, err := GetUserCache(user.Id)
	require.NoError(t, err)
	assert.Equal(t, 30, fresh.Quota)
}

func TestTokenCacheFenceRejectsStaleSnapshot(t *testing.T) {
	resetQuotaReserveTestState(t)
	server := useQuotaReserveRedis(t)

	user := createQuotaReserveUser(t, 10)
	token := createQuotaReserveToken(t, user.Id, 100)
	loaded, err := GetTokenByKey(token.Key, true)
	require.NoError(t, err)
	stale := *loaded

	require.NoError(t, DecreaseTokenQuota(token.Id, token.Key, 70))
	code, err := cacheInitToken(stale)
	require.NoError(t, err)
	assert.Zero(t, code)
	_, err = cacheGetTokenByKey(token.Key)
	assert.Error(t, err)

	server.FastForward(time.Duration(tokenCacheFenceSeconds+1) * time.Second)
	fresh, err := GetTokenByKey(token.Key, false)
	require.NoError(t, err)
	assert.Equal(t, 30, fresh.RemainQuota)
}
