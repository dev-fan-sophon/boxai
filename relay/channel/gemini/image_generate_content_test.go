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
	relayconstant "github.com/dev-fan-sophon/boxai/relay/constant"
	"github.com/gin-gonic/gin"
	"github.com/stretchr/testify/assert"
	"github.com/stretchr/testify/require"
)

func nativeImageInfo(mode int, model string) *relaycommon.RelayInfo {
	return &relaycommon.RelayInfo{
		RelayMode: mode,
		ChannelMeta: &relaycommon.ChannelMeta{
			ChannelType:       constant.ChannelTypeGemini,
			ChannelBaseUrl:    "https://generativelanguage.googleapis.com",
			UpstreamModelName: model,
		},
	}
}

func TestGeminiImageRequestBecomesGenerateContent(t *testing.T) {
	gin.SetMode(gin.TestMode)
	c, _ := gin.CreateTestContext(httptest.NewRecorder())
	c.Request = httptest.NewRequest(http.MethodPost, "/v1/images/edits", nil)
	c.Request.Header.Set("Content-Type", "application/json")
	images, err := common.Marshal([]string{"data:image/png;base64,QUFB", "data:image/jpeg;base64,QkJC"})
	require.NoError(t, err)
	info := nativeImageInfo(relayconstant.RelayModeImagesEdits, "gemini-3.1-flash-image")
	adaptor := &Adaptor{}

	converted, err := adaptor.ConvertImageRequest(c, info, dto.ImageRequest{Model: "gemini-3.1-flash-image", Prompt: "blend", Images: images, AspectRatio: "4:5", Resolution: "2K"})
	require.NoError(t, err)
	body, err := common.Marshal(converted)
	require.NoError(t, err)
	assert.JSONEq(t, `{
		"contents":[{"role":"user","parts":[
			{"text":"blend"},
			{"inlineData":{"mimeType":"image/png","data":"QUFB"}},
			{"inlineData":{"mimeType":"image/jpeg","data":"QkJC"}}
		]}],
		"generationConfig":{"responseModalities":["TEXT","IMAGE"],"imageConfig":{"aspectRatio":"4:5","imageSize":"2K"}}
	}`, string(body))

	url, err := adaptor.GetRequestURL(info)
	require.NoError(t, err)
	assert.True(t, strings.HasSuffix(url, "/models/gemini-3.1-flash-image:generateContent"), url)
}

func TestGeminiImageGenerateContentHandler(t *testing.T) {
	gin.SetMode(gin.TestMode)
	recorder := httptest.NewRecorder()
	c, _ := gin.CreateTestContext(recorder)
	body := `{"candidates":[{"content":{"role":"model","parts":[{"text":"Here you go"},{"inlineData":{"mimeType":"image/png","data":"SU1H"}}]}}],
		"usageMetadata":{"promptTokenCount":12,"candidatesTokenCount":1120,"totalTokenCount":1132}}`
	resp := &http.Response{StatusCode: http.StatusOK, Body: io.NopCloser(strings.NewReader(body))}

	usage, apiErr := GeminiImageGenerateContentHandler(c, nativeImageInfo(relayconstant.RelayModeImagesGenerations, "gemini-3-pro-image"), resp)
	require.Nil(t, apiErr)
	require.NotNil(t, usage)
	assert.Equal(t, 12, usage.PromptTokens)
	assert.Equal(t, 1120, usage.CompletionTokens)

	var response dto.ImageResponse
	require.NoError(t, common.Unmarshal(recorder.Body.Bytes(), &response))
	require.Len(t, response.Data, 1)
	assert.Equal(t, "SU1H", response.Data[0].B64Json)
}
