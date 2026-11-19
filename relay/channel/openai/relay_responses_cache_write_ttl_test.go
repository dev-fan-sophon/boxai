package openai

import (
	"io"
	"net/http"
	"net/http/httptest"
	"strings"
	"testing"
	"time"

	"github.com/dev-fan-sophon/boxai/constant"
	"github.com/dev-fan-sophon/boxai/dto"
	relaycommon "github.com/dev-fan-sophon/boxai/relay/common"
	"github.com/dev-fan-sophon/boxai/types"
	"github.com/gin-gonic/gin"
	"github.com/stretchr/testify/assert"
	"github.com/stretchr/testify/require"
)

// The 12h cache-write split reaches billing from JSON, stream and compaction
// responses. The usage is the OpenAI prompt caching guide example.
func TestOaiResponsesHandlersKeepCacheWriteTTLSplit(t *testing.T) {
	gin.SetMode(gin.TestMode)
	oldTimeout := constant.StreamingTimeout
	constant.StreamingTimeout = 30
	t.Cleanup(func() { constant.StreamingTimeout = oldTimeout })

	const usageJSON = `"usage":{"input_tokens":12000,"output_tokens":0,"total_tokens":12000,"input_tokens_details":{"cached_tokens":4000,"cache_write_tokens":7000,"cache_write_tokens_details":{"ttl_30m_tokens":3000,"ttl_12h_tokens":4000}}}`
	const response = `{"id":"resp_1","object":"response","model":"gpt-6-astra","status":"completed","output":[],` + usageJSON + `}`
	for _, tt := range []struct {
		name, contentType, body string
	}{
		{"json", "application/json", response},
		{"stream", "text/event-stream", `data: {"type":"response.completed","response":` + response + "}\n\ndata: [DONE]\n\n"},
		{"compaction", "application/json", `{"id":"cmp_1","object":"response.compaction","output":[],` + usageJSON + `}`},
	} {
		t.Run(tt.name, func(t *testing.T) {
			c, _ := gin.CreateTestContext(httptest.NewRecorder())
			c.Request = httptest.NewRequest(http.MethodPost, "/v1/responses", nil)
			info := &relaycommon.RelayInfo{
				RelayFormat:     types.RelayFormatOpenAIResponses,
				OriginModelName: "gpt-6-astra",
				IsStream:        tt.name == "stream",
				DisablePing:     true,
				StartTime:       time.Now(),
				ChannelMeta:     &relaycommon.ChannelMeta{ChannelType: constant.ChannelTypeOpenAI, UpstreamModelName: "gpt-6-astra"},
			}
			resp := &http.Response{
				StatusCode: http.StatusOK,
				Body:       io.NopCloser(strings.NewReader(tt.body)),
				Header:     http.Header{"Content-Type": []string{tt.contentType}},
			}
			var usage *dto.Usage
			var apiErr *types.NewAPIError
			switch tt.name {
			case "json":
				usage, apiErr = OaiResponsesHandler(c, info, resp)
			case "stream":
				usage, apiErr = OaiResponsesStreamHandler(c, info, resp)
			default:
				usage, apiErr = OaiResponsesCompactionHandler(c, resp)
			}
			require.Nil(t, apiErr)
			require.NotNil(t, usage)
			assert.Equal(t, 12000, usage.PromptTokens)
			assert.Equal(t, 4000, usage.PromptTokensDetails.CachedTokens)
			assert.Equal(t, 7000, usage.PromptTokensDetails.CacheCreationTokensTotal())
			assert.Equal(t, 4000, usage.PromptTokensDetails.CacheWrite12hTokens())
		})
	}
}
