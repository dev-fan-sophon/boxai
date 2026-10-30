package provider

import (
	"context"
	"fmt"
	"io"
	"net/http"
	"os"
	"path/filepath"
	"testing"

	"github.com/stretchr/testify/assert"
	"github.com/stretchr/testify/require"
	"github.com/yetone/magpie/internal/boxai"
	"github.com/yetone/magpie/internal/catalog"
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
	t.Cleanup(func() { boxai.SetEnabled(false) })

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
	require.NoError(t, catalog.SaveLive("boxai", p.Chat, []catalog.Model{{ID: "model-a"}, {ID: "model-b"}}))
	id, err := Add(p)
	require.NoError(t, err)
	assert.Equal(t, "boxai", id)
	manual := load()
	manual.Providers[1].Key = "manual-key-before-browser-login"
	manual.Providers[1].Keys = []KeyAccount{{Key: "manual-secondary-key"}}
	manual.Providers[1].Headers = map[string]string{"Authorization": "Bearer manual-override"}
	require.NoError(t, store(manual))
	assert.Empty(t, All(), "a provider file cannot bypass browser login")
	// A saved key configures the provider, with no account/session request.
	require.NoError(t, os.WriteFile(filepath.Join(filepath.Dir(Path()), "auth.json"), []byte(`{"session":"sk-browser-test-session"}`), 0600))
	transport := http.DefaultTransport
	http.DefaultTransport = boxAITransport(func(r *http.Request) (*http.Response, error) {
		t.Error("reading provider configuration must not make a network request")
		return nil, fmt.Errorf("unexpected network request")
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
	assert.Equal(t, foreign, load().Providers[0], "adding BoxAI must preserve old records")
	exported, err := Stored()
	require.NoError(t, err)
	require.Len(t, exported, 1)
	assert.Empty(t, exported[0].Key, "backup must never carry the website credential")
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
		"gemini endpoint":    func(p *Provider) { p.Gemini = "https://example.invalid" },
		"remote gateway":     func(p *Provider) { p.Preset = RemoteMagpiePreset },
		"vertex":             func(p *Provider) { p.Vertex = &Vertex{} },
		"auth header":        func(p *Provider) { p.AuthHeader = "x-secret" },
		"proxy":              func(p *Provider) { p.Proxy = "https://example.invalid" },
		"insecure TLS":       func(p *Provider) { p.InsecureTLS = true },
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
	require.NoError(t, Mirror(exported, nil))
	assert.Equal(t, foreign, load().Providers[0], "sync must preserve inactive third-party records")
	require.Error(t, Delete(foreign.ID))
}

func TestBoxAIModelsDoNotRequireProviderEditorSelection(t *testing.T) {
	t.Setenv("XDG_CACHE_HOME", t.TempDir())
	UseBoxAI()
	t.Cleanup(func() { boxai.SetEnabled(false) })
	models := make([]catalog.Model, 25)
	for i := range models {
		models[i] = catalog.Model{ID: fmt.Sprintf("model-%02d", i)}
	}
	require.NoError(t, catalog.SaveLive("boxai", "https://you-box.com/v1", models))
	p := Provider{ID: "boxai"}
	exposed := p.Exposed()
	require.Len(t, exposed, 25, "no provider editor remains to select models beyond the old 24-model default")
	assert.Equal(t, "model-24", exposed[24].ID)
	p.Models = []string{"model-24"}
	require.Len(t, p.Exposed(), 1, "preserve an existing explicit model selection")
}

func TestBoxAIExposedConversationalCatalog(t *testing.T) {
	t.Setenv("XDG_CACHE_HOME", t.TempDir())
	UseBoxAI()
	t.Cleanup(func() { boxai.SetEnabled(false) })
	no, yes := false, true
	require.NoError(t, catalog.SaveLive("boxai", "https://you-box.com/v1", []catalog.Model{
		{ID: "vision-chat", Images: true, Conversational: &yes},
		{ID: "artist", Conversational: &no},
		{ID: "veo-3"},
		{ID: "text-chat"},
	}))
	p := Provider{ID: "boxai", Models: []string{"artist", "vision-chat", "veo-3", "missing"}}
	models := p.Exposed()
	require.Len(t, models, 1)
	assert.Equal(t, "vision-chat", models[0].ID)
	p.Models = nil
	models = p.Exposed()
	require.Len(t, models, 2)
	assert.Equal(t, "text-chat", models[1].ID)
}

func TestBoxAIRuntimeStripsAlternateTransports(t *testing.T) {
	p := sanitizedBoxAI(Provider{
		ID: "boxai", Preset: RemoteMagpiePreset, Gemini: "https://other.invalid",
		Vertex: &Vertex{}, AuthHeader: "x-secret", Proxy: "https://other.invalid",
		AccountProxies: map[string]string{"key": "https://other.invalid"},
		Headers:        map[string]string{"Authorization": "old"}, InsecureTLS: true,
		AccessKeyID: "old", SecretAccessKey: "old", BalanceToken: "old",
		Models: []string{"chat"},
	}, "session")
	assert.Equal(t, "boxai", p.Preset)
	assert.Empty(t, p.Gemini)
	assert.Nil(t, p.Vertex)
	assert.Empty(t, p.AuthHeader)
	assert.Empty(t, p.Proxy)
	assert.Empty(t, p.AccountProxies)
	assert.Empty(t, p.Headers)
	assert.False(t, p.InsecureTLS)
	assert.Empty(t, p.AccessKeyID)
	assert.Empty(t, p.SecretAccessKey)
	assert.Empty(t, p.BalanceToken)
	assert.Equal(t, "session", p.Key)
	assert.Equal(t, []string{"chat"}, p.Models)
}

func TestBoxAITransportRefusesForeignOrigins(t *testing.T) {
	UseBoxAI()
	t.Cleanup(func() { boxai.SetEnabled(false) })
	calls := 0
	client := &http.Client{Transport: boxAITransport(func(r *http.Request) (*http.Response, error) {
		calls++
		assert.Equal(t, "you-box.com", r.URL.Host)
		return &http.Response{StatusCode: http.StatusFound, Header: http.Header{"Location": {"https://other.you-box.com/stolen"}}, Body: io.NopCloser(http.NoBody), Request: r}, nil
	})}
	p := Provider{ID: "boxai"}
	for _, url := range []string{"https://other.invalid/v1", "http://you-box.com/v1", "https://you-box.com:444/v1"} {
		req, err := http.NewRequest(http.MethodGet, url, nil)
		require.NoError(t, err)
		_, err = p.Do(client, req)
		require.Error(t, err)
	}
	assert.Zero(t, calls)
	req, err := http.NewRequest(http.MethodGet, "https://you-box.com/v1/models", nil)
	require.NoError(t, err)
	_, err = p.Do(client, req)
	require.Error(t, err)
	assert.Equal(t, 1, calls, "the redirect must not receive a request")
}
