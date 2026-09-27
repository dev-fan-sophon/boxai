package agent

import (
	"os"
	"path/filepath"
	"testing"

	"github.com/stretchr/testify/assert"
	"github.com/stretchr/testify/require"
)

func TestStartupDoesNotClaimUnownedLegacyConfig(t *testing.T) {
	h := t.TempDir()
	t.Setenv("HOME", h)
	t.Setenv("XDG_CONFIG_HOME", filepath.Join(h, ".config"))
	t.Setenv("CLAUDE_CONFIG_DIR", "")
	p := filepath.Join(h, ".claude", "settings.json")
	require.NoError(t, os.MkdirAll(filepath.Dir(p), 0700))
	before := []byte(`{"model":"dial/third-party/model","env":{"ANTHROPIC_AUTH_TOKEN":"original"}}`)
	require.NoError(t, os.WriteFile(p, before, 0600))
	RenameLegacy()
	SyncCatalog()
	after, err := os.ReadFile(p)
	require.NoError(t, err)
	assert.Equal(t, before, after)
}
