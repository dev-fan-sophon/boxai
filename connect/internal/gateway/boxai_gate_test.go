package gateway

import (
	"net/http/httptest"
	"os"
	"os/exec"
	"path/filepath"
	"strings"
	"testing"

	"github.com/stretchr/testify/assert"
	"github.com/stretchr/testify/require"
	"github.com/yetone/magpie/internal/plugin"
	"github.com/yetone/magpie/internal/provider"
	"github.com/yetone/magpie/internal/testenv"
)

func TestBoxAIGatewayGate(t *testing.T) {
	// Product mode is process-wide; isolate it from upstream generic tests.
	if os.Getenv("BOXAI_GATE_TEST") != "1" {
		cmd := exec.Command(os.Args[0], "-test.run=^TestBoxAIGatewayGate$")
		cmd.Env = append(os.Environ(), "BOXAI_GATE_TEST=1")
		out, err := cmd.CombinedOutput()
		require.NoError(t, err, string(out))
		return
	}
	t.Setenv("XDG_CONFIG_HOME", t.TempDir())
	provider.UseBoxAI()
	require.NoError(t, os.MkdirAll(filepath.Dir(provider.Path()), 0700))
	require.NoError(t, os.WriteFile(provider.Path(), []byte(`{"providers":[{"id":"boxai","key":"manual-bypass-key","chat":"https://you-box.com/v1"}]}`), 0600))
	h := New().Handler()
	for _, path := range []string{"/v1/models", "/v1/chat/completions", "/v1/responses", "/v1/messages", "/v1/messages/count_tokens", "/v1beta/models/test:countTokens"} {
		method := "POST"
		if path == "/v1/models" {
			method = "GET"
		}
		r := httptest.NewRequest(method, path, strings.NewReader(`{"model":"boxai/test"}`))
		r.Header.Set("Authorization", "Bearer manual-bypass-key")
		w := httptest.NewRecorder()
		h.ServeHTTP(w, r)
		assert.Equal(t, 401, w.Code, path)
		assert.Contains(t, w.Header().Get("Content-Type"), "application/json")
		assert.Contains(t, w.Body.String(), "authentication_error")
	}
	// Tools pass through the same website gate and run in the real Bun host;
	// admitting tools must neither bypass login nor enable provider hooks.
	h = lanGuard(New().Handler())
	assert.Equal(t, 401, toolsPost(h, toolsList).Code)
	require.NoError(t, os.WriteFile(filepath.Join(filepath.Dir(provider.Path()), "auth.json"), []byte(`{"session":"sk-tools-fixture-token"}`), 0600))
	t.Setenv("MAGPIE_BUN", testenv.Bun(t))
	t.Cleanup(plugin.Settle)
	dir := t.TempDir()
	require.NoError(t, os.WriteFile(filepath.Join(dir, "index.mjs"), []byte(`export default async () => ({tool: {echo: {description: 'Echo', args: {type: 'object'}, execute: args => args.text}}});`), 0600))
	_, err := plugin.Add(t.Context(), dir)
	require.NoError(t, err)
	listed := readMCP(t, toolsPost(h, toolsList))
	require.Nil(t, listed.Error)
	require.Len(t, listed.Result.Tools, 1)
	reply := readMCP(t, toolsPost(h, toolsCall(listed.Result.Tools[0].Name, `{"text":"BoxAI tool result"}`)))
	assert.False(t, reply.Result.IsError)
	require.Len(t, reply.Result.Content, 1)
	assert.Equal(t, "BoxAI tool result", reply.Result.Content[0].Text)
	require.NoError(t, os.Remove(filepath.Join(filepath.Dir(provider.Path()), "auth.json")))
	assert.Equal(t, 401, toolsPost(h, toolsList).Code)
}
