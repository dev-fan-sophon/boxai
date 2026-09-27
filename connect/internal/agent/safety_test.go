package agent

import (
	"os"
	"path/filepath"
	"testing"

	"github.com/stretchr/testify/assert"
	"github.com/stretchr/testify/require"
	"github.com/yetone/magpie/internal/edit"
	"github.com/yetone/magpie/internal/provider"
)

func TestBoxAISafetyGatesAppliesAndRestores(t *testing.T) {
	home := t.TempDir()
	t.Setenv("HOME", home)
	t.Setenv("XDG_CONFIG_HOME", filepath.Join(home, ".config"))
	t.Setenv("CODEX_HOME", "")
	t.Setenv("GROK_HOME", "")
	require.NoError(t, provider.Save(provider.Provider{ID: "boxai", Name: "BoxAI", Key: "not-root", Chat: "http://127.0.0.1:1/v1", Models: []string{"allowed", "blocked"}}))
	require.NoError(t, InitializeSafety(filepath.Join(home, "state"), filepath.Join(home, "coordinator")))
	t.Cleanup(func() {
		SetAuthenticated(false)
		SetPolicies(nil)
		safety.Lock()
		safety.projection = nil
		safety.Unlock()
		safetyConfigured.Store(false)
	})
	SetPolicies(map[string]Policy{"claude": {Enabled: true, Models: []string{"allowed", "blocked"}, LockedModel: "allowed"}, "codex": {Enabled: true, Models: []string{"allowed"}}, "grokbuild": {Enabled: true, Models: []string{"allowed"}}, "opencode": {Enabled: true, Models: []string{"allowed"}}, "gemini": {Enabled: true, Models: []string{"allowed"}}})
	for _, a := range All() {
		assert.Error(t, a.Apply("model", "boxai/allowed"))
		assert.Error(t, a.Keep(), "unauthenticated bookkeeping changes must report failure")
		_, err := os.Stat(a.Path)
		assert.ErrorIs(t, err, os.ErrNotExist)
	}
	SetAuthenticated(true)
	for _, a := range All() {
		require.NoError(t, a.Apply("model", "boxai/allowed"), a.ID)
		require.NoError(t, a.Apply("model", "boxai/allowed"), "repeat "+a.ID)
		assert.Error(t, a.Apply("model", "vendor/raw"))
		assert.Error(t, a.Apply("model", "boxai/blocked"))
	}
	cl := claude(home)
	require.NoError(t, edit.SetJSON(cl.Path, edit.KV{Path: "user_theme", Value: "dark"}))
	assert.ErrorContains(t, cl.Apply("model", "boxai/allowed"), "edited outside")
	require.NoError(t, RestoreAll())
	v, _ := edit.GetJSON(cl.Path, "user_theme")
	assert.Equal(t, "dark", v)
	_, ok := edit.GetJSON(cl.Path, "env.ANTHROPIC_AUTH_TOKEN")
	assert.False(t, ok)
	assert.False(t, Authenticated())
	assert.Error(t, cl.Apply("model", "boxai/allowed"))
}
