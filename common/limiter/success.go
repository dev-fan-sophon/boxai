package limiter

import (
	"context"
	"sync"
	"time"

	"github.com/go-redis/redis/v8"
)

// RelayOutcomeKey carries the final protocol outcome, not just the HTTP status.
// The controller publishes it after stream workers have stopped and retries end.
const RelayOutcomeKey = "model_rate_limit_relay_success"

const SuccessLease = 2 * time.Minute

type successWindow struct {
	pending int
	expires []time.Time
}

// SuccessMemory reserves in-flight slots and starts the sliding window only at
// successful completion. Active requests cannot expire while still running.
type SuccessMemory struct {
	mu        sync.Mutex
	windows   map[string]*successWindow
	now       func() time.Time
	nextSweep time.Time
}

func NewSuccessMemory() *SuccessMemory {
	return &SuccessMemory{windows: make(map[string]*successWindow), now: time.Now}
}

func (m *SuccessMemory) Reserve(key string, limit int, window time.Duration) (func(bool), bool) {
	if limit <= 0 {
		return func(bool) {}, true
	}
	m.mu.Lock()
	now := m.now()
	if !now.Before(m.nextSweep) {
		for key, entry := range m.windows {
			live := entry.expires[:0]
			for _, expiry := range entry.expires {
				if expiry.After(now) {
					live = append(live, expiry)
				}
			}
			entry.expires = live
			if entry.pending == 0 && len(entry.expires) == 0 {
				delete(m.windows, key)
			}
		}
		m.nextSweep = now.Add(time.Minute)
	}
	w := m.windows[key]
	if w == nil {
		w = &successWindow{}
		m.windows[key] = w
	}
	// Windows may change between requests, so expiry order is not guaranteed.
	live := w.expires[:0]
	for _, expiry := range w.expires {
		if expiry.After(now) {
			live = append(live, expiry)
		}
	}
	w.expires = live
	if w.pending+len(w.expires) >= limit {
		m.mu.Unlock()
		return nil, false
	}
	w.pending++
	m.mu.Unlock()
	var once sync.Once
	return func(success bool) {
		once.Do(func() {
			m.mu.Lock()
			defer m.mu.Unlock()
			w.pending--
			if success {
				w.expires = append(w.expires, m.now().Add(window))
			}
			if w.pending == 0 && len(w.expires) == 0 {
				delete(m.windows, key)
			}
		})
	}, true
}

// One sorted set holds both leases and completed successes, scored by expiry.
// Redis TIME avoids cross-host clock skew. A versioned key avoids legacy LISTs.
var successScript = redis.NewScript(`
local t = redis.call('TIME')
local now = t[1] * 1000 + math.floor(t[2] / 1000)
redis.call('ZREMRANGEBYSCORE', KEYS[1], '-inf', now)
local op, id = ARGV[1], ARGV[2]
local window, lease = tonumber(ARGV[3]), tonumber(ARGV[4])
local member = 'p:' .. id
local result = 0
if op == 'reserve' then
  if redis.call('ZCARD', KEYS[1]) < tonumber(ARGV[5]) then
    redis.call('ZADD', KEYS[1], now + lease, member)
    result = 1
  end
elseif op == 'renew' then
  if redis.call('ZSCORE', KEYS[1], member) then
    redis.call('ZADD', KEYS[1], now + lease, member)
    result = 1
  end
else
  result = redis.call('ZREM', KEYS[1], member)
  if result == 1 and op == 'success' then
    redis.call('ZADD', KEYS[1], now + window, 's:' .. id)
  end
end
local last = redis.call('ZREVRANGE', KEYS[1], 0, 0, 'WITHSCORES')
if #last > 0 then redis.call('PEXPIRE', KEYS[1], math.max(1, tonumber(last[2]) - now)) end
return result
`)

// SuccessRedis atomically reserves, renews or completes a unique request lease.
// Completion of an expired lease cannot consume another request's reservation.
func SuccessRedis(ctx context.Context, client *redis.Client, key, id, operation string, limit int, window, lease time.Duration) (bool, error) {
	result, err := successScript.Run(ctx, client, []string{key}, operation, id, window.Milliseconds(), lease.Milliseconds(), limit).Int()
	return result == 1, err
}
