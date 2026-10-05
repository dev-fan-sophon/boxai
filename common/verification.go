package common

import (
	"context"
	"crypto/rand"
	"crypto/sha256"
	"crypto/subtle"
	"encoding/hex"
	"errors"
	"sync"
	"time"

	"github.com/go-redis/redis/v8"
)

type verificationValue struct {
	code     [sha256.Size]byte
	time     time.Time
	attempts int
}

const (
	EmailVerificationPurpose = "v"
	PasswordResetPurpose     = "r"
	verificationMaxAttempts  = 5
	verificationRedisPrefix  = "verification:v1:"
)

var verificationMutex sync.Mutex
var verificationMap map[string]verificationValue
var verificationMapMaxSize = 10
var VerificationValidMinutes = 10

var registerVerificationScript = redis.NewScript(`
redis.call('HSET', KEYS[1], 'code', ARGV[1], 'attempts', 0)
redis.call('PEXPIRE', KEYS[1], ARGV[2])
return 1
`)

var verifyVerificationScript = redis.NewScript(`
local expected = redis.call('HGET', KEYS[1], 'code')
if not expected then
  return 0
end
local supplied = ARGV[1]
local mismatch = string.len(expected) - string.len(supplied)
mismatch = mismatch * mismatch
for index = 1, string.len(expected) do
	local difference = string.byte(expected, index) - (string.byte(supplied, index) or 0)
	mismatch = mismatch + difference * difference
end
if mismatch == 0 then
  redis.call('DEL', KEYS[1])
  return 1
end
local attempts = redis.call('HINCRBY', KEYS[1], 'attempts', 1)
if attempts >= tonumber(ARGV[2]) then
  redis.call('DEL', KEYS[1])
end
return 0
`)

func GenerateVerificationCode(length int) string {
	// Keep the historical 32-character result for length zero while using a
	// cryptographically secure source instead of a UUID string.
	bytes := make([]byte, 16)
	if _, err := rand.Read(bytes); err != nil {
		panic("secure random source unavailable")
	}
	code := hex.EncodeToString(bytes)
	if length == 0 {
		return code
	}
	return code[:length]
}

func verificationDigest(value string) [sha256.Size]byte {
	return sha256.Sum256([]byte(value))
}

func verificationRedisKey(key, purpose string) string {
	digest := sha256.Sum256([]byte(purpose + "\x00" + key))
	return verificationRedisPrefix + hex.EncodeToString(digest[:])
}

func verificationMemoryKey(key, purpose string) string {
	return purpose + "\x00" + key
}

func RegisterVerificationCodeWithKey(key string, code string, purpose string) error {
	digest := verificationDigest(code)
	if RedisEnabled {
		if RDB == nil {
			SysError("failed to register verification code: Redis unavailable")
			return errors.New("Verification is temporarily unavailable. Please try again later.")
		}
		ttl := time.Duration(VerificationValidMinutes) * time.Minute
		if _, err := registerVerificationScript.Run(context.Background(), RDB,
			[]string{verificationRedisKey(key, purpose)}, hex.EncodeToString(digest[:]), ttl.Milliseconds()).Result(); err != nil {
			SysError("failed to register verification code in Redis")
			return errors.New("Verification is temporarily unavailable. Please try again later.")
		}
		return nil
	}

	verificationMutex.Lock()
	defer verificationMutex.Unlock()
	verificationMap[verificationMemoryKey(key, purpose)] = verificationValue{code: digest, time: time.Now()}
	if len(verificationMap) > verificationMapMaxSize {
		removeExpiredPairs()
	}
	return nil
}

func VerifyCodeWithKey(key string, code string, purpose string) bool {
	digest := verificationDigest(code)
	if RedisEnabled {
		if RDB == nil {
			SysError("failed to verify verification code: Redis unavailable")
			return false
		}
		result, err := verifyVerificationScript.Run(context.Background(), RDB,
			[]string{verificationRedisKey(key, purpose)}, hex.EncodeToString(digest[:]), verificationMaxAttempts).Int()
		if err != nil {
			SysError("failed to verify verification code in Redis")
			return false
		}
		return result == 1
	}

	verificationMutex.Lock()
	defer verificationMutex.Unlock()
	mapKey := verificationMemoryKey(key, purpose)
	value, okay := verificationMap[mapKey]
	if !okay {
		return false
	}
	if time.Since(value.time) >= time.Duration(VerificationValidMinutes)*time.Minute {
		delete(verificationMap, mapKey)
		return false
	}
	if subtle.ConstantTimeCompare(digest[:], value.code[:]) == 1 {
		delete(verificationMap, mapKey)
		return true
	}
	value.attempts++
	if value.attempts >= verificationMaxAttempts {
		delete(verificationMap, mapKey)
	} else {
		verificationMap[mapKey] = value
	}
	return false
}

func DeleteKey(key string, purpose string) {
	if RedisEnabled {
		if RDB == nil {
			SysError("failed to delete verification code: Redis unavailable")
			return
		}
		if err := RDB.Del(context.Background(), verificationRedisKey(key, purpose)).Err(); err != nil {
			SysError("failed to delete verification code from Redis")
		}
		return
	}
	verificationMutex.Lock()
	defer verificationMutex.Unlock()
	delete(verificationMap, verificationMemoryKey(key, purpose))
}

// no lock inside, so the caller must lock the verificationMap before calling!
func removeExpiredPairs() {
	now := time.Now()
	for key := range verificationMap {
		if now.Sub(verificationMap[key].time) >= time.Duration(VerificationValidMinutes)*time.Minute {
			delete(verificationMap, key)
		}
	}
}

func init() {
	verificationMap = make(map[string]verificationValue)
}
