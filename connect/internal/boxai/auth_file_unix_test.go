//go:build !windows

package boxai

import (
	"context"
	"os"
	"testing"

	"github.com/stretchr/testify/assert"
	"github.com/stretchr/testify/require"
)

func TestAuthFileIsPrivateAndRejectsSymlinks(t *testing.T) {
	v := authFileFixture(t)
	require.NoError(t, v.Set(context.Background(), "session", testToken))
	st, err := os.Stat(v.path)
	require.NoError(t, err)
	assert.Equal(t, os.FileMode(0600), st.Mode().Perm())
	target := v.path + ".original"
	require.NoError(t, os.Rename(v.path, target))
	require.NoError(t, os.Symlink(target, v.path))
	require.ErrorIs(t, v.Set(context.Background(), "session", "replacement"), ErrVaultUnavailable)
	_, err = v.Get(context.Background(), "session")
	assert.ErrorIs(t, err, ErrVaultUnavailable)
	b, err := os.ReadFile(target)
	require.NoError(t, err)
	assert.JSONEq(t, `{"session":"`+testToken+`"}`, string(b))
}
