package limiter

import (
	"context"
	"fmt"
	"sync"
	"testing"
	"time"

	"github.com/alicebob/miniredis/v2"
	"github.com/go-redis/redis/v8"
	"github.com/stretchr/testify/assert"
	"github.com/stretchr/testify/require"
)

func TestSuccessReservationConcurrencyAndWindow(t *testing.T) {
	for _, backend := range []string{"memory", "redis"} {
		t.Run(backend, func(t *testing.T) {
			now := time.Unix(1700000000, 0)
			memory := NewSuccessMemory()
			memory.now = func() time.Time { return now }
			server := miniredis.RunT(t)
			server.SetTime(now)
			client := redis.NewClient(&redis.Options{Addr: server.Addr()})
			t.Cleanup(func() { require.NoError(t, client.Close()) })
			reserve := func(id string) (func(bool), bool, error) {
				if backend == "memory" {
					complete, ok := memory.Reserve("user", 3, time.Minute)
					return complete, ok, nil
				}
				ok, err := SuccessRedis(context.Background(), client, "user", id, "reserve", 3, time.Minute, SuccessLease)
				return func(success bool) {
					op := "release"
					if success {
						op = "success"
					}
					_, err := SuccessRedis(context.Background(), client, "user", id, op, 3, time.Minute, SuccessLease)
					require.NoError(t, err)
				}, ok, err
			}
			type result struct {
				complete func(bool)
				allowed  bool
				err      error
			}
			start := make(chan struct{})
			results := make(chan result, 12)
			var wg sync.WaitGroup
			for i := 0; i < 12; i++ {
				wg.Add(1)
				go func(id int) {
					defer wg.Done()
					<-start
					complete, ok, err := reserve(fmt.Sprint(id))
					results <- result{complete, ok, err}
				}(i)
			}
			close(start)
			wg.Wait()
			close(results)
			var admitted []func(bool)
			for result := range results {
				require.NoError(t, result.err)
				if result.allowed {
					admitted = append(admitted, result.complete)
				}
			}
			require.Len(t, admitted, 3, "in-flight requests must reserve slots atomically")
			admitted[0](false)
			admitted[0](false) // completion must be idempotent
			replacement, ok, err := reserve("replacement")
			require.NoError(t, err)
			require.True(t, ok, "failed requests release a slot immediately")
			now = now.Add(30 * time.Second)
			server.SetTime(now)
			for _, complete := range admitted[1:] {
				complete(true)
			}
			replacement(true)
			now = now.Add(31 * time.Second)
			server.SetTime(now)
			_, ok, err = reserve("too-early")
			require.NoError(t, err)
			assert.False(t, ok, "window starts at completion, not admission")
			now = now.Add(29 * time.Second)
			server.SetTime(now)
			complete, ok, err := reserve("expired")
			require.NoError(t, err)
			require.True(t, ok, "exact window boundary expires completed successes")
			complete(false)
		})
	}
}

func TestSuccessRedisLeaseRecoveryAndRenewal(t *testing.T) {
	server := miniredis.RunT(t)
	now := time.Unix(1700000000, 0)
	server.SetTime(now)
	client := redis.NewClient(&redis.Options{Addr: server.Addr()})
	t.Cleanup(func() { require.NoError(t, client.Close()) })
	call := func(id, op string) bool {
		ok, err := SuccessRedis(context.Background(), client, "user", id, op, 1, time.Minute, SuccessLease)
		require.NoError(t, err)
		return ok
	}
	require.True(t, call("long-stream", "reserve"))
	now = now.Add(90 * time.Second)
	server.SetTime(now)
	require.True(t, call("long-stream", "renew"))
	now = now.Add(90 * time.Second)
	server.SetTime(now)
	assert.False(t, call("competitor", "reserve"), "renewal protects streams beyond original lease")
	now = now.Add(30 * time.Second)
	server.SetTime(now)
	require.True(t, call("after-crash", "reserve"))
	assert.False(t, call("long-stream", "success"), "stale completion cannot consume a new lease")
	assert.False(t, call("competitor", "reserve"))
	require.True(t, call("after-crash", "release"))
	assert.False(t, server.Exists("user"), "empty sets must not leak")
}

func TestSuccessMemoryUnlimitedAndLongRequest(t *testing.T) {
	m := NewSuccessMemory()
	now := time.Unix(1700000000, 0)
	m.now = func() time.Time { return now }
	done, ok := m.Reserve("user", 0, time.Minute)
	require.True(t, ok)
	done(true)
	done, ok = m.Reserve("user", 1, time.Minute)
	require.True(t, ok)
	now = now.Add(time.Hour)
	_, ok = m.Reserve("user", 1, time.Minute)
	assert.False(t, ok, "active memory reservation never expires")
	done(false)
	done, ok = m.Reserve("user", 1, time.Minute)
	require.True(t, ok)
	done(false)
}
