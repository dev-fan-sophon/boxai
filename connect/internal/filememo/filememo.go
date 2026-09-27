// Package filememo keeps what was parsed from a file until the file
// changes, so a page that asks many times over reads it once.
package filememo

import (
	"crypto/sha256"
	"os"
	"sync"
)

type entry struct {
	digest [32]byte
	v      any
}

var (
	mu   sync.Mutex
	seen = map[string]entry{}
)

// Read reuses a parsed file only when its contents are unchanged. Timestamps
// can collide on rapid same-size credential/config updates. kind tells apart two parses of
// one file. What it returns is shared: the caller must not change it.
func Read[T any](kind, path string, parse func([]byte) (T, error)) (T, error) {
	var zero T
	b, err := os.ReadFile(path)
	if err != nil {
		return zero, err
	}
	digest := sha256.Sum256(b)
	key := kind + "\x00" + path
	mu.Lock()
	e, ok := seen[key]
	mu.Unlock()
	if ok && e.digest == digest {
		return e.v.(T), nil
	}
	v, err := parse(b)
	if err != nil {
		return zero, err
	}
	mu.Lock()
	seen[key] = entry{digest: digest, v: v}
	mu.Unlock()
	return v, nil
}
