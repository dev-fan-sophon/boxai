package agent

import (
	"os"
	"path/filepath"
	"strings"
	"testing"

	"github.com/stretchr/testify/assert"
	"github.com/stretchr/testify/require"
	"github.com/yetone/magpie/internal/gateway"
	"github.com/yetone/magpie/internal/provider"
)

func TestAuthenticatedDriftRejectsExternalReapply(t *testing.T) {
	for _, id := range []string{"claude", "codex", "gemini", "grok", "opencode"} {
		t.Run(id, func(t *testing.T) {
			home := t.TempDir()
			t.Setenv("HOME", home)
			t.Setenv("XDG_CONFIG_HOME", filepath.Join(home, ".config"))
			t.Setenv("CODEX_HOME", "")
			t.Setenv("CLAUDE_CONFIG_DIR", "")
			t.Setenv("GROK_HOME", "")
			require.NoError(t, provider.Save(provider.Provider{ID: "boxai", Name: "BoxAI", Key: "local", Chat: "http://127.0.0.1:1/v1", Models: []string{"allowed"}}))
			require.NoError(t, InitializeSafety(filepath.Join(home, "state"), filepath.Join(home, "coordinator")))
			wire := id
			if wire == "grok" {
				wire = "grokbuild"
			}
			SetPolicies(map[string]Policy{wire: {Enabled: true, Models: []string{"allowed"}}})
			SetAuthenticated(true)
			t.Cleanup(func() {
				SetAuthenticated(false)
				SetPolicies(nil)
				safety.Lock()
				safety.projection = nil
				safety.Unlock()
				safetyConfigured.Store(false)
			})
			a, err := Find(id)
			require.NoError(t, err)
			require.NoError(t, a.Apply("model", "boxai/allowed"))
			require.Nil(t, a.Drift())
			changed := map[string][]byte{}
			for _, p := range a.projectionPaths() {
				b, err := os.ReadFile(p)
				if os.IsNotExist(err) {
					continue
				}
				require.NoError(t, err)
				updated := strings.ReplaceAll(string(b), gateway.URL(), "http://127.0.0.1:9")
				if updated != string(b) {
					require.NoError(t, os.WriteFile(p, []byte(updated), 0600))
					changed[p] = []byte(updated)
				}
			}
			require.NotEmpty(t, changed)
			d := a.Drift()
			require.NotNil(t, d)
			assert.Equal(t, "unwired", d.Kind)
			assert.ErrorContains(t, a.Reapply(), "edited outside")
			assert.Error(t, RestoreAll())
			for p, want := range changed {
				got, err := os.ReadFile(p)
				require.NoError(t, err)
				assert.Equal(t, want, got)
			}
		})
	}
}
