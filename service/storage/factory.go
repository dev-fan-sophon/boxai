package storage

import (
	"fmt"
	"path/filepath"
	"strings"
	"sync"

	"github.com/QuantumNous/new-api/common"
)

var (
	defaultMu    sync.Mutex
	defaultStore AssetStore
)

// LocalRoot returns the root directory used by the local filesystem backend.
func LocalRoot() string {
	root := common.GetEnvOrDefaultString("PLAYGROUND_ASSETS_DIR", "")
	if root == "" {
		root = filepath.Join("data", "playground-assets")
	}
	abs, err := filepath.Abs(root)
	if err != nil {
		return root
	}
	return abs
}

// Default returns the process-wide asset store selected by STORAGE_BACKEND.
// Unknown or misconfigured backends fall back to the local filesystem.
func Default() AssetStore {
	defaultMu.Lock()
	defer defaultMu.Unlock()
	if defaultStore == nil {
		defaultStore = build()
	}
	return defaultStore
}

// NewLocalStore builds a local filesystem store rooted at root. Used by the
// backfill tool to read legacy local objects regardless of STORAGE_BACKEND.
func NewLocalStore(root string) AssetStore {
	return newLocalStore(root)
}

// NewR2Store builds a Cloudflare R2 store from the R2_* environment variables.
// Used by the backfill tool as the migration target.
func NewR2Store() (AssetStore, error) {
	return newR2Store()
}

// ForBackend resolves the backend recorded with a persisted object. An empty
// backend is treated as a legacy row and uses the current process default.
func ForBackend(backend string) (AssetStore, error) {
	switch strings.ToLower(strings.TrimSpace(backend)) {
	case "":
		return Default(), nil
	case "local":
		return NewLocalStore(LocalRoot()), nil
	case "r2", "s3":
		return NewR2Store()
	default:
		return nil, fmt.Errorf("storage: unsupported backend %q", backend)
	}
}

// Reset clears the cached default store. Intended for tests that mutate
// storage-related environment variables.
func Reset() {
	defaultMu.Lock()
	defaultStore = nil
	defaultMu.Unlock()
}

func build() AssetStore {
	backend := common.GetEnvOrDefaultString("STORAGE_BACKEND", "local")
	switch backend {
	case "r2", "s3":
		s, err := newR2Store()
		if err != nil {
			common.SysError("storage: r2 backend init failed, falling back to local: " + err.Error())
			return newLocalStore(LocalRoot())
		}
		return s
	default:
		return newLocalStore(LocalRoot())
	}
}
