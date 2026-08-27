package openai

import (
	"bytes"
	"encoding/base64"
	"image"
	"image/color"
	"image/png"
	"io"
	"mime/multipart"
	"net/http"
	"net/http/httptest"
	"testing"

	"github.com/dev-fan-sophon/boxai/common"
	"github.com/dev-fan-sophon/boxai/dto"
	relaycommon "github.com/dev-fan-sophon/boxai/relay/common"
	relayconstant "github.com/dev-fan-sophon/boxai/relay/constant"

	"github.com/gin-gonic/gin"
	"github.com/stretchr/testify/require"
)

func testResponsesPNGBase64(t *testing.T) string {
	t.Helper()
	imageData := image.NewRGBA(image.Rect(0, 0, 2, 3))
	imageData.Set(0, 0, color.RGBA{B: 255, A: 255})
	var encoded bytes.Buffer
	require.NoError(t, png.Encode(&encoded, imageData))
	return base64.StdEncoding.EncodeToString(encoded.Bytes())
}

func TestImageEditViaResponsesConvertsMultipartImageAndMask(t *testing.T) {
	gin.SetMode(gin.TestMode)
	var body bytes.Buffer
	writer := multipart.NewWriter(&body)
	imagePart, err := writer.CreateFormFile("image", "source.png")
	require.NoError(t, err)
	_, err = imagePart.Write([]byte("source-image"))
	require.NoError(t, err)
	maskPart, err := writer.CreateFormFile("mask", "mask.png")
	require.NoError(t, err)
	_, err = maskPart.Write([]byte("image-mask"))
	require.NoError(t, err)
	require.NoError(t, writer.Close())

	c, _ := gin.CreateTestContext(httptest.NewRecorder())
	c.Request = httptest.NewRequest(http.MethodPost, "/v1/images/edits", bytes.NewReader(body.Bytes()))
	c.Request.Header.Set("Content-Type", writer.FormDataContentType())
	t.Cleanup(func() { common.CleanupBodyStorage(c) })
	info := &relaycommon.RelayInfo{
		RelayMode: relayconstant.RelayModeImagesEdits,
		ChannelMeta: &relaycommon.ChannelMeta{
			ChannelSetting: dto.ChannelSettings{ImageGenerationViaResponsesModel: "gpt-5.6-sol"},
		},
	}

	converted, err := ConvertImageEditViaResponses(c, info, dto.ImageRequest{Prompt: "make it red"})
	require.NoError(t, err)
	var input []map[string]any
	require.NoError(t, common.Unmarshal(converted.Input, &input))
	content := input[0]["content"].([]any)
	require.Equal(t, map[string]any{"type": "input_text", "text": "make it red"}, content[0])
	require.Equal(t, "input_image", content[1].(map[string]any)["type"])
	require.Contains(t, content[1].(map[string]any)["image_url"], ";base64,")
	var tools []map[string]any
	require.NoError(t, common.Unmarshal(converted.Tools, &tools))
	require.Equal(t, "edit", tools[0]["action"])
	require.Contains(t, tools[0]["input_image_mask"].(map[string]any)["image_url"], ";base64,")
}

func TestResponsesImageHandlersUseToolUsageForJSONAndSSE(t *testing.T) {
	gin.SetMode(gin.TestMode)
	imageBase64 := testResponsesPNGBase64(t)
	response := dto.OpenAIResponsesResponse{
		CreatedAt: 1710000000,
		Output: []dto.ResponsesOutput{{
			Type: dto.ResponsesOutputTypeImageGenerationCall, Result: imageBase64, RevisedPrompt: "blue square",
		}},
		Usage: &dto.Usage{InputTokens: 999, OutputTokens: 999, TotalTokens: 1998},
		ToolUsage: &dto.ResponsesToolUsage{ImageGeneration: &dto.Usage{
			InputTokens: 41, OutputTokens: 229, TotalTokens: 270,
		}},
	}
	jsonBody, err := common.Marshal(response)
	require.NoError(t, err)

	t.Run("JSON", func(t *testing.T) {
		c, recorder, resp, info := newImageTestContext(t, string(jsonBody), "application/json", false)
		usage, apiErr := OpenaiResponsesImageHandler(c, info, resp)
		require.Nil(t, apiErr)
		require.Equal(t, 41, usage.PromptTokens)
		require.Equal(t, 229, usage.CompletionTokens)
		require.Equal(t, 270, usage.TotalTokens)
		var got dto.ImageResponse
		require.NoError(t, common.Unmarshal(recorder.Body.Bytes(), &got))
		require.Equal(t, imageBase64, got.Data[0].B64Json)
		require.Equal(t, "blue square", got.Data[0].RevisedPrompt)
		require.NotNil(t, got.Usage)
		require.Equal(t, 270, got.Usage.TotalTokens)
	})

	t.Run("SSE", func(t *testing.T) {
		item, err := common.Marshal(dto.ResponsesStreamResponse{
			Type: dto.ResponsesOutputTypeItemDone,
			Item: &dto.ResponsesOutput{
				Type: dto.ResponsesOutputTypeImageGenerationCall, Result: imageBase64, RevisedPrompt: "streamed fox",
			},
		})
		require.NoError(t, err)
		completed, err := common.Marshal(dto.ResponsesStreamResponse{
			Type: "response.completed",
			Response: &dto.OpenAIResponsesResponse{
				CreatedAt: 1710000001,
				ToolUsage: &dto.ResponsesToolUsage{ImageGeneration: &dto.Usage{
					InputTokens: 7, OutputTokens: 11, TotalTokens: 18,
				}},
			},
		})
		require.NoError(t, err)
		body := "data: " + string(item) + "\n\ndata: " + string(completed) + "\n\ndata: [DONE]\n\n"
		c, recorder, resp, info := newImageTestContext(t, body, "text/event-stream", false)
		usage, apiErr := OpenaiResponsesStreamImageHandler(c, info, resp)
		require.Nil(t, apiErr)
		require.Equal(t, 18, usage.TotalTokens)
		var got dto.ImageResponse
		require.NoError(t, common.Unmarshal(recorder.Body.Bytes(), &got))
		require.Equal(t, "streamed fox", got.Data[0].RevisedPrompt)
		require.Equal(t, imageBase64, got.Data[0].B64Json)
	})
}

func TestResponsesImageHandlerRejectsMissingImageUsage(t *testing.T) {
	body, err := common.Marshal(dto.OpenAIResponsesResponse{
		Output: []dto.ResponsesOutput{{
			Type: dto.ResponsesOutputTypeImageGenerationCall, Result: testResponsesPNGBase64(t),
		}},
	})
	require.NoError(t, err)
	recorder := httptest.NewRecorder()
	c, _ := gin.CreateTestContext(recorder)
	c.Request = httptest.NewRequest(http.MethodPost, "/v1/images/generations", nil)
	resp := &http.Response{StatusCode: http.StatusOK, Header: http.Header{}, Body: io.NopCloser(bytes.NewReader(body))}

	usage, apiErr := OpenaiResponsesImageHandler(c, &relaycommon.RelayInfo{ChannelMeta: &relaycommon.ChannelMeta{}}, resp)
	require.Nil(t, usage)
	require.NotNil(t, apiErr)
	require.ErrorContains(t, apiErr, "no image generation usage")
	require.Empty(t, recorder.Body.String())
}
