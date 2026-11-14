package model

import (
	"errors"
	"testing"
	"time"

	"github.com/dev-fan-sophon/boxai/common"
	"github.com/stretchr/testify/assert"
	"github.com/stretchr/testify/require"
	"gorm.io/gorm"
)

func TestUserCacheRejectsTamperedRedisFields(t *testing.T) {
	resetQuotaReserveTestState(t)
	useQuotaReserveRedis(t)
	user := createQuotaReserveUser(t, 100)
	require.NoError(t, populateUserCache(user))
	_, err := cacheGetUserBase(user.Id)
	require.NoError(t, err)

	for _, fields := range []map[string]any{
		{"Status": common.UserStatusEnabled + 100},
		{"Group": "privileged"},
		{"Setting": `{"language":"evil"}`},
		{"Quota": 1 << 30},
		{"Email": "attacker@example.com", "Username": "attacker"},
	} {
		require.NoError(t, common.RDB.HSet(t.Context(), getUserCacheKey(user.Id), fields).Err())
		_, err := cacheGetUserBase(user.Id)
		require.Error(t, err, fields)

		loaded, err := GetUserCache(user.Id)
		require.NoError(t, err)
		assert.Equal(t, user.Group, loaded.Group)
		assert.Equal(t, user.Status, loaded.Status)
		assert.Equal(t, user.Quota, loaded.Quota)
		assert.Equal(t, user.Username, loaded.Username)

		repaired, err := cacheGetUserBase(user.Id)
		require.NoError(t, err, "a database read must repair the tampered hash")
		assert.Equal(t, user.Group, repaired.Group)
		assert.Equal(t, user.Quota, repaired.Quota)
	}
}

func TestUserCacheFieldUpdateKeepsHashVerifiable(t *testing.T) {
	resetQuotaReserveTestState(t)
	useQuotaReserveRedis(t)
	user := createQuotaReserveUser(t, 100)
	require.NoError(t, populateUserCache(user))

	require.NoError(t, updateUserGroupCache(user.Id, "vip"))
	require.NoError(t, updateUserStatusCache(user.Id, false))
	cached, err := cacheGetUserBase(user.Id)
	require.NoError(t, err)
	assert.Equal(t, "vip", cached.Group)
	assert.Equal(t, common.UserStatusDisabled, cached.Status)

	// A field update must not re-sign a hash someone else tampered with.
	require.NoError(t, common.RDB.HSet(t.Context(), getUserCacheKey(user.Id), "Quota", 1<<30).Err())
	require.NoError(t, updateUserGroupCache(user.Id, "default"))
	_, err = cacheGetUserBase(user.Id)
	assert.Error(t, err)
}

func TestTokenCacheRejectsTamperedRedisFields(t *testing.T) {
	resetQuotaReserveTestState(t)
	useQuotaReserveRedis(t)
	user := createQuotaReserveUser(t, 100)
	allowIPs := "192.168.0.0/16"
	token := Token{UserId: user.Id, Key: "cache-integrity-token", Name: "integrity", Status: common.TokenStatusEnabled,
		ExpiredTime: -1, RemainQuota: 100, ModelLimitsEnabled: true, ModelLimits: "allowed-model",
		AllowIps: &allowIPs, Group: "auto", AutoGroups: `["default"]`}
	require.NoError(t, DB.Create(&token).Error)
	_, err := GetTokenByKey(token.Key, false)
	require.NoError(t, err)
	_, err = cacheGetTokenByKey(token.Key)
	require.NoError(t, err)

	for _, fields := range []map[string]any{
		{"UserId": user.Id + 1},
		{"UnlimitedQuota": "true"},
		{"ModelLimitsEnabled": "false", "ModelLimits": "", "AllowIps": ""},
		{"Group": "privileged", "AutoGroups": `["privileged"]`, "CrossGroupRetry": "true"},
		{"Status": common.TokenStatusDisabled, "ExpiredTime": 1},
		{"RemainQuota": 1 << 30},
		{"UnlimitedQuota": "garbage"},
		{"DeletedAt": time.Now().Format(time.RFC3339)},
	} {
		require.NoError(t, common.RDB.HSet(t.Context(), getTokenCacheKey(token.Key), fields).Err())
		_, err := cacheGetTokenByKey(token.Key)
		require.Error(t, err, fields)

		_, err = GetTokenByKey(token.Key, false)
		require.NoError(t, err)
		cached, err := cacheGetTokenByKey(token.Key)
		require.NoError(t, err, "a database read must repair the tampered hash")
		assert.Equal(t, token.UserId, cached.UserId)
		assert.False(t, cached.UnlimitedQuota)
		assert.True(t, cached.ModelLimitsEnabled)
		assert.Equal(t, token.ModelLimits, cached.ModelLimits)
		assert.Equal(t, token.AllowIps, cached.AllowIps)
		assert.Equal(t, token.Group, cached.Group)
		assert.Equal(t, token.AutoGroups, cached.AutoGroups)
		assert.False(t, cached.CrossGroupRetry)
		assert.Equal(t, token.Status, cached.Status)
		assert.Equal(t, token.ExpiredTime, cached.ExpiredTime)
		assert.Equal(t, token.RemainQuota, cached.RemainQuota)
		assert.False(t, cached.DeletedAt.Valid)
	}
}

