package boxai

import (
	"context"
	"errors"
	"strings"
)

const vaultService = "com.you-box.connect"

type nativeVault struct{}

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
func (nativeVault) Get(ctx context.Context, key string) (string, error) {
	return readNative(ctx, "boxai-magpie-"+key)
}
func (nativeVault) Set(ctx context.Context, key, value string) error {
	return writeNative(ctx, "boxai-magpie-"+key, value)
}
func (nativeVault) Delete(ctx context.Context, key string) error {
	return deleteNative(ctx, "boxai-magpie-"+key)
}
