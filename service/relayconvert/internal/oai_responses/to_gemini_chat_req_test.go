package oairesponses

import (
	"fmt"
	"net/http/httptest"
	"strings"
	"testing"

	"github.com/dev-fan-sophon/boxai/common"
	"github.com/dev-fan-sophon/boxai/dto"
	relaycommon "github.com/dev-fan-sophon/boxai/relay/common"
	relaymedia "github.com/dev-fan-sophon/boxai/service/relayconvert/internal/media"
	"github.com/dev-fan-sophon/boxai/types"
	"github.com/gin-gonic/gin"
	"github.com/stretchr/testify/assert"
	"github.com/stretchr/testify/require"
)

func useDataURLMediaResolver(t *testing.T) {
	relaymedia.SetMediaResolver(relaymedia.MediaResolver{
		GetBase64Data: func(_ *gin.Context, source types.FileSource, _ ...string) (string, string, error) {
			metadata, data, ok := strings.Cut(source.GetRawData(), ",")
			if !ok || !strings.HasPrefix(metadata, "data:") {
				return "", "", fmt.Errorf("invalid data URL")
			}
			return data, strings.TrimSuffix(strings.TrimPrefix(metadata, "data:"), ";base64"), nil
		},
	})
	t.Cleanup(func() { relaymedia.SetMediaResolver(relaymedia.MediaResolver{}) })
}

func TestResponsesToolOutputMediaReachesGeminiAsInlineData(t *testing.T) {
	useDataURLMediaResolver(t)
	gin.SetMode(gin.TestMode)
	ctx, _ := gin.CreateTestContext(httptest.NewRecorder())
	input := []byte(`[
		{"type":"function_call","call_id":"a","name":"shot","arguments":"{}"},
		{"type":"function_call","call_id":"b","name":"note","arguments":"{}"},
		{"type":"function_call_output","call_id":"a","output":[{"type":"input_text","text":"screen"},{"type":"input_image","image_url":"data:image/png;base64,aGVsbG8="}]},
		{"type":"function_call_output","call_id":"b","output":"plain"}
	]`)

	tests := []struct {
		model string
		want  string
	}{
		{
			model: "gemini-3-pro",
			want: `[
				{"functionResponse":{"name":"shot","response":{"content":"screen"},"parts":[{"inlineData":{"mimeType":"image/png","data":"aGVsbG8="}}]}},
				{"functionResponse":{"name":"note","response":{"content":"plain"}}}
			]`,
		},
		{
			// Older models get the media after every function response of the turn.
			model: "gemini-2.5-flash",
			want: `[
				{"functionResponse":{"name":"shot","response":{"content":"screen"}}},
				{"functionResponse":{"name":"note","response":{"content":"plain"}}},
				{"inlineData":{"mimeType":"image/png","data":"aGVsbG8="}}
			]`,
		},
	}
	for _, tt := range tests {
		t.Run(tt.model, func(t *testing.T) {
			info := &relaycommon.RelayInfo{ChannelMeta: &relaycommon.ChannelMeta{UpstreamModelName: tt.model}}
			got, err := OpenAIResponsesRequestToGeminiChat(ctx, &dto.OpenAIResponsesRequest{Model: tt.model, Input: input}, info)
			require.NoError(t, err)
			require.Len(t, got.Contents, 2)
			assert.Equal(t, "user", got.Contents[1].Role)
			raw, err := common.Marshal(got.Contents[1].Parts)
			require.NoError(t, err)
			assert.JSONEq(t, tt.want, string(raw))
		})
	}
}

func TestResponsesToolOutputMediaGeminiRejectsUncarriedMedia(t *testing.T) {
	useDataURLMediaResolver(t)
	gin.SetMode(gin.TestMode)
	ctx, _ := gin.CreateTestContext(httptest.NewRecorder())
	input := []byte(`[
		{"type":"function_call","call_id":"a","name":"listen","arguments":"{}"},
		{"type":"function_call_output","call_id":"a","output":[{"type":"input_file","file_data":"data:application/zip;base64,UEs=","filename":"a.zip"}]}
	]`)
	info := &relaycommon.RelayInfo{ChannelMeta: &relaycommon.ChannelMeta{UpstreamModelName: "gemini-3-pro"}}
	_, err := OpenAIResponsesRequestToGeminiChat(ctx, &dto.OpenAIResponsesRequest{Model: "gemini-3-pro", Input: input}, info)
	require.Error(t, err)
}
