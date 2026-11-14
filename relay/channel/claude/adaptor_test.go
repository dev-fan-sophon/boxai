package claude

import (
	"net/http"
	"net/http/httptest"
	"testing"

	"github.com/dev-fan-sophon/boxai/common"
	"github.com/dev-fan-sophon/boxai/dto"
	relaycommon "github.com/dev-fan-sophon/boxai/relay/common"
	"github.com/gin-gonic/gin"
	"github.com/stretchr/testify/assert"
	"github.com/stretchr/testify/require"
)

func TestSonnet5OmitsDeprecatedTemperature(t *testing.T) {
	for _, model := range []string{"claude-sonnet-5", "claude-sonnet-4-6"} {
		for _, native := range []bool{true, false} {
			c, _ := gin.CreateTestContext(httptest.NewRecorder())
			info := &relaycommon.RelayInfo{OriginModelName: model, ChannelMeta: &relaycommon.ChannelMeta{UpstreamModelName: model}}
			var converted any
			var err error
			if native {
				converted, err = (&Adaptor{}).ConvertClaudeRequest(c, info, &dto.ClaudeRequest{Model: model, Temperature: common.GetPointer(0.0)})
			} else {
				converted, err = (&Adaptor{}).ConvertOpenAIRequest(c, info, &dto.GeneralOpenAIRequest{Model: model, Temperature: common.GetPointer(0.0)})
			}
			require.NoError(t, err)
			encoded, err := common.Marshal(converted)
			require.NoError(t, err)
			var upstream map[string]any
			require.NoError(t, common.Unmarshal(encoded, &upstream))
			if model == "claude-sonnet-5" {
				assert.NotContains(t, upstream, "temperature")
			} else {
				assert.Equal(t, 0.0, upstream["temperature"], "preserve explicit zero on models that support sampling")
			}
		}
	}
}

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

func TestClaudeThinkingKeepsBlockBindingAndUnknownFields(t *testing.T) {
	body := `{"model":"claude-opus-5-5","max_tokens":1024,"thinking":{"type":"adaptive","display":"summarized","block_binding":{"prefix_mismatch_behavior":"drop_block"},"future_field":{"a":1}},"messages":[{"role":"user","content":"hi"}]}`
	var request dto.ClaudeRequest
	require.NoError(t, common.UnmarshalJsonStr(body, &request))
	copied, err := common.DeepCopy(&request)
	require.NoError(t, err)

	c, _ := gin.CreateTestContext(httptest.NewRecorder())
	info := &relaycommon.RelayInfo{OriginModelName: "claude-opus-5-5", ChannelMeta: &relaycommon.ChannelMeta{UpstreamModelName: "claude-opus-5-5"}}
	out, err := (&Adaptor{}).ConvertClaudeRequest(c, info, copied)
	require.NoError(t, err)
	encoded, err := common.Marshal(out)
	require.NoError(t, err)
	var upstream struct {
		Thinking any `json:"thinking"`
	}
	require.NoError(t, common.Unmarshal(encoded, &upstream))
	assert.Equal(t, map[string]any{
		"type":          "adaptive",
		"display":       "summarized",
		"block_binding": map[string]any{"prefix_mismatch_behavior": "drop_block"},
		"future_field":  map[string]any{"a": 1.0},
	}, upstream.Thinking)
}

func TestSetupRequestHeaderForwardsEveryAnthropicBetaValue(t *testing.T) {
	gin.SetMode(gin.TestMode)
	c, _ := gin.CreateTestContext(httptest.NewRecorder())
	c.Request = httptest.NewRequest(http.MethodPost, "/v1/messages", nil)
	c.Request.Header.Add("anthropic-beta", "fast-mode-2026-02-01")
	c.Request.Header.Add("anthropic-beta", "thinking-binding-controls-2026-08-01")
	info := &relaycommon.RelayInfo{
		OriginModelName: "claude-opus-5-5",
		ChannelMeta:     &relaycommon.ChannelMeta{ApiKey: "sk-test"},
	}

	header := http.Header{}
	require.NoError(t, (&Adaptor{}).SetupRequestHeader(c, &header, info))
	assert.Equal(t, []string{"fast-mode-2026-02-01,thinking-binding-controls-2026-08-01"}, header.Values("anthropic-beta"))
}
