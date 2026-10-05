package common

import (
	"io"
	"net/http"
	"net/http/httptest"
	"strings"
	"testing"

	"github.com/dev-fan-sophon/boxai/common"
	"github.com/dev-fan-sophon/boxai/constant"
	"github.com/gin-gonic/gin"
	"github.com/stretchr/testify/assert"
	"github.com/stretchr/testify/require"
)

func openCodeSessionFixture(t *testing.T, body string) (*gin.Context, *RelayInfo) {
	t.Helper()
	c, _ := gin.CreateTestContext(httptest.NewRecorder())
	c.Request = httptest.NewRequest(http.MethodPost, "/v1/chat/completions", strings.NewReader(body))
	c.Request.Header.Set("Content-Type", "application/json")
	common.SetContextKey(c, constant.ContextKeyChannelBaseUrl, "https://opencode.ai/zen/go")
	common.SetContextKey(c, constant.ContextKeyChannelType, constant.ChannelTypeAdvancedCustom)
	t.Cleanup(func() { common.CleanupBodyStorage(c) })
	return c, &RelayInfo{UserId: 17, TokenId: 23}
}

func TestOpenCodeSessionPreservesClientConversationHeaders(t *testing.T) {
	for _, header := range []string{"x-opencode-session", "x-session-affinity", "x-session-id", "session_id", "session-id", "x-claude-code-session-id"} {
		t.Run(header, func(t *testing.T) {
			c, info := openCodeSessionFixture(t, `{"prompt_cache_key":"lower-priority"}`)
			c.Request.Header.Set(header, "conversation-42")
			info.InitChannelMeta(c)
			assert.Equal(t, "conversation-42", c.GetHeader("x-opencode-session"))
			assert.Equal(t, "conversation-42", info.RequestHeaders["x-opencode-session"])
			c.Request.Header.Set("session-id", "another-conversation")
			info.InitChannelMeta(c)
			assert.Equal(t, "conversation-42", info.RequestHeaders["x-opencode-session"])
		})
	}
}

func TestOpenCodeSessionNormalizesBodySessionFormats(t *testing.T) {
	var expected string
	for _, body := range []string{
		`{"prompt_cache_key":"conversation-42"}`,
		`{"metadata":{"session_id":"conversation-42"}}`,
		`{"metadata":{"user_id":"{\"session_id\":\"conversation-42\",\"account_uuid\":\"private-account\"}"}}`,
		`{"metadata":{"user_id":"user_private_account_private_session_conversation-42"}}`,
	} {
		c, info := openCodeSessionFixture(t, body)
		info.InitChannelMeta(c)
		session := c.GetHeader("x-opencode-session")
		require.True(t, strings.HasPrefix(session, "boxai-"))
		assert.NotContains(t, session, "private")
		if expected == "" {
			expected = session
		}
		assert.Equal(t, expected, session)
	}
}

func TestOpenCodeSessionOpeningIsStableAndPrincipalScoped(t *testing.T) {
	opening := `{"messages":[{"role":"system","content":"system one"},{"role":"user","content":"Fix src/main.py"}]}`
	c, info := openCodeSessionFixture(t, opening)
	info.InitChannelMeta(c)
	want := c.GetHeader("x-opencode-session")
	require.NotEmpty(t, want)
	for _, tc := range []struct {
		name  string
		body  string
		user  int
		token int
		same  bool
	}{
		{"later turn", `{"messages":[{"role":"system","content":"changed system"},{"role":"user","content":"Fix src/main.py"},{"role":"assistant","content":"done"},{"role":"user","content":"Now add a test"}]}`, 17, 23, true},
		{"responses text", `{"input":"Fix src/main.py"}`, 17, 23, true},
		{"responses array", `{"input":[{"role":"user","content":"Fix src/main.py"}]}`, 17, 23, true},
		{"another opening", `{"input":"Fix src/other.py"}`, 17, 23, false},
		{"another user", opening, 18, 23, false},
		{"another credential", opening, 17, 24, false},
	} {
		t.Run(tc.name, func(t *testing.T) {
			c, info := openCodeSessionFixture(t, tc.body)
			info.UserId, info.TokenId = tc.user, tc.token
			info.InitChannelMeta(c)
			if tc.same {
				assert.Equal(t, want, c.GetHeader("x-opencode-session"))
			} else {
				assert.NotEqual(t, want, c.GetHeader("x-opencode-session"))
			}
		})
	}
}

func TestOpenCodeSessionRetryPreservesBodyAndPassesChannelGuard(t *testing.T) {
	body := `{"messages":[{"role":"user","content":[{"type":"text","text":"Fix this code"}]}]}`
	c, info := openCodeSessionFixture(t, body)
	common.SetContextKey(c, constant.ContextKeyChannelBaseUrl, "https://other.example/zen/go")
	info.InitChannelMeta(c)
	assert.Empty(t, c.GetHeader("x-opencode-session"))
	common.SetContextKey(c, constant.ContextKeyChannelBaseUrl, "https://opencode.ai/zen/go")
	info.InitChannelMeta(c)
	session := c.GetHeader("x-opencode-session")
	require.NotEmpty(t, session)
	info.InitChannelMeta(c)
	assert.Equal(t, session, info.RequestHeaders["x-opencode-session"])
	storage, err := common.GetBodyStorage(c)
	require.NoError(t, err)
	reader, err := storage.NewReader()
	require.NoError(t, err)
	defer reader.Close()
	replayed, err := io.ReadAll(reader)
	require.NoError(t, err)
	assert.Equal(t, body, string(replayed))

	var override map[string]interface{}
	require.NoError(t, common.UnmarshalJsonStr(`{"operations":[
		{"mode":"delete_header","path":"x-opencode-session"},
		{"mode":"copy_header","from":"x-opencode-session","to":"x-opencode-session","keep_origin":true},
		{"mode":"return_error","conditions":[{"path":"header_override.x-opencode-session","mode":"full","value":"","pass_missing_key":true}],"value":{"status_code":503,"code":"coding_session_required","message":"session required"}}
	]}`, &override))
	ctx := BuildParamOverrideContext(info)
	out, err := ApplyParamOverride([]byte(body), override, ctx)
	require.NoError(t, err)
	assert.JSONEq(t, body, string(out))
	assert.Equal(t, session, ctx["header_override"].(map[string]interface{})["x-opencode-session"])
}

func TestOpenCodeSessionDoesNotUseAccountIDAsConversation(t *testing.T) {
	c, info := openCodeSessionFixture(t, `{"metadata":{"user_id":"same-account"}}`)
	info.InitChannelMeta(c)
	assert.Empty(t, c.GetHeader("x-opencode-session"))
	c, info = openCodeSessionFixture(t, `{"input":"Fix this code"}`)
	info.UserId = 0
	info.InitChannelMeta(c)
	assert.Empty(t, c.GetHeader("x-opencode-session"))
}
