package model

import (
	"context"
	"fmt"
	"strconv"
	"time"

	"github.com/dev-fan-sophon/boxai/common"
	"gorm.io/gorm"
)

// cacheMAC signs every cached field. The raw key is replaced by the cache key
// binding so a signed hash cannot be copied to another token's key.
func (token Token) cacheMAC() (string, error) {
	cacheKey := getTokenCacheKey(token.Key)
	token.Key = ""
	token.CacheMAC = ""
	if token.AllowIps != nil && *token.AllowIps == "" {
		token.AllowIps = nil
	}
	return authCacheMAC(cacheKey, struct {
		Token          Token
		AutoGroups     string
		CacheExpiresAt int64
	}{token, token.AutoGroups, token.CacheExpiresAt})
}

func getTokenCacheKey(key string) string {
	return fmt.Sprintf("token:%s", common.GenerateHMAC(key))
}

// The fence uses the cache key as its hash tag so cacheInitToken's script
// reads both keys from one slot on sharded Redis.
func getTokenCacheFenceKey(key string) string {
	return fmt.Sprintf("token:fence:{%s}", getTokenCacheKey(key))
}

func tokenCacheTTLSeconds() int {
	ttl := common.RedisKeyCacheSeconds()
	if ttl <= 0 {
		return 60
	}
	return ttl
}

const tokenCacheFenceSeconds = 10

func invalidateTokenCacheForMutation(key string) error {
	if !common.RedisEnabled || common.RDB == nil || key == "" {
		return nil
	}
	ctx := context.Background()
	if err := common.RDB.Set(ctx, getTokenCacheFenceKey(key), 1, time.Duration(tokenCacheFenceSeconds)*time.Second).Err(); err != nil {
		return err
	}
	return common.RDB.Del(ctx, getTokenCacheKey(key)).Err()
}

// cacheInitToken publishes a database snapshot when no mutation fence is
// active. The database is authoritative for quota as well as metadata.
func cacheInitToken(token Token) (int, error) {
	if !common.RedisEnabled || common.RDB == nil {
		return 0, nil
	}
	allowIps := ""
	if token.AllowIps != nil {
		allowIps = *token.AllowIps
	}
	token.DeletedAt = gorm.DeletedAt{}
	token.CacheExpiresAt = time.Now().Add(time.Duration(tokenCacheTTLSeconds()) * time.Second).UnixMilli()
	mac, err := token.cacheMAC()
	if err != nil {
		return 0, err
	}
	const script = `
if redis.call('EXISTS', KEYS[2]) == 1 then
  return 0
end
if redis.call('EXISTS', KEYS[1]) == 1 then
	if tonumber(redis.call('HGET', KEYS[1], 'Id') or '0') ~= tonumber(ARGV[1]) then
		redis.call('DEL', KEYS[1])
	else
		redis.call('HDEL', KEYS[1], 'DeletedAt')
		redis.call('HSET', KEYS[1],
		  'UserId', ARGV[2], 'Status', ARGV[3], 'Name', ARGV[4],
		  'CreatedTime', ARGV[5], 'AccessedTime', ARGV[6], 'ExpiredTime', ARGV[7],
		  'UnlimitedQuota', ARGV[8], 'ModelLimitsEnabled', ARGV[9], 'ModelLimits', ARGV[10],
		  'AllowIps', ARGV[11], 'Group', ARGV[12], 'CrossGroupRetry', ARGV[13],
		  'AutoGroups', ARGV[14], 'RemainQuota', ARGV[15], 'UsedQuota', ARGV[16],
		  'CacheExpiresAt', ARGV[18], 'CacheMAC', ARGV[19])
		redis.call('EXPIRE', KEYS[1], ARGV[17])
		return 2
	end
end
redis.call('HSET', KEYS[1],
  'Id', ARGV[1], 'UserId', ARGV[2], 'Status', ARGV[3], 'Name', ARGV[4],
  'CreatedTime', ARGV[5], 'AccessedTime', ARGV[6], 'ExpiredTime', ARGV[7],
  'UnlimitedQuota', ARGV[8], 'ModelLimitsEnabled', ARGV[9], 'ModelLimits', ARGV[10],
  'AllowIps', ARGV[11], 'Group', ARGV[12], 'CrossGroupRetry', ARGV[13],
  'AutoGroups', ARGV[14], 'RemainQuota', ARGV[15], 'UsedQuota', ARGV[16],
  'CacheExpiresAt', ARGV[18], 'CacheMAC', ARGV[19])
redis.call('EXPIRE', KEYS[1], ARGV[17])
return 1`
	return common.RDB.Eval(context.Background(), script, []string{
		getTokenCacheKey(token.Key), getTokenCacheFenceKey(token.Key),
	},
		token.Id, token.UserId, token.Status, token.Name,
		token.CreatedTime, token.AccessedTime, token.ExpiredTime,
		strconv.FormatBool(token.UnlimitedQuota), strconv.FormatBool(token.ModelLimitsEnabled),
		token.ModelLimits, allowIps, token.Group, strconv.FormatBool(token.CrossGroupRetry),
		token.AutoGroups, token.RemainQuota, token.UsedQuota,
		tokenCacheTTLSeconds(), token.CacheExpiresAt, mac,
	).Int()
}

func cacheGetTokenByKey(key string) (*Token, error) {
	if !common.RedisEnabled || common.RDB == nil {
		return nil, fmt.Errorf("redis is not enabled")
	}
	var token Token
	if err := common.RedisHGetObj(getTokenCacheKey(key), &token); err != nil {
		return nil, err
	}
	if token.Id <= 0 {
		return nil, fmt.Errorf("token cache is incomplete")
	}
	token.Key = key
	mac, err := token.cacheMAC()
	if err != nil || !validAuthCacheMAC(mac, token.CacheMAC, token.CacheExpiresAt) {
		return nil, fmt.Errorf("token cache integrity check failed")
	}
	return &token, nil
}
