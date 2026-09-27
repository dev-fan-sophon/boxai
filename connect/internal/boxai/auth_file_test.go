package boxai

import (
	"context"
	"errors"
	"net/http"
	"net/http/httptest"
	"os"
	"path/filepath"
	"sync/atomic"
	"testing"

	"github.com/stretchr/testify/assert"
	"github.com/stretchr/testify/require"
)

func authFileFixture(t *testing.T) fileVault {
	t.Helper()
	dir, err := filepath.EvalSymlinks(t.TempDir())
	require.NoError(t, err)
	return fileVault{path: filepath.Join(dir, "auth.json")}
}

func TestFileCredentialsRestartAndRecoverFailedLogout(t *testing.T) {
	ctx := context.Background()
	v := authFileFixture(t)
	var revokes atomic.Int32
	s := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		assert.Equal(t, "Bearer "+testToken, r.Header.Get("Authorization"))
		if r.URL.Path == "/api/v1/connector/revoke" {
			revokes.Add(1)
			w.WriteHeader(http.StatusNoContent)
			return
		}
		writeJSON(w, map[string]any{"success": true, "data": provisioningFixture()})
	}))
	defer s.Close()
	c := newClient(s.URL, v, nil)
	require.True(t, c.finish(ctx, 0, testToken, provisioningFixture(), nil))
	gateway, err := c.LocalGatewayToken()
	require.NoError(t, err)
	assert.NotEqual(t, testToken, gateway)
	b, err := os.ReadFile(v.path)
	require.NoError(t, err)
	var saved map[string]string
	require.NoError(t, unmarshal(b, &saved))
	assert.Equal(t, map[string]string{"session": testToken, "gateway": gateway}, saved)

	other := newClient(s.URL, fileVault{path: v.path}, nil)
	require.NoError(t, other.Require(ctx))
	c.SetBeforeLogout(func(context.Context) error { return errors.New("external configuration conflict") })
	require.Error(t, c.Logout(ctx))
	assert.Zero(t, revokes.Load(), "credentials must not be revoked before configuration restore")
	retained, err := v.Get(ctx, "session")
	require.NoError(t, err)
	assert.Equal(t, testToken, retained)
	require.ErrorIs(t, other.Require(ctx), ErrLoginRequired, "pending logout must invalidate another client's warm cache")
	assert.False(t, other.Session().Authenticated)
	restarted := newClient(s.URL, fileVault{path: v.path}, nil)
	require.ErrorIs(t, restarted.Require(ctx), ErrLoginRequired)
	restarted.SetBeforeLogout(func(context.Context) error { return nil })
	require.NoError(t, restarted.Logout(ctx))
	assert.EqualValues(t, 1, revokes.Load())
	require.NoFileExists(t, v.path, "successful logout removes all credential data")
	_, err = v.Get(ctx, "gateway")
	assert.ErrorIs(t, err, errMissing)
}

func TestFileCredentialsObserveReplacementAndDeletion(t *testing.T) {
	ctx := context.Background()
	v := authFileFixture(t)
	require.NoError(t, v.Set(ctx, "session", testToken))
	headers := make(chan string, 2)
	s := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		headers <- r.Header.Get("Authorization")
		writeJSON(w, map[string]any{"success": true, "data": provisioningFixture()})
	}))
	defer s.Close()
	c := newClient(s.URL, v, nil)
	require.NoError(t, c.Require(ctx))
	require.NoError(t, v.Set(ctx, "session", "sk-replaced-session-12345"))
	got, err := c.Token(ctx)
	require.NoError(t, err)
	assert.Equal(t, "sk-replaced-session-12345", got)
	require.Len(t, headers, 2, "a changed file token requires fresh remote validation")
	assert.Equal(t, "Bearer "+testToken, <-headers)
	assert.Equal(t, "Bearer sk-replaced-session-12345", <-headers)
	require.NoError(t, v.Delete(ctx, "session"))
	require.ErrorIs(t, c.Require(ctx), ErrLoginRequired)
	assert.False(t, c.Session().Authenticated)
}

func TestFileCredentialsRejectCorruptionAndCancelledWrites(t *testing.T) {
	v := authFileFixture(t)
	for _, body := range []string{`{"session":`, `null`, `{"session":123}`} {
		require.NoError(t, os.WriteFile(v.path, []byte(body), 0600))
		_, err := v.Get(context.Background(), "session")
		assert.ErrorIs(t, err, ErrVaultUnavailable)
		require.ErrorIs(t, v.Set(context.Background(), "session", testToken), ErrVaultUnavailable)
		b, err := os.ReadFile(v.path)
		require.NoError(t, err)
		assert.Equal(t, body, string(b), "unreadable credentials must never be silently replaced")
	}
	require.NoError(t, os.Remove(v.path))
	ctx, cancel := context.WithCancel(context.Background())
	cancel()
	require.ErrorIs(t, v.Set(ctx, "session", testToken), context.Canceled)
	require.NoFileExists(t, v.path)
	require.NoError(t, os.Mkdir(v.path, 0700))
	_, err := v.Get(context.Background(), "session")
	assert.ErrorIs(t, err, ErrVaultUnavailable)
}
