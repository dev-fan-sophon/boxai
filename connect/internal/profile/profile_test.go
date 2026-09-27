package profile

import (
	"os"
	"path/filepath"
	"testing"

	"github.com/stretchr/testify/assert"
	"github.com/stretchr/testify/require"
	"github.com/yetone/magpie/internal/library"
)

func sandbox(t *testing.T) string {
	t.Helper()
	h := t.TempDir()
	t.Setenv("HOME", h)
	t.Setenv("USERPROFILE", h)
	t.Setenv("XDG_CONFIG_HOME", filepath.Join(h, ".config"))
	t.Setenv("PATH", "")
	for _, k := range []string{"CLAUDE_CONFIG_DIR", "CODEX_HOME", "PI_CODING_AGENT_DIR", "COPILOT_HOME", "APPDATA"} {
		t.Setenv(k, "")
	}
	for _, f := range []string{".claude/settings.json", ".codex/config.toml"} {
		write(t, filepath.Join(h, f), "")
	}
	return h
}

func write(t *testing.T, p, s string) {
	t.Helper()
	require.NoError(t, os.MkdirAll(filepath.Dir(p), 0700))
	require.NoError(t, os.WriteFile(p, []byte(s), 0600))
}

func read(t *testing.T, p string) string {
	t.Helper()
	b, err := os.ReadFile(p)
	require.NoError(t, err)
	return string(b)
}

// Legacy profiles remain readable and round-trip without granting permission
// to project their third-party model choices or alter existing instructions.
func TestOldProfiles(t *testing.T) {
	h := sandbox(t)
	old := "{\n  \"work\": {\n    \"claude.model\": \"acme/m1\",\n    \"codex.model\": \"acme/m2\"\n  }\n}\n"
	write(t, Path(), old)
	ps, err := Load()
	require.NoError(t, err)
	p := ps["work"]
	assert.Nil(t, p.Library)
	assert.Equal(t, map[string]string{"claude.model": "acme/m1", "codex.model": "acme/m2"}, p.Fields)
	assert.Equal(t, "claude acme/m1 · codex acme/m2", LongSummary(p))
	require.NoError(t, store(ps))
	assert.Equal(t, old, read(t, Path()))
	instructions := filepath.Join(h, ".claude", "CLAUDE.md")
	write(t, instructions, "User-owned instructions.\n")
	a, err := Apply(p)
	require.ErrorContains(t, err, "not enabled by BoxAI provisioning")
	assert.Zero(t, a.Changed)
	assert.Nil(t, a.Library)
	assert.Empty(t, Report(a))
	assert.Equal(t, "User-owned instructions.\n", read(t, instructions))
	assert.Empty(t, read(t, filepath.Join(h, ".claude", "settings.json")))
	assert.Empty(t, read(t, filepath.Join(h, ".codex", "config.toml")))
}

// Read-only snapshots preserve the old library metadata, but replaying that
// metadata cannot bypass the authenticated official-catalog installation API.
func TestProfileCarriesLibrary(t *testing.T) {
	h := sandbox(t)
	p, err := Snapshot()
	require.NoError(t, err)
	assert.Nil(t, p.Library)
	legacyPath := filepath.Join(filepath.Dir(Path()), "library.json")
	legacy := `{"instructions":{"agents":["claude","codex"]},"mcp":[{"name":"fs","transport":"stdio","command":"npx","agents":["claude"]},{"name":"other","transport":"stdio","command":"other","agents":["codex"]}],"skills":[]}`
	write(t, legacyPath, legacy)
	instructions := filepath.Join(library.Dir(), "instructions.md")
	write(t, instructions, "Use tabs.\n")
	p, err = Snapshot()
	require.NoError(t, err)
	require.NotNil(t, p.Library)
	assert.Equal(t, map[string][]string{"fs": {"claude"}, "other": {"codex"}}, p.Library.MCP)
	assert.Equal(t, "Use tabs.", p.Library.Instructions.Shared)
	assert.Equal(t, []string{"claude", "codex"}, p.Library.Instructions.Agents)
	require.NoError(t, Save("a", p))
	ps, err := Load()
	require.NoError(t, err)
	assert.Equal(t, p, ps["a"])
	assert.Equal(t, "+ library: 2 servers, instructions", LongSummary(ps["a"]))
	a, err := Apply(ps["a"])
	require.ErrorContains(t, err, "official catalog")
	assert.Zero(t, a.Changed)
	assert.Nil(t, a.Library)
	assert.Equal(t, legacy, read(t, legacyPath))
	assert.Equal(t, "Use tabs.\n", read(t, instructions))
	assert.Empty(t, read(t, filepath.Join(h, ".claude", "settings.json")))
	assert.Empty(t, read(t, filepath.Join(h, ".codex", "config.toml")))
	require.NoFileExists(t, filepath.Join(h, ".claude.json"))
}
