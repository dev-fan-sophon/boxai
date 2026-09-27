package settings

import (
	"os"
	"path/filepath"
	"testing"

	"github.com/stretchr/testify/assert"
	"github.com/stretchr/testify/require"
)

func TestBoxAISettings(t *testing.T) {
	cfg := t.TempDir()
	t.Setenv("XDG_CONFIG_HOME", cfg)
	assert.Equal(t, filepath.Join(cfg, "boxai-connect", "settings.json"), Path())
	assert.Equal(t, "direct", Load().Proxy)
	assert.Equal(t, "system", Load().Theme)
	require.NoError(t, Save(Settings{Theme: "dark", Lang: "vi", Tray: "window"}))
	s := Load()
	assert.Equal(t, "vi", s.Lang)
	assert.Equal(t, "dark", s.Theme)
	assert.Equal(t, "window", s.Tray)
	assert.Equal(t, "direct", s.Proxy)
	require.Error(t, Save(Settings{Theme: "sepia"}))
	require.Error(t, Save(Settings{Lang: "zh"}))
	require.Error(t, Save(Settings{Proxy: "http://untrusted.example"}))
	require.NoError(t, Save(Settings{}))
	assert.Equal(t, "system", Load().Theme)
	require.NoError(t, os.WriteFile(Path(), []byte(`{"proxy":"http://untrusted.example"}`), 0o600))
	assert.Equal(t, "direct", Load().Proxy, "hand-edited settings cannot redirect account traffic")
}

func TestMigrateDoesNotImportCredentials(t *testing.T) {
	cfg := t.TempDir()
	t.Setenv("XDG_CONFIG_HOME", cfg)
	for _, product := range []string{"dial", "magpie"} {
		old := filepath.Join(cfg, product)
		require.NoError(t, os.MkdirAll(old, 0o700))
		require.NoError(t, os.WriteFile(filepath.Join(old, "providers.json"), []byte(`{"key":"old-secret"}`), 0o600))
	}
	Migrate()
	assert.NoDirExists(t, Dir())
	require.NoError(t, Save(Settings{Lang: "en"}))
	Migrate()
	assert.NoFileExists(t, filepath.Join(Dir(), "providers.json"))
	assert.Equal(t, "en", Load().Lang)
}

func TestArrange(t *testing.T) {
	t.Setenv("XDG_CONFIG_HOME", t.TempDir())
	s := Settings{AgentOrder: []string{"codex", "gone", "claude", "codex"}, AgentsHidden: []string{"crush"}}
	require.NoError(t, Save(s))
	s = Load()
	assert.Equal(t, []string{"codex", "gone", "claude"}, s.AgentOrder)
	shown, hidden := Arrange(s, []string{"claude", "gemini", "crush", "codex", "pi"}, func(x string) string { return x })
	assert.Equal(t, []string{"codex", "claude", "gemini", "pi"}, shown)
	assert.Equal(t, []string{"crush"}, hidden)
	s.Theme = "dark"
	require.NoError(t, Save(s))
	assert.Equal(t, []string{"crush"}, Load().AgentsHidden)
}
