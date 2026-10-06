package claude

import (
	"testing"

	"github.com/dev-fan-sophon/boxai/common"
	"github.com/dev-fan-sophon/boxai/dto"
	relaycommon "github.com/dev-fan-sophon/boxai/relay/common"
	"github.com/stretchr/testify/assert"
	"github.com/stretchr/testify/require"
)

func convertNativeClaudeRequestForTest(t *testing.T, body string) map[string]any {
	t.Helper()
	var req dto.ClaudeRequest
	require.NoError(t, common.UnmarshalJsonStr(body, &req))
	info := &relaycommon.RelayInfo{
		OriginModelName: req.Model,
		ChannelMeta: &relaycommon.ChannelMeta{
			UpstreamModelName: req.Model,
		},
	}

	out, err := (&Adaptor{}).ConvertClaudeRequest(nil, info, &req)
	require.NoError(t, err)
	encoded, err := common.Marshal(out)
	require.NoError(t, err)

	var upstream map[string]any
	require.NoError(t, common.Unmarshal(encoded, &upstream))
	return upstream
}

func TestConvertClaudeRequestPreservesMessageOutputConfig(t *testing.T) {
	body := `{"model":"claude-opus-5-5","max_tokens":64,"output_config":{"effort":"medium"},"messages":[` +
		`{"role":"user","content":"summary"},` +
		`{"role":"system","content":[],"output_config":{"effort":"high"}},` +
		`{"role":"assistant","content":"done"}]}`

	upstream := convertNativeClaudeRequestForTest(t, body)

	assert.Equal(t, map[string]any{"effort": "medium"}, upstream["output_config"])
	messages, ok := upstream["messages"].([]any)
	require.True(t, ok)
	require.Len(t, messages, 3)
	assert.Equal(t, map[string]any{"effort": "high"}, messages[1].(map[string]any)["output_config"])
	assert.NotContains(t, messages[0], "output_config")
	assert.NotContains(t, messages[2], "output_config")
}

func TestConvertClaudeRequestPreservesSafeguards(t *testing.T) {
	withSafeguards := convertNativeClaudeRequestForTest(t,
		`{"model":"claude-opus-5-5","max_tokens":64,"safeguards":{"auto_mode":{"enabled":true}},"messages":[{"role":"user","content":"hi"}]}`)
	assert.Equal(t, map[string]any{"auto_mode": map[string]any{"enabled": true}}, withSafeguards["safeguards"])

	withoutSafeguards := convertNativeClaudeRequestForTest(t,
		`{"model":"claude-opus-5-5","max_tokens":64,"messages":[{"role":"user","content":"hi"}]}`)
	assert.NotContains(t, withoutSafeguards, "safeguards")
}
