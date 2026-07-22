package storage

import (
	"path/filepath"
	"sync"

	"github.com/QuantumNous/new-api/common"
)

var (
	defaultOnce  sync.Once
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
	defaultOnce.Do(func() {
		defaultStore = build()
	})
	return defaultStore
}

func build() AssetStore {
	// R2/S3 backends are wired in a subsequent step; default to local.
	return newLocalStore(LocalRoot())
}
