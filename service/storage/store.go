package storage

import (
	"context"
	"errors"
	"io"
	"path"
	"strings"
	"time"
)

// ErrPresignUnsupported is returned by backends that cannot issue presigned URLs
// (e.g. the local filesystem backend). Callers should fall back to streaming.
var ErrPresignUnsupported = errors.New("storage: presigned url not supported by backend")

// ErrInvalidKey is returned when a storage key is empty or attempts traversal.
var ErrInvalidKey = errors.New("storage: invalid object key")

// PublicPrefixes marks key prefixes that are eligible for public CDN delivery.
var PublicPrefixes = []string{"public/", "inspiration/"}

// AssetStore is a pluggable object store for playground media. Keys are always
// forward-slash relative paths (e.g. "uploads/42/uuid.png"); backends map them
// onto a local directory or an S3-compatible bucket.
type AssetStore interface {
	// Backend reports the backend identifier ("local" | "r2").
	Backend() string
	// Put stores content at key. size may be <= 0 when unknown.
	Put(ctx context.Context, key string, r io.Reader, size int64, contentType string) error
	// Open returns a reader for the object at key.
	Open(ctx context.Context, key string) (io.ReadCloser, error)
	// Delete removes the object at key. Missing objects are not an error.
	Delete(ctx context.Context, key string) error
	// PresignGet returns a short-lived GET URL, or ErrPresignUnsupported.
	PresignGet(ctx context.Context, key string, ttl time.Duration) (string, error)
	// PublicURL returns a public CDN URL when key is publicly delivered.
	PublicURL(key string) (string, bool)
}

// IsPublicKey reports whether key lives under a public delivery prefix.
func IsPublicKey(key string) bool {
	for _, p := range PublicPrefixes {
		if strings.HasPrefix(key, p) {
			return true
		}
	}
	return false
}

// cleanKey validates and normalizes a storage key, rejecting traversal and
// absolute paths. The returned key uses forward slashes.
func cleanKey(key string) (string, error) {
	if key == "" || strings.HasPrefix(key, "/") || strings.Contains(key, "..") {
		return "", ErrInvalidKey
	}
	clean := path.Clean(key)
	if clean == "" || clean == "." || clean != key {
		return "", ErrInvalidKey
	}
	return clean, nil
}
