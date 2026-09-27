package boxai

import (
	"context"
	"errors"
	"io"
	"os"
	"path/filepath"

	"github.com/yetone/magpie/internal/edit"
)

// fileVault keeps the session, independent gateway credential and pending
// sign-out marker together. The file is intentionally plaintext and private
// to this OS user. It is never included in the UI or projection receipts.
type fileVault struct{ path string }

func (v fileVault) Get(ctx context.Context, key string) (string, error) {
	values, err := v.access(ctx, nil)
	if err != nil {
		return "", err
	}
	value, ok := values[key]
	if !ok {
		return "", errMissing
	}
	return value, nil
}

func (v fileVault) Set(ctx context.Context, key, value string) error {
	_, err := v.access(ctx, func(values map[string]string) { values[key] = value })
	return err
}

func (v fileVault) Delete(ctx context.Context, key string) error {
	_, err := v.access(ctx, func(values map[string]string) { delete(values, key) })
	return err
}

// Serialize read-modify-write across GUI and CLI processes, so a gateway-token
// save cannot accidentally erase a pending sign-out marker. Atomic replacement
// prevents partial JSON after a crash. Do not use edit.WriteAtomic here: auth
// must not participate in an unrelated Agent configuration transaction.
func (v fileVault) access(ctx context.Context, change func(map[string]string)) (map[string]string, error) {
	if err := ctx.Err(); err != nil {
		return nil, err
	}
	if !filepath.IsAbs(v.path) || edit.PlainPath(v.path) != nil || edit.PlainPath(v.path+".lock") != nil {
		return nil, ErrVaultUnavailable
	}
	if err := os.MkdirAll(filepath.Dir(v.path), 0700); err != nil {
		return nil, ErrVaultUnavailable
	}
	lock, err := os.OpenFile(v.path+".lock", os.O_CREATE|os.O_RDWR, 0600)
	if err != nil {
		return nil, ErrVaultUnavailable
	}
	defer lock.Close()
	if err = lockAuthFile(lock); err != nil {
		return nil, ErrVaultUnavailable
	}
	defer unlockAuthFile(lock)
	if err = ctx.Err(); err != nil {
		return nil, err
	}
	values := map[string]string{}
	f, err := os.Open(v.path)
	if err == nil {
		st, statErr := f.Stat()
		if statErr != nil || !st.Mode().IsRegular() {
			f.Close()
			return nil, ErrVaultUnavailable
		}
		if err = protectAuthFile(f); err != nil {
			f.Close()
			return nil, ErrVaultUnavailable
		}
		b, readErr := io.ReadAll(io.LimitReader(f, 64*1024+1))
		f.Close()
		if readErr != nil || len(b) > 64*1024 || unmarshal(b, &values) != nil || values == nil {
			return nil, ErrVaultUnavailable
		}
	} else if !errors.Is(err, os.ErrNotExist) {
		return nil, ErrVaultUnavailable
	}
	if change == nil {
		return values, nil
	}
	change(values)
	if len(values) == 0 {
		if err = os.Remove(v.path); err != nil && !errors.Is(err, os.ErrNotExist) {
			return nil, ErrVaultUnavailable
		}
		if err = syncAuthDirectory(filepath.Dir(v.path)); err != nil {
			return nil, ErrVaultUnavailable
		}
		return values, nil
	}
	b, err := marshal(values)
	if err != nil {
		return nil, ErrVaultUnavailable
	}
	tmp, err := os.CreateTemp(filepath.Dir(v.path), ".auth-*.tmp")
	if err != nil {
		return nil, ErrVaultUnavailable
	}
	defer os.Remove(tmp.Name())
	defer tmp.Close()
	if err = protectAuthFile(tmp); err != nil {
		return nil, ErrVaultUnavailable
	}
	if _, err = tmp.Write(b); err != nil {
		return nil, ErrVaultUnavailable
	}
	if err = tmp.Sync(); err != nil {
		return nil, ErrVaultUnavailable
	}
	if err = tmp.Close(); err != nil {
		return nil, ErrVaultUnavailable
	}
	if err = ctx.Err(); err != nil {
		return nil, err
	}
	if err = replaceAuthFile(tmp.Name(), v.path); err != nil {
		return nil, ErrVaultUnavailable
	}
	if err = syncAuthDirectory(filepath.Dir(v.path)); err != nil {
		return nil, ErrVaultUnavailable
	}
	return values, nil
}
