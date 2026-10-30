package plugin

import (
	"context"
	"encoding/json"
	"os"
	"path/filepath"
	"testing"

	"github.com/stretchr/testify/assert"
	"github.com/stretchr/testify/require"
	"github.com/yetone/magpie/internal/boxai"
)

func TestBoxAITools(t *testing.T) {
	sandbox(t)
	was := boxai.Enabled()
	boxai.Enable()
	t.Cleanup(func() { Settle(); boxai.SetEnabled(was) })
	ctx := context.Background()
	abs, err := filepath.Abs("testdata/tools")
	require.NoError(t, err)
	_, err = Add(ctx, abs)
	require.NoError(t, err)
	tools, err := Tools(ctx)
	require.NoError(t, err)
	require.Len(t, tools, 1)
	assert.Equal(t, abs, tools[0].Spec)
	got, err := RunTool(ctx, abs, "shout", json.RawMessage(`{"text":"boxai"}`), "claude")
	require.NoError(t, err)
	assert.Equal(t, "BOXAI (for claude)", got)
	for _, method := range []string{"providers", "authorize", "apiKey", "load", "import", "setProviderOptions", "init"} {
		assert.ErrorContains(t, Call(ctx, method, nil, nil), "unavailable in BoxAI Connect", method)
	}
	_, err = Fetch(ctx, FetchRequest{Provider: "third-party"})
	assert.ErrorContains(t, err, "unavailable in BoxAI Connect")
	require.NoError(t, SetOff(abs, true))
	tools, err = Tools(ctx)
	require.NoError(t, err)
	assert.Empty(t, tools)
	_, err = RunTool(ctx, abs, "shout", nil, "claude")
	assert.Error(t, err)
}

func TestBoxAIToolsRefuseMixedHooks(t *testing.T) {
	for _, hook := range []string{"auth: {provider: 'other'}", "provider: {}", "config() { throw new Error('CONFIG RAN') }", "'chat.headers': () => {}"} {
		t.Run(hook, func(t *testing.T) {
			sandbox(t)
			was := boxai.Enabled()
			boxai.Enable()
			t.Cleanup(func() { Settle(); boxai.SetEnabled(was) })
			dir := t.TempDir()
			// Separate exports must be classified together, not admitted one by one.
			source := `export const Tools = async () => ({tool: {echo: {execute: () => 'ran'}}});
export const Other = async () => ({` + hook + `});`
			require.NoError(t, os.WriteFile(filepath.Join(dir, "index.mjs"), []byte(source), 0600))
			ctx := context.Background()
			_, err := Add(ctx, dir)
			require.NoError(t, err)
			loaded, err := Plugins(ctx)
			require.NoError(t, err)
			require.Len(t, loaded, 1)
			assert.Contains(t, loaded[0].Error, "only OpenCode tool hooks")
			assert.NotContains(t, loaded[0].Error, "CONFIG RAN")
			tools, err := Tools(ctx)
			require.NoError(t, err)
			assert.Empty(t, tools)
			_, err = RunTool(ctx, dir, "echo", nil, "claude")
			assert.Error(t, err)
		})
	}
}

func TestBoxAIToolCannotUseHostAuthClient(t *testing.T) {
	sandbox(t)
	was := boxai.Enabled()
	boxai.Enable()
	t.Cleanup(func() { Settle(); boxai.SetEnabled(was) })
	dir := t.TempDir()
	source := `export default async ({client}) => ({tool: {
set: {execute: () => client.auth.set({path: {id: 'other'}, body: {type: 'api', key: 'test'}})},
remove: {execute: () => client.auth.remove({path: {id: 'other'}})}
}});`
	require.NoError(t, os.WriteFile(filepath.Join(dir, "index.mjs"), []byte(source), 0600))
	ctx := context.Background()
	_, err := Add(ctx, dir)
	require.NoError(t, err)
	tools, err := Tools(ctx)
	require.NoError(t, err)
	require.Len(t, tools, 1)
	for _, name := range []string{"set", "remove"} {
		_, err := RunTool(ctx, dir, name, nil, "claude")
		assert.ErrorContains(t, err, "unavailable in BoxAI Connect")
	}
	_, err = os.Stat(AuthPath())
	assert.True(t, os.IsNotExist(err), "the host must not create provider auth storage")
}
