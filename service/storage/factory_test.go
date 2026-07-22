package storage

import (
	"bytes"
	"context"
	"io"
	"testing"

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
}
