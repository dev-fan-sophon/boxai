package storage

import (
	"context"
	"io"
	"time"
)

// unavailableStore preserves the legacy Default() interface while failing all
// operations closed. Fixtures can configure local storage without init panics.
type unavailableStore struct {
	backend string
	err     error
}

func (s *unavailableStore) Backend() string                                             { return s.backend }
func (s *unavailableStore) Put(context.Context, string, io.Reader, int64, string) error { return s.err }
func (s *unavailableStore) Open(context.Context, string) (io.ReadCloser, error)         { return nil, s.err }
func (s *unavailableStore) Delete(context.Context, string) error                        { return s.err }
func (s *unavailableStore) PresignGet(context.Context, string, time.Duration) (string, error) {
	return "", s.err
}
func (s *unavailableStore) PresignPut(context.Context, string, string, time.Duration) (string, error) {
	return "", s.err
}
func (s *unavailableStore) PublicURL(string) (string, bool) { return "", false }
