package openai

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
	relayconstant "github.com/dev-fan-sophon/boxai/relay/constant"
	"github.com/gin-gonic/gin"
	"github.com/stretchr/testify/assert"
	"github.com/stretchr/testify/require"
)

func geminiImageRelayInfo(mode int, request *dto.ImageRequest) *relaycommon.RelayInfo {
	return &relaycommon.RelayInfo{
		RelayMode: mode,
		Request:   request,
		ChannelMeta: &relaycommon.ChannelMeta{
			ChannelType:       constant.ChannelTypeOpenAI,
			ChannelBaseUrl:    "https://gateway.example",
			UpstreamModelName: request.Model,
		},
	}
}

func TestGeminiImageRequestBecomesChatCompletion(t *testing.T) {
	gin.SetMode(gin.TestMode)
	c, _ := gin.CreateTestContext(httptest.NewRecorder())
	c.Request = httptest.NewRequest(http.MethodPost, "/v1/images/edits", nil)
	c.Request.Header.Set("Content-Type", "application/json")
	images, err := common.Marshal([]string{"data:image/png;base64,AAAA", "https://example.com/b.png"})
	require.NoError(t, err)
	request := &dto.ImageRequest{Model: "gemini-3-pro-image", Prompt: "combine", Images: images, AspectRatio: "16:9", Resolution: "2K"}
	info := geminiImageRelayInfo(relayconstant.RelayModeImagesEdits, request)
	adaptor := &Adaptor{}

	url, err := adaptor.GetRequestURL(info)
	require.NoError(t, err)
	assert.Equal(t, "https://gateway.example/v1/chat/completions", url)

	converted, err := adaptor.ConvertImageRequest(c, info, *request)
	require.NoError(t, err)
	body, err := common.Marshal(converted)
	require.NoError(t, err)
	assert.JSONEq(t, `{
		"model":"gemini-3-pro-image",
		"messages":[{"role":"user","content":[
			{"type":"text","text":"combine"},
			{"type":"image_url","image_url":{"url":"data:image/png;base64,AAAA"}},
			{"type":"image_url","image_url":{"url":"https://example.com/b.png"}}
		]}],
		"modalities":["image","text"],
		"stream":false,
		"image_config":{"aspect_ratio":"16:9","image_size":"2K"}
	}`, string(body))

	header := http.Header{}
	require.NoError(t, adaptor.SetupRequestHeader(c, &header, info))
	assert.Equal(t, "application/json", header.Get("Content-Type"))
}

func TestExtractChatCompletionImages(t *testing.T) {
	tests := []struct {
		name   string
		body   string
		images []string
		text   string
	}{
		{
			name:   "openrouter message images",
			body:   `{"choices":[{"message":{"content":"here","images":[{"type":"image_url","image_url":{"url":"data:image/png;base64,QUJD"}}]}}]}`,
			images: []string{"data:image/png;base64,QUJD"},
			text:   "here",
		},
		{
			name:   "markdown data uri and url in text",
			body:   `{"choices":[{"message":{"content":"![image](data:image/jpeg;base64,WFla)\n![img](https://cdn.example/a.png)"}}]}`,
			images: []string{"data:image/jpeg;base64,WFla", "https://cdn.example/a.png"},
		},
		{
			name:   "image_url content parts",
			body:   `{"choices":[{"message":{"content":[{"type":"text","text":"done"},{"type":"image_url","image_url":{"url":"https://cdn.example/b.png"}}]}}]}`,
			images: []string{"https://cdn.example/b.png"},
			text:   "done",
		},
		{
			name: "refusal text without images",
			body: `{"choices":[{"message":{"content":"I can't draw that."}}]}`,
			text: "I can't draw that.",
		},
	}
	for _, tt := range tests {
		t.Run(tt.name, func(t *testing.T) {
			images, text, _, upstreamError, err := ExtractChatCompletionImages([]byte(tt.body))
			require.NoError(t, err)
			require.Nil(t, upstreamError)
			assert.Equal(t, tt.images, images)
			assert.Equal(t, tt.text, text)
		})
	}
}

