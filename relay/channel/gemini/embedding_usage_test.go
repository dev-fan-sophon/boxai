package gemini

import (
	"io"
	"net/http"
	"net/http/httptest"
	"strings"
	"testing"

	"github.com/dev-fan-sophon/boxai/common"
	"github.com/dev-fan-sophon/boxai/constant"
	"github.com/dev-fan-sophon/boxai/dto"
	relaycommon "github.com/dev-fan-sophon/boxai/relay/common"
	"github.com/dev-fan-sophon/boxai/types"
	"github.com/gin-gonic/gin"
	"github.com/stretchr/testify/assert"
	"github.com/stretchr/testify/require"
)

// Embedding settlement must bill the upstream usageMetadata when present and
// fall back to the local prompt estimate only when it is missing or empty.
func TestGeminiEmbeddingHandlersBillUpstreamUsageMetadata(t *testing.T) {
	gin.SetMode(gin.TestMode)
	handlers := []struct {
		name   string
		batch  bool
		native bool
	}{
		{name: "openai-compatible", batch: true},
		{name: "native single", native: true},
		{name: "native batch", batch: true, native: true},
	}
	bodies := []struct {
		name          string
		usageMetadata string
		wantPrompt    int
		wantLocal     bool
	}{
		{name: "upstream usage", usageMetadata: `,"usageMetadata":{"promptTokenCount":37,"promptTokenDetails":[{"modality":"TEXT","tokenCount":37}]}`, wantPrompt: 37},
		{name: "missing usage", wantPrompt: 12, wantLocal: true},
		{name: "zero usage", usageMetadata: `,"usageMetadata":{"promptTokenCount":0}`, wantPrompt: 12, wantLocal: true},
	}
	for _, handler := range handlers {
		for _, body := range bodies {
			t.Run(handler.name+"/"+body.name, func(t *testing.T) {
				c, _ := gin.CreateTestContext(httptest.NewRecorder())
				c.Request = httptest.NewRequest(http.MethodPost, "/v1/embeddings", nil)
				info := &relaycommon.RelayInfo{
					RelayFormat:            types.RelayFormatGemini,
					IsGeminiBatchEmbedding: handler.batch,
					ChannelMeta:            &relaycommon.ChannelMeta{UpstreamModelName: "gemini-embedding-001"},
				}
				info.SetEstimatePromptTokens(12)
				payload := `{"embedding":{"values":[0.1]}` + body.usageMetadata + `}`
				if handler.batch {
					payload = `{"embeddings":[{"values":[0.1]}]` + body.usageMetadata + `}`
				}
				resp := &http.Response{Body: io.NopCloser(strings.NewReader(payload)), Header: http.Header{}}

				var usage *dto.Usage
				var apiErr *types.NewAPIError
				if handler.native {
					usage, apiErr = NativeGeminiEmbeddingHandler(c, resp, info)
				} else {
					usage, apiErr = GeminiEmbeddingHandler(c, info, resp)
				}
				require.Nil(t, apiErr)
				require.NotNil(t, usage)
				assert.Equal(t, body.wantPrompt, usage.PromptTokens)
				assert.Zero(t, usage.CompletionTokens)
				assert.Equal(t, body.wantPrompt, usage.TotalTokens)
				assert.Equal(t, body.wantLocal, common.GetContextKeyBool(c, constant.ContextKeyLocalCountTokens))
			})
		}
	}
}
