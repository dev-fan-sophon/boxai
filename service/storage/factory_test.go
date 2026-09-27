package storage

import (
	"bytes"
	"context"
	"io"
	"testing"
	"time"

	"github.com/stretchr/testify/assert"
	"github.com/stretchr/testify/require"
)

func TestForBackendUsesPersistedBackend(t *testing.T) {
	t.Setenv("PLAYGROUND_ASSETS_DIR", t.TempDir())
	store, err := ForBackend("local")
	require.NoError(t, err)
	assert.Equal(t, "local", store.Backend())

	_, err = ForBackend("unknown")
	require.ErrorContains(t, err, "unsupported backend")
}

func TestMisconfiguredDefaultFailsClosed(t *testing.T) {
	t.Setenv("STORAGE_BACKEND", "r2")
	t.Setenv("R2_ENDPOINT", "")
	t.Setenv("PLAYGROUND_ASSETS_DIR", t.TempDir())
	Reset()
	t.Cleanup(Reset)
	store := Default()
	assert.Equal(t, "r2", store.Backend())
	require.Error(t, store.Put(context.Background(), "test", bytes.NewBufferString("data"), 4, "text/plain"))
	_, err := store.Open(context.Background(), "test")
	require.Error(t, err)
	_, err = store.PresignPut(context.Background(), "test", "text/plain", time.Minute)
	require.Error(t, err)
	assert.NotErrorIs(t, err, ErrPresignUnsupported)
}

func TestPersistedLocalBackendIgnoresChangedDefault(t *testing.T) {
	t.Setenv("PLAYGROUND_ASSETS_DIR", t.TempDir())
	store, err := ForBackend("local")
	require.NoError(t, err)
	require.NoError(t, store.Put(context.Background(), "proofs/test.txt", bytes.NewBufferString("proof"), 5, "text/plain"))

	t.Setenv("STORAGE_BACKEND", "r2")
	Reset()
	persistedStore, err := ForBackend("local")
	require.NoError(t, err)
	body, err := persistedStore.Open(context.Background(), "proofs/test.txt")
	require.NoError(t, err)
	defer body.Close()
	data, err := io.ReadAll(body)
	require.NoError(t, err)
	assert.Equal(t, "proof", string(data))

	legacyStore, err := ForBackend("")
	require.NoError(t, err)
	assert.Equal(t, "local", legacyStore.Backend())
}
