package oaichat

import (
	"fmt"
	"net/http/httptest"
	"strings"
	"testing"

	"github.com/QuantumNous/new-api/dto"
	relaymedia "github.com/QuantumNous/new-api/service/relayconvert/internal/media"
	"github.com/QuantumNous/new-api/types"
	"github.com/gin-gonic/gin"
	"github.com/stretchr/testify/assert"
	"github.com/stretchr/testify/require"
)

func TestOpenAIChatPDFFileConversion(t *testing.T) {
	relaymedia.SetMediaResolver(relaymedia.MediaResolver{
		GetBase64Data: func(_ *gin.Context, source types.FileSource, _ ...string) (string, string, error) {
			metadata, data, ok := strings.Cut(source.GetRawData(), ",")
			if !ok || !strings.HasPrefix(metadata, "data:") {
				return "", "", fmt.Errorf("invalid data URL")
			}
			mimeType := strings.TrimSuffix(strings.TrimPrefix(metadata, "data:"), ";base64")
			return data, mimeType, nil
		},
	})
	t.Cleanup(func() { relaymedia.SetMediaResolver(relaymedia.MediaResolver{}) })

	gin.SetMode(gin.TestMode)
	ctx, _ := gin.CreateTestContext(httptest.NewRecorder())
	request := dto.GeneralOpenAIRequest{
		Model: "test-model",
		Messages: []dto.Message{
			{
				Role: "user",
				Content: []any{
					map[string]any{
						"type": "file",
						"file": map[string]any{
							"filename":  "report.pdf",
							"file_data": "data:application/pdf;base64,JVBERi0xLjQK",
						},
					},
				},
			},
		},
	}

	t.Run("Claude document", func(t *testing.T) {
		converted, err := OpenAIChatRequestToClaudeMessages(ctx, request)
		require.NoError(t, err)
		require.Len(t, converted.Messages, 1)
		content, ok := converted.Messages[0].Content.([]dto.ClaudeMediaMessage)
		require.True(t, ok)
		require.Len(t, content, 1)
		assert.Equal(t, "document", content[0].Type)
		require.NotNil(t, content[0].Source)
		assert.Equal(t, "application/pdf", content[0].Source.MediaType)
		assert.Equal(t, "JVBERi0xLjQK", content[0].Source.Data)
	})

	t.Run("Gemini inline data", func(t *testing.T) {
		converted, err := OpenAIChatRequestToGeminiGenerateContent(ctx, request, nil)
		require.NoError(t, err)
		require.Len(t, converted.Contents, 1)
		require.Len(t, converted.Contents[0].Parts, 1)
		inlineData := converted.Contents[0].Parts[0].InlineData
		require.NotNil(t, inlineData)
		assert.Equal(t, "application/pdf", inlineData.MimeType)
		assert.Equal(t, "JVBERi0xLjQK", inlineData.Data)
	})
}
