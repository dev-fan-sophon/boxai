package library

import (
	"archive/zip"
	"bytes"
	"crypto/sha256"
	"encoding/hex"
	"os"
	"path/filepath"
	"testing"

	"github.com/stretchr/testify/assert"
	"github.com/stretchr/testify/require"
	"github.com/yetone/magpie/internal/agent"
	"github.com/yetone/magpie/internal/edit"
	"github.com/yetone/magpie/internal/gateway"
)

func TestOfficialAllFiveFormatsRestoreMCPAndSkills(t *testing.T) {
	h := t.TempDir()
	t.Setenv("HOME", h)
	t.Setenv("USERPROFILE", h)
	t.Setenv("XDG_CONFIG_HOME", filepath.Join(h, ".config"))
	t.Setenv("CLAUDE_CONFIG_DIR", "")
	t.Setenv("CODEX_HOME", "")
	t.Setenv("GROK_HOME", "")
	require.NoError(t, agent.InitializeSafety(filepath.Join(h, "state"), filepath.Join(h, "coordinator")))
	agent.SetAuthenticated(true)
	t.Cleanup(func() { agent.SetAuthenticated(false); agent.SetPolicies(nil); ClearOfficialCatalog() })
	ids := []string{"claude", "codex", "gemini", "grok", "opencode"}
	policies := map[string]agent.Policy{}
	for _, id := range ids {
		wire := id
		if wire == "grok" {
			wire = "grokbuild"
		}
		policies[wire] = agent.Policy{Enabled: true}
	}
	agent.SetPolicies(policies)
	var archive bytes.Buffer
	z := zip.NewWriter(&archive)
	w, err := z.Create("SKILL.md")
	require.NoError(t, err)
	_, err = w.Write([]byte("official instructions"))
	require.NoError(t, err)
	require.NoError(t, z.Close())
	hash := sha256.Sum256(archive.Bytes())
	c := OfficialCatalog{MCPServers: []OfficialMCP{{ID: "media", Name: "BoxAI Media"}}, Skills: []OfficialSkill{{ID: "media", Name: "Media", Version: "1", Format: "zip", SHA256: hex.EncodeToString(hash[:]), SizeBytes: int64(archive.Len())}}}
	server := Server{Name: "media", Transport: "http", URL: gateway.URL() + "/mcp/media", Headers: map[string]string{"Authorization": "Bearer " + gateway.Credential()}}
	require.NoError(t, SetOfficialCatalog(c, func(string) ([]byte, error) { return archive.Bytes(), nil }, func(string) (Server, error) { return server, nil }))
	for _, id := range ids {
		a, err := agent.Find(id)
		require.NoError(t, err)
		tg := targetOf(a)
		require.NotNil(t, tg)
		require.NoError(t, tg.MCP.put(&Server{Name: "mine", Transport: "stdio", Command: "keep-my-command"}, nil))
	}
	_, err = InstallServer("media", nil, ids)
	require.NoError(t, err)
	_, err = InstallMarketSkill("boxai", "media", ids)
	require.NoError(t, err)
	_, err = InstallServer("media", nil, ids)
	require.NoError(t, err)
	_, err = InstallMarketSkill("boxai", "media", ids)
	require.NoError(t, err)
	for _, id := range ids {
		a, err := agent.Find(id)
		require.NoError(t, err)
		tg := targetOf(a)
		servers, err := tg.MCP.read()
		require.NoError(t, err)
		require.Contains(t, servers, "media", id)
		assert.Equal(t, server.URL, servers["media"].URL)
		assert.Equal(t, server.Headers, servers["media"].Headers)
		require.FileExists(t, filepath.Join(tg.Skills, "media", "SKILL.md"))
	}
	require.NoError(t, agent.RestoreAll())
	for _, id := range ids {
		a, err := agent.Find(id)
		require.NoError(t, err)
		tg := targetOf(a)
		servers, err := tg.MCP.read()
		require.NoError(t, err)
		assert.NotContains(t, servers, "media")
		require.Contains(t, servers, "mine")
		assert.Equal(t, "keep-my-command", servers["mine"].Command)
		require.NoFileExists(t, filepath.Join(tg.Skills, "media", "SKILL.md"))
	}
	_, err = InstallServer("media", nil, ids)
	assert.ErrorContains(t, err, "sign in")
}

func TestMCPSerializationPreservesCodexChildArraysAndOtherServers(t *testing.T) {
	p := filepath.Join(t.TempDir(), "config.toml")
	input := "[mcp_servers.media]\nurl = 'http://127.0.0.1:1234/mcp/media'\n[[mcp_servers.media.env_vars]]\nname='FIRST'\nsource='local'\n[[mcp_servers.media.env_vars]]\nname='SECOND'\nsource='local'\n[mcp_servers.other]\ncommand='keep'\n"
	require.NoError(t, edit.WriteAtomic(p, []byte(input)))
	f := mcpFile{Path: p, Format: fmtCodex}
	before, err := f.entries()
	require.NoError(t, err)
	require.NoError(t, f.put(&Server{Name: "media", Transport: "http", URL: "http://127.0.0.1:1235/mcp/media"}, before["media"]))
	after, err := f.entries()
	require.NoError(t, err)
	assert.Equal(t, before["media"]["env_vars"], after["media"]["env_vars"])
	assert.Equal(t, before["other"], after["other"])
	require.NoError(t, f.del("media"))
	after, err = f.entries()
	require.NoError(t, err)
	assert.NotContains(t, after, "media")
	assert.Contains(t, after, "other")
	broken := []byte("[mcp_servers.media]\nurl = [\n")
	require.NoError(t, edit.WriteAtomic(p, broken))
	assert.Error(t, f.del("media"))
	got, err := os.ReadFile(p)
	require.NoError(t, err)
	assert.Equal(t, broken, got)
}

func TestUnofficialMutationsAreRejected(t *testing.T) {
	_, err := SaveServer("", Server{Name: "arbitrary", Transport: "stdio", Command: "run"})
	assert.ErrorContains(t, err, "official catalog")
	_, err = Restore(&Setup{})
	assert.ErrorContains(t, err, "official catalog")
	_, err = Sync()
	assert.ErrorContains(t, err, "official catalog")
	_, err = ProbeSkills("https://github.com/example/skills")
	assert.ErrorContains(t, err, "official catalog")
	_, err = UpdateSkills()
	assert.ErrorContains(t, err, "official catalog")
	_, err = SetRTK("claude", true)
	assert.ErrorContains(t, err, "official catalog")
	_, err = InstallRTK()
	assert.ErrorContains(t, err, "official catalog")
}
