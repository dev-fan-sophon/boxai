package boxai

import (
	"context"
	"errors"
	"strings"
)

const vaultService = "com.you-box.connect"

var errLegacyVaultUnavailable = errors.New("original native credential unavailable for legacy configuration restoration")

// ReadLegacyCredential reads the old Rust connector keyring identity without
// changing it. The migration owner must wipe the returned bytes after use.
func ReadLegacyCredential(ctx context.Context, credential string) ([]byte, error) {
	if credential == "" || len(credential) > 1024 || strings.ContainsRune(credential, 0) {
		return nil, errors.New("invalid legacy credential identity")
	}
	t, err := readNative(ctx, credential)
	if err != nil {
		return nil, err
	}
	return []byte(t), nil
}
