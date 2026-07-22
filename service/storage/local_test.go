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

func TestLocalStorePutOpenDelete(t *testing.T) {
	s := newLocalStore(t.TempDir())
	ctx := context.Background()
	key := "uploads/42/sample.txt"

	require.NoError(t, s.Put(ctx, key, bytes.NewReader([]byte("hello")), 5, "text/plain"))

	rc, err := s.Open(ctx, key)
	require.NoError(t, err)
	got, err := io.ReadAll(rc)
	require.NoError(t, rc.Close())
	require.NoError(t, err)
	assert.Equal(t, "hello", string(got))

	require.NoError(t, s.Delete(ctx, key))
	_, err = s.Open(ctx, key)
	assert.Error(t, err)
	// deleting a missing object is not an error
	require.NoError(t, s.Delete(ctx, key))
}

func TestLocalStoreRejectsTraversal(t *testing.T) {
	s := newLocalStore(t.TempDir())
	ctx := context.Background()
	for _, key := range []string{"", "../escape", "a/../../b", "/abs/key"} {
		err := s.Put(ctx, key, bytes.NewReader(nil), 0, "")
		assert.ErrorIs(t, err, ErrInvalidKey, "key %q must be rejected", key)
	}
}

func TestLocalStorePresignUnsupported(t *testing.T) {
	s := newLocalStore(t.TempDir())
	_, err := s.PresignGet(context.Background(), "uploads/1/x", time.Minute)
	assert.ErrorIs(t, err, ErrPresignUnsupported)
	_, ok := s.PublicURL("public/1/x")
	assert.False(t, ok)
}

func TestIsPublicKey(t *testing.T) {
	assert.True(t, IsPublicKey("public/1/x.png"))
	assert.True(t, IsPublicKey("inspiration/hero/cover.png"))
	assert.False(t, IsPublicKey("uploads/1/x.png"))
	assert.False(t, IsPublicKey("outputs/1/x.png"))
}
