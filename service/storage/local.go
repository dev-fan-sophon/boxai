package storage

import (
	"context"
	"io"
	"os"
	"path/filepath"
	"strings"
	"time"
)

// localStore persists objects under a root directory on the local filesystem.
type localStore struct {
	root string
}

func newLocalStore(root string) *localStore {
	abs, err := filepath.Abs(root)
	if err == nil {
		root = abs
	}
	return &localStore{root: root}
}

func (s *localStore) Backend() string { return "local" }

// resolve maps a validated key to an absolute path constrained to the root.
func (s *localStore) resolve(key string) (string, error) {
	clean, err := cleanKey(key)
	if err != nil {
		return "", err
	}
	full := filepath.Join(s.root, filepath.FromSlash(clean))
	rel, err := filepath.Rel(s.root, full)
	if err != nil || rel == ".." || strings.HasPrefix(rel, ".."+string(os.PathSeparator)) {
		return "", ErrInvalidKey
	}
	return full, nil
}

func (s *localStore) Put(_ context.Context, key string, r io.Reader, _ int64, _ string) error {
	full, err := s.resolve(key)
	if err != nil {
		return err
	}
	if err := os.MkdirAll(filepath.Dir(full), 0o750); err != nil {
		return err
	}
	f, err := os.OpenFile(full, os.O_CREATE|os.O_WRONLY|os.O_TRUNC, 0o640)
	if err != nil {
		return err
	}
	defer f.Close()
	if _, err := io.Copy(f, r); err != nil {
		_ = os.Remove(full)
		return err
	}
	return nil
}

func (s *localStore) Open(_ context.Context, key string) (io.ReadCloser, error) {
	full, err := s.resolve(key)
	if err != nil {
		return nil, err
	}
	return os.Open(full)
}

func (s *localStore) Delete(_ context.Context, key string) error {
	full, err := s.resolve(key)
	if err != nil {
		return err
	}
	if err := os.Remove(full); err != nil && !os.IsNotExist(err) {
		return err
	}
	return nil
}

func (s *localStore) PresignGet(_ context.Context, _ string, _ time.Duration) (string, error) {
	return "", ErrPresignUnsupported
}

// PublicURL is unsupported for the local backend; public objects are served
// through the authenticated app content route instead.
func (s *localStore) PublicURL(_ string) (string, bool) {
	return "", false
}