func TestAuthCacheRejectsUnsignedExpiredAndCopiedHashes(t *testing.T) {
	resetQuotaReserveTestState(t)
	useQuotaReserveRedis(t)
	user := createQuotaReserveUser(t, 100)
	token := createQuotaReserveToken(t, user.Id, 100)
	require.NoError(t, populateUserCache(user))
	_, err := cacheInitToken(token)
	require.NoError(t, err)
	userKey, tokenKey := getUserCacheKey(user.Id), getTokenCacheKey(token.Key)

	t.Run("unsigned hashes from older nodes are repaired", func(t *testing.T) {
		for _, key := range []string{userKey, tokenKey} {
			require.NoError(t, common.RDB.HDel(t.Context(), key, "CacheMAC", "CacheExpiresAt").Err())
		}
		_, err := cacheGetUserBase(user.Id)
		require.Error(t, err)
		_, err = cacheGetTokenByKey(token.Key)
		require.Error(t, err)

		_, err = GetUserCache(user.Id)
		require.NoError(t, err)
		_, err = GetTokenByKey(token.Key, false)
		require.NoError(t, err)
		_, err = cacheGetUserBase(user.Id)
		require.NoError(t, err)
		_, err = cacheGetTokenByKey(token.Key)
		require.NoError(t, err)
	})

	t.Run("signed hashes past their expiry are rejected", func(t *testing.T) {
		cachedUser, err := cacheGetUserBase(user.Id)
		require.NoError(t, err)
		cachedToken, err := cacheGetTokenByKey(token.Key)
		require.NoError(t, err)
		expired := time.Now().Add(-time.Second).UnixMilli()
		cachedUser.CacheExpiresAt = expired
		cachedToken.CacheExpiresAt = expired
		userMAC, err := cachedUser.cacheMAC()
		require.NoError(t, err)
		tokenMAC, err := cachedToken.cacheMAC()
		require.NoError(t, err)
		for key, mac := range map[string]string{userKey: userMAC, tokenKey: tokenMAC} {
			require.NoError(t, common.RDB.HSet(t.Context(), key, "CacheExpiresAt", expired, "CacheMAC", mac).Err())
			require.NoError(t, common.RDB.Persist(t.Context(), key).Err())
		}
		_, err = cacheGetUserBase(user.Id)
		assert.Error(t, err)
		_, err = cacheGetTokenByKey(token.Key)
		assert.Error(t, err)
	})

	t.Run("signed hashes cannot be copied to another identity", func(t *testing.T) {
		_, err := GetUserCache(user.Id)
		require.NoError(t, err)
		_, err = GetTokenByKey(token.Key, false)
		require.NoError(t, err)
		for source, destination := range map[string]string{
			userKey:  getUserCacheKey(user.Id + 1000),
			tokenKey: getTokenCacheKey("unknown-token"),
		} {
			fields, err := common.RDB.HGetAll(t.Context(), source).Result()
			require.NoError(t, err)
			require.NoError(t, common.RDB.HSet(t.Context(), destination, fields).Err())
		}
		require.NoError(t, common.RDB.HSet(t.Context(), getUserCacheKey(user.Id+1000), "Id", user.Id+1000).Err())
		_, err = GetUserCache(user.Id + 1000)
		assert.ErrorIs(t, err, gorm.ErrRecordNotFound)
		_, err = GetTokenByKey("unknown-token", false)
		assert.ErrorIs(t, err, gorm.ErrRecordNotFound)
	})

	t.Run("valid hashes are served without the database", func(t *testing.T) {
		const callbackName = "test:auth-cache-db-failure"
		require.NoError(t, DB.Callback().Query().Before("gorm:query").Register(callbackName, func(tx *gorm.DB) {
			tx.AddError(errors.New("database unavailable"))
		}))
		t.Cleanup(func() { assert.NoError(t, DB.Callback().Query().Remove(callbackName)) })

		_, err := GetUserCache(user.Id)
		require.NoError(t, err)
		_, err = GetTokenByKey(token.Key, false)
		require.NoError(t, err)

		require.NoError(t, common.RDB.HSet(t.Context(), tokenKey, "CacheMAC", "invalid").Err())
		_, err = GetTokenByKey(token.Key, false)
		assert.Error(t, err, "an unverifiable hash must not be trusted when the database is unavailable")
	})
}
