package model

import (
	"context"
	"fmt"
	"strconv"
	"time"

	"github.com/dev-fan-sophon/boxai/common"
)

func getTokenCacheKey(key string) string {
	return fmt.Sprintf("token:%s", common.GenerateHMAC(key))
}

func getTokenCacheFenceKey(key string) string {
	return fmt.Sprintf("token:fence:%s", common.GenerateHMAC(key))
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
	const script = `
if redis.call('EXISTS', KEYS[2]) == 1 then
  return 0
end
if redis.call('EXISTS', KEYS[1]) == 1 then
	if tonumber(redis.call('HGET', KEYS[1], 'Id') or '0') ~= tonumber(ARGV[1]) then
		redis.call('DEL', KEYS[1])
	else
		redis.call('HSET', KEYS[1],
		  'UserId', ARGV[2], 'Status', ARGV[3], 'Name', ARGV[4],
		  'CreatedTime', ARGV[5], 'AccessedTime', ARGV[6], 'ExpiredTime', ARGV[7],
		  'UnlimitedQuota', ARGV[8], 'ModelLimitsEnabled', ARGV[9], 'ModelLimits', ARGV[10],
		  'AllowIps', ARGV[11], 'Group', ARGV[12], 'CrossGroupRetry', ARGV[13],
		  'RemainQuota', ARGV[14], 'UsedQuota', ARGV[15])
		redis.call('EXPIRE', KEYS[1], ARGV[16])
		return 2
	end
end
redis.call('HSET', KEYS[1],
  'Id', ARGV[1], 'UserId', ARGV[2], 'Status', ARGV[3], 'Name', ARGV[4],
  'CreatedTime', ARGV[5], 'AccessedTime', ARGV[6], 'ExpiredTime', ARGV[7],
  'UnlimitedQuota', ARGV[8], 'ModelLimitsEnabled', ARGV[9], 'ModelLimits', ARGV[10],
  'AllowIps', ARGV[11], 'Group', ARGV[12], 'CrossGroupRetry', ARGV[13],
  'RemainQuota', ARGV[14], 'UsedQuota', ARGV[15])
redis.call('EXPIRE', KEYS[1], ARGV[16])
return 1`
	return common.RDB.Eval(context.Background(), script, []string{
		getTokenCacheKey(token.Key), getTokenCacheFenceKey(token.Key),
	},
		token.Id, token.UserId, token.Status, token.Name,
		token.CreatedTime, token.AccessedTime, token.ExpiredTime,
		strconv.FormatBool(token.UnlimitedQuota), strconv.FormatBool(token.ModelLimitsEnabled),
		token.ModelLimits, allowIps, token.Group, strconv.FormatBool(token.CrossGroupRetry),
		token.RemainQuota, token.UsedQuota,
		tokenCacheTTLSeconds(),
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
	return &token, nil
}