func TestGeminiChatImageHandlerFloorsImageTokens(t *testing.T) {
	gin.SetMode(gin.TestMode)
	tests := []struct {
		name           string
		resolution     string
		reported       string
		wantCompletion int
	}{
		{name: "gateway omits image tokens", resolution: "4K", reported: `{"prompt_tokens":40,"completion_tokens":3,"total_tokens":43}`, wantCompletion: 2520},
		{name: "reported tokens above floor are kept", resolution: "1K", reported: `{"prompt_tokens":40,"completion_tokens":1500,"total_tokens":1540}`, wantCompletion: 1500},
	}
	for _, tt := range tests {
		t.Run(tt.name, func(t *testing.T) {
			recorder := httptest.NewRecorder()
			c, _ := gin.CreateTestContext(recorder)
			request := &dto.ImageRequest{Model: "gemini-3.1-flash-image", Prompt: "cat", Resolution: tt.resolution}
			info := geminiImageRelayInfo(relayconstant.RelayModeImagesGenerations, request)
			body := `{"choices":[{"message":{"content":"![image](data:image/png;base64,QUJD)"}}],"usage":` + tt.reported + `}`
			resp := &http.Response{StatusCode: http.StatusOK, Body: io.NopCloser(strings.NewReader(body))}

			usage, apiErr := GeminiChatImageHandler(c, info, resp)
			require.Nil(t, apiErr)
			require.NotNil(t, usage)
			assert.Equal(t, 40, usage.PromptTokens)
			assert.Equal(t, tt.wantCompletion, usage.CompletionTokens)
			assert.Equal(t, 40+tt.wantCompletion, usage.TotalTokens)

			var response dto.ImageResponse
			require.NoError(t, common.Unmarshal(recorder.Body.Bytes(), &response))
			require.Len(t, response.Data, 1)
			assert.Equal(t, "QUJD", response.Data[0].B64Json)
		})
	}

	t.Run("no image is a bad gateway without billing", func(t *testing.T) {
		recorder := httptest.NewRecorder()
		c, _ := gin.CreateTestContext(recorder)
		request := &dto.ImageRequest{Model: "gemini-3.1-flash-image", Prompt: "cat"}
		resp := &http.Response{StatusCode: http.StatusOK, Body: io.NopCloser(strings.NewReader(`{"choices":[{"message":{"content":"no"}}]}`))}
		usage, apiErr := GeminiChatImageHandler(c, geminiImageRelayInfo(relayconstant.RelayModeImagesGenerations, request), resp)
		require.Nil(t, usage)
		require.NotNil(t, apiErr)
		assert.Equal(t, http.StatusBadGateway, apiErr.StatusCode)
		assert.Empty(t, recorder.Body.String())
	})
}

func TestXAIImageModelOnOpenAICompatibleChannelUsesXAIBody(t *testing.T) {
	gin.SetMode(gin.TestMode)
	c, _ := gin.CreateTestContext(httptest.NewRecorder())
	c.Request = httptest.NewRequest(http.MethodPost, "/v1/images/edits", nil)
	c.Request.Header.Set("Content-Type", "application/json")
	images, err := common.Marshal([]string{"https://e/1.png", "https://e/2.png"})
	require.NoError(t, err)
	request := &dto.ImageRequest{Model: "grok-imagine-image-2.0", Prompt: "mix", Images: images, AspectRatio: "1:1"}
	converted, err := (&Adaptor{}).ConvertImageRequest(c, geminiImageRelayInfo(relayconstant.RelayModeImagesEdits, request), *request)
	require.NoError(t, err)
	body, err := common.Marshal(converted)
	require.NoError(t, err)
	assert.JSONEq(t, `{"model":"grok-imagine-image-2.0","prompt":"mix","aspect_ratio":"1:1","images":[{"url":"https://e/1.png","type":"image_url"},{"url":"https://e/2.png","type":"image_url"}]}`, string(body))
}

func TestResponsesImageEditForwardsJSONMask(t *testing.T) {
	gin.SetMode(gin.TestMode)
	c, _ := gin.CreateTestContext(httptest.NewRecorder())
	c.Request = httptest.NewRequest(http.MethodPost, "/v1/images/edits", nil)
	c.Request.Header.Set("Content-Type", "application/json")
	image, err := common.Marshal("data:image/png;base64,SU1H")
	require.NoError(t, err)
	mask, err := common.Marshal("data:image/png;base64,TUFTSw==")
	require.NoError(t, err)
	info := &relaycommon.RelayInfo{
		RelayMode:   relayconstant.RelayModeImagesEdits,
		ChannelMeta: &relaycommon.ChannelMeta{ChannelSetting: dto.ChannelSettings{ImageGenerationViaResponsesModel: "gpt-5.6-sol"}},
	}
	converted, err := ConvertImageEditViaResponses(c, info, dto.ImageRequest{Prompt: "paint", Image: image, Mask: mask})
	require.NoError(t, err)
	var tools []map[string]any
	require.NoError(t, common.Unmarshal(converted.Tools, &tools))
	require.Len(t, tools, 1)
	assert.Equal(t, map[string]any{"image_url": "data:image/png;base64,TUFTSw=="}, tools[0]["input_image_mask"])
}

func TestJSONImageEditWrapsStringMask(t *testing.T) {
	mask, err := common.Marshal("data:image/png;base64,TUFTSw==")
	require.NoError(t, err)
	request := dto.ImageRequest{Mask: mask}
	normalizeJSONImageEditReferences(&request)
	assert.JSONEq(t, `{"image_url":"data:image/png;base64,TUFTSw=="}`, string(request.Mask))
}
