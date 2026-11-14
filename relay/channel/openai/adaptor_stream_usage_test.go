package openai

import (
	"net/http"
	"net/http/httptest"
	"testing"

	"github.com/dev-fan-sophon/boxai/constant"
	"github.com/dev-fan-sophon/boxai/dto"
	relaycommon "github.com/dev-fan-sophon/boxai/relay/common"
	relayconstant "github.com/dev-fan-sophon/boxai/relay/constant"
	"github.com/dev-fan-sophon/boxai/types"
	"github.com/gin-gonic/gin"
	"github.com/stretchr/testify/assert"
	"github.com/stretchr/testify/require"
)

// A Gemini request converted to OpenAI chat must ask a streaming upstream for
// usage, because the Gemini response never carries stream_options itself.
func TestConvertGeminiRequestRequestsStreamUsage(t *testing.T) {
	for _, tc := range []struct {
		name         string
		isStream     bool
		supportUsage bool
		wantUsage    bool
	}{
		{"stream with stream options support", true, true, true},
		{"non-stream", false, true, false},
		{"stream without stream options support", true, false, false},
	} {
		t.Run(tc.name, func(t *testing.T) {
			gin.SetMode(gin.TestMode)
			c, _ := gin.CreateTestContext(httptest.NewRecorder())
			c.Request = httptest.NewRequest(http.MethodPost, "/v1beta/models/gpt-test:streamGenerateContent", nil)
			info := &relaycommon.RelayInfo{
				RelayFormat:     types.RelayFormatGemini,
				RelayMode:       relayconstant.RelayModeGemini,
				RequestURLPath:  "/v1beta/models/gpt-test:streamGenerateContent",
				OriginModelName: "gpt-test",
				IsStream:        tc.isStream,
				ChannelMeta: &relaycommon.ChannelMeta{
					ChannelType:          constant.ChannelTypeOpenAI,
					UpstreamModelName:    "gpt-test",
					SupportStreamOptions: tc.supportUsage,
				},
			}
			request := &dto.GeminiChatRequest{
				Contents: []dto.GeminiChatContent{{Role: "user", Parts: []dto.GeminiPart{{Text: "hello"}}}},
			}

			converted, err := (&Adaptor{}).ConvertGeminiRequest(c, info, request)
			require.NoError(t, err)
			chatRequest, ok := converted.(*dto.GeneralOpenAIRequest)
			require.True(t, ok)
			if !tc.wantUsage {
				assert.Nil(t, chatRequest.StreamOptions)
				return
			}
			require.NotNil(t, chatRequest.StreamOptions)
			assert.True(t, chatRequest.StreamOptions.IncludeUsage)
		})
	}
}
