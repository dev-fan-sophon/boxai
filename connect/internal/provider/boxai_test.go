package provider

import (
	"context"
	"io"
	"net/http"
	"os"
	"path/filepath"
	"strings"
	"testing"

	"github.com/stretchr/testify/assert"
	"github.com/stretchr/testify/require"
	"github.com/yetone/magpie/internal/boxai"
)

type boxAITransport func(*http.Request) (*http.Response, error)

func (f boxAITransport) RoundTrip(r *http.Request) (*http.Response, error) { return f(r) }

func TestBoxAIProviderConfiguration(t *testing.T) {
	home := t.TempDir()
	t.Setenv("HOME", home)
	t.Setenv("USERPROFILE", home)
	t.Setenv("XDG_CONFIG_HOME", filepath.Join(home, ".config"))
	t.Setenv("XDG_CACHE_HOME", filepath.Join(home, ".cache"))
	foreign := Provider{ID: "old-relay", Name: "Old relay", Chat: "https://example.invalid/v1", Key: "old-test-key"}
	require.NoError(t, store(file{Providers: []Provider{foreign}}))
	UseBoxAI()
	t.Cleanup(func() { boxAIOnly.Store(false) })

	require.Len(t, Presets(), 1)
	assert.Equal(t, "boxai", Presets()[0].ID)
	assert.Nil(t, Preset("openai"))
	assert.Empty(t, All())
	assert.Empty(t, Accounts())
	assert.Empty(t, Logins(""))
	_, err := Find("old-relay")
	require.Error(t, err)

	p, err := FromPreset("boxai")
	require.NoError(t, err)
	p.Key, p.Models = "first-test-key", []string{"model-a", "model-b"}
	id, err := Add(p)
	require.NoError(t, err)
	assert.Equal(t, "boxai", id)
	manual := load()
	manual.Providers[1].Key = "manual-key-before-browser-login"
	manual.Providers[1].Keys = []KeyAccount{{Key: "manual-secondary-key"}}
	manual.Providers[1].Headers = map[string]string{"Authorization": "Bearer manual-override"}
	require.NoError(t, store(manual))
	assert.Empty(t, All(), "a provider file cannot bypass browser login")
	// Validate a persisted browser session without making production calls.
	require.NoError(t, os.WriteFile(filepath.Join(filepath.Dir(Path()), "auth.json"), []byte(`{"session":"sk-browser-test-session"}`), 0600))
	transport := http.DefaultTransport
	http.DefaultTransport = boxAITransport(func(r *http.Request) (*http.Response, error) {
		assert.Equal(t, "/api/v1/connector/provisioning", r.URL.Path)
		assert.Equal(t, "Bearer sk-browser-test-session", r.Header.Get("Authorization"))
		return &http.Response{StatusCode: 200, Header: make(http.Header), Body: io.NopCloser(strings.NewReader(`{"success":true,"data":{"account":{"id":1},"usage":{},"billing":{}}}`))}, nil
	})
	t.Cleanup(func() { http.DefaultTransport = transport })
	require.NoError(t, boxai.Require(context.Background()))
	saved, err := Find(id)
	require.NoError(t, err)
	assert.Equal(t, "https://you-box.com/v1", saved.Chat)
	assert.Equal(t, "https://you-box.com/v1", saved.Responses)
	assert.Equal(t, "https://you-box.com", saved.Anthropic)
	assert.Equal(t, p.Models, saved.Models)
	require.Len(t, saved.KeysOn(), 1)
	assert.Equal(t, "sk-browser-test-session", saved.Key)
	saved.Routing = Rotate
	require.NoError(t, Save(*saved))
	assert.Equal(t, Rotate, All()[0].Routing)
	assert.Equal(t, foreign, Stored()[0], "adding BoxAI must preserve old records")
	entries := Catalog()
	require.Len(t, entries, 2)
	assert.Equal(t, "boxai/model-a", entries[0].ID)
	assert.Equal(t, "boxai/model-b", entries[1].ID)
	_, _, ok := Resolve("old-relay/model-a")
	assert.False(t, ok, "old providers must not be reachable through the gateway")

	before, err := os.ReadFile(Path())
	require.NoError(t, err)
	assert.NotContains(t, string(before), "sk-browser-test-session")
	assert.Contains(t, string(before), "manual-key-before-browser-login")
	assert.Contains(t, string(before), "manual-secondary-key")
	assert.Contains(t, string(before), "manual-override")
	assert.Empty(t, saved.Headers, "a stored Authorization header must not override the session")
	for name, change := range map[string]func(*Provider){
		"other ID":           func(p *Provider) { p.ID = "other" },
		"other preset":       func(p *Provider) { p.Preset = "openai" },
		"chat endpoint":      func(p *Provider) { p.Chat = "https://example.invalid/v1" },
		"responses endpoint": func(p *Provider) { p.Responses = "https://example.invalid/v1" },
		"anthropic endpoint": func(p *Provider) { p.Anthropic = "https://example.invalid" },
		"model endpoint":     func(p *Provider) { p.ModelsURL = "https://example.invalid/models" },
		"balance endpoint":   func(p *Provider) { p.BalanceURL = "https://example.invalid/balance" },
	} {
		t.Run(name, func(t *testing.T) {
			bad := *saved
			change(&bad)
			require.Error(t, Save(bad))
			_, _, err := Restore([]Provider{*saved, bad})
			require.Error(t, err)
			require.Error(t, Mirror([]Provider{*saved, bad}, nil))
		})
	}
	_, err = Add(p)
	require.Error(t, err)
	_, err = StartSignIn("claude")
	require.Error(t, err)
	_, err = ParseImport("magpie://import?name=Other")
	require.Error(t, err)
	require.Error(t, Rename("boxai", "other"))
	after, err := os.ReadFile(Path())
	require.NoError(t, err)
	assert.Equal(t, before, after, "rejected operations must not change configuration")
}
