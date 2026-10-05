package common

import (
	"sync"
	"testing"
	"time"

	"github.com/alicebob/miniredis/v2"
	"github.com/go-redis/redis/v8"
	"github.com/stretchr/testify/assert"
	"github.com/stretchr/testify/require"
)

func testVerificationBackends(t *testing.T, test func(t *testing.T, server *miniredis.Miniredis)) {
	t.Helper()
	for _, backend := range []string{"memory", "redis"} {
		t.Run(backend, func(t *testing.T) {
			oldEnabled, oldRDB := RedisEnabled, RDB
			oldMinutes := VerificationValidMinutes
			verificationMutex.Lock()
			verificationMap = make(map[string]verificationValue)
			verificationMutex.Unlock()
			var server *miniredis.Miniredis
			RedisEnabled = backend == "redis"
			if RedisEnabled {
				server = miniredis.RunT(t)
				RDB = redis.NewClient(&redis.Options{Addr: server.Addr()})
			}
			t.Cleanup(func() {
				if RedisEnabled && RDB != nil {
					_ = RDB.Close()
				}
				RedisEnabled, RDB = oldEnabled, oldRDB
				VerificationValidMinutes = oldMinutes
			})
			test(t, server)
		})
	}
}

func TestVerificationCodeOneTimePurposeAndFailureBudget(t *testing.T) {
	testVerificationBackends(t, func(t *testing.T, _ *miniredis.Miniredis) {
		RegisterVerificationCodeWithKey("person@example.com", "correct", EmailVerificationPurpose)
		assert.False(t, VerifyCodeWithKey("person@example.com", "wrong", PasswordResetPurpose))
		assert.True(t, VerifyCodeWithKey("person@example.com", "correct", EmailVerificationPurpose))
		assert.False(t, VerifyCodeWithKey("person@example.com", "correct", EmailVerificationPurpose))

		RegisterVerificationCodeWithKey("boundary@example.com", "correct", EmailVerificationPurpose)
		for attempt := 1; attempt < verificationMaxAttempts; attempt++ {
			assert.False(t, VerifyCodeWithKey("boundary@example.com", "wrong", EmailVerificationPurpose))
		}
		assert.True(t, VerifyCodeWithKey("boundary@example.com", "correct", EmailVerificationPurpose))

		RegisterVerificationCodeWithKey("exhausted@example.com", "correct", EmailVerificationPurpose)
		for attempt := 0; attempt < verificationMaxAttempts; attempt++ {
			assert.False(t, VerifyCodeWithKey("exhausted@example.com", "wrong", EmailVerificationPurpose))
		}
		assert.False(t, VerifyCodeWithKey("exhausted@example.com", "correct", EmailVerificationPurpose))
	})
}

func TestVerificationCodeTTL(t *testing.T) {
	testVerificationBackends(t, func(t *testing.T, server *miniredis.Miniredis) {
		RegisterVerificationCodeWithKey("ttl@example.com", "correct", EmailVerificationPurpose)
		if server != nil {
			server.FastForward(10 * time.Minute)
		} else {
			verificationMutex.Lock()
			mapKey := verificationMemoryKey("ttl@example.com", EmailVerificationPurpose)
			value := verificationMap[mapKey]
			value.time = value.time.Add(-10 * time.Minute)
			verificationMap[mapKey] = value
			verificationMutex.Unlock()
		}
		assert.False(t, VerifyCodeWithKey("ttl@example.com", "correct", EmailVerificationPurpose))
	})
}

func TestVerificationCodeConcurrentSuccessOnlyOnce(t *testing.T) {
	testVerificationBackends(t, func(t *testing.T, _ *miniredis.Miniredis) {
		RegisterVerificationCodeWithKey("race@example.com", "correct", EmailVerificationPurpose)
		const workers = 20
		var wg sync.WaitGroup
		results := make(chan bool, workers)
		for i := 0; i < workers; i++ {
			wg.Add(1)
			go func() {
				defer wg.Done()
				results <- VerifyCodeWithKey("race@example.com", "correct", EmailVerificationPurpose)
			}()
		}
		wg.Wait()
		close(results)
		successes := 0
		for result := range results {
			if result {
				successes++
			}
		}
		assert.Equal(t, 1, successes)
	})
}

func TestVerificationRedisUnavailableFailsClosed(t *testing.T) {
	oldEnabled, oldRDB := RedisEnabled, RDB
	RedisEnabled = true
	server := miniredis.RunT(t)
	client := redis.NewClient(&redis.Options{Addr: server.Addr()})
	RDB = client
	RegisterVerificationCodeWithKey("person@example.com", "correct", EmailVerificationPurpose)
	server.Close()
	t.Cleanup(func() {
		_ = client.Close()
		RedisEnabled, RDB = oldEnabled, oldRDB
	})

	require.False(t, VerifyCodeWithKey("person@example.com", "correct", EmailVerificationPurpose))

	RDB = nil
	RegisterVerificationCodeWithKey("other@example.com", "correct", EmailVerificationPurpose)
	assert.False(t, VerifyCodeWithKey("other@example.com", "correct", EmailVerificationPurpose))
}
