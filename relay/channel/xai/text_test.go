package xai

import (
	"io"
	"net/http"
	"net/http/httptest"
	"strings"
	"testing"

	"github.com/dev-fan-sophon/boxai/constant"
	relaycommon "github.com/dev-fan-sophon/boxai/relay/common"
	"github.com/dev-fan-sophon/boxai/types"
	"github.com/gin-gonic/gin"
	"github.com/stretchr/testify/assert"
	"github.com/stretchr/testify/require"
)

// Streaming grok usage must keep the cached prompt and reasoning details so
// cache pricing applies the same way as on the non-stream path.
func TestXAIStreamHandlerPreservesUsageTokenDetails(t *testing.T) {
	gin.SetMode(gin.TestMode)
	previousTimeout := constant.StreamingTimeout
	constant.StreamingTimeout = 30
	t.Cleanup(func() { constant.StreamingTimeout = previousTimeout })

	c, _ := gin.CreateTestContext(httptest.NewRecorder())
	c.Request = httptest.NewRequest(http.MethodPost, "/v1/chat/completions", nil)
	body := "data: {\"id\":\"1\",\"object\":\"chat.completion.chunk\",\"model\":\"grok-4\",\"choices\":[{\"index\":0,\"delta\":{\"content\":\"hi\"}}]}\n\n" +
		"data: {\"id\":\"1\",\"object\":\"chat.completion.chunk\",\"model\":\"grok-4\",\"choices\":[],\"usage\":{\"prompt_tokens\":100,\"completion_tokens\":5,\"total_tokens\":130,\"prompt_tokens_details\":{\"cached_tokens\":64},\"completion_tokens_details\":{\"reasoning_tokens\":25}}}\n\n" +
		"data: [DONE]\n\n"
	info := &relaycommon.RelayInfo{RelayFormat: types.RelayFormatOpenAI, ChannelMeta: &relaycommon.ChannelMeta{UpstreamModelName: "grok-4"}, DisablePing: true}

	usage, apiErr := xAIStreamHandler(c, info, &http.Response{Body: io.NopCloser(strings.NewReader(body)), Header: make(http.Header)})

	require.Nil(t, apiErr)
	require.NotNil(t, usage)
	assert.Equal(t, 100, usage.PromptTokens)
	assert.Equal(t, 30, usage.CompletionTokens)
	assert.Equal(t, 64, usage.PromptTokensDetails.CachedTokens)
	assert.Equal(t, 25, usage.CompletionTokenDetails.ReasoningTokens)
}
