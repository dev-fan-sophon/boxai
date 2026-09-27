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
	"github.com/yetone/magpie/internal/provider"
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
}
