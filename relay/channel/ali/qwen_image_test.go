package ali

import (
	"io"
	"net/http"
	"net/http/httptest"
	"strings"
	"testing"
	"time"

	"github.com/dev-fan-sophon/boxai/common"
	"github.com/dev-fan-sophon/boxai/constant"
	"github.com/dev-fan-sophon/boxai/dto"
	relaycommon "github.com/dev-fan-sophon/boxai/relay/common"
	relayconstant "github.com/dev-fan-sophon/boxai/relay/constant"
	"github.com/gin-gonic/gin"
	"github.com/stretchr/testify/assert"
	"github.com/stretchr/testify/require"
	"github.com/tidwall/gjson"
)

func TestQwenTurboRecordedImageContract(t *testing.T) {
	gin.SetMode(gin.TestMode)
	recorder := httptest.NewRecorder()
	c, _ := gin.CreateTestContext(recorder)
	c.Request = httptest.NewRequest(http.MethodPost, "/v1/images/generations", nil)
	c.Request.Header.Set("Content-Type", "application/json")
	c.Set("response_format", "url")
	request := dto.ImageRequest{Model: "qwen-image-2.1-turbo", Prompt: "a blue ceramic cup", Size: "1024x1024", N: common.GetPointer(uint(1))}
	info := &relaycommon.RelayInfo{
		RelayMode: relayconstant.RelayModeImagesGenerations, OriginModelName: request.Model,
		StartTime: time.Unix(1795604850, 0), Request: &request,
		ChannelMeta: &relaycommon.ChannelMeta{
			ChannelType: constant.ChannelTypeAli, UpstreamModelName: request.Model,
			ChannelBaseUrl: "https://api.ppio.com/v3/aliyun", ApiKey: "fixture-key",
		},
	}
	adaptor := &Adaptor{}
	url, err := adaptor.GetRequestURL(info)
	require.NoError(t, err)
	assert.Equal(t, "https://api.ppio.com/v3/aliyun/api/v1/services/aigc/multimodal-generation/generation", url)
	header := http.Header{}
	require.NoError(t, adaptor.SetupRequestHeader(c, &header, info))
	assert.Equal(t, "Bearer fixture-key", header.Get("Authorization"))
	assert.Empty(t, header.Get("X-DashScope-Async"))
	converted, err := adaptor.ConvertImageRequest(c, info, request)
	require.NoError(t, err)
	body, err := common.Marshal(converted)
	require.NoError(t, err)
	assert.JSONEq(t, `{"model":"qwen-image-2.1-turbo","input":{"messages":[{"role":"user","content":[{"text":"a blue ceramic cup"}]}]},"parameters":{"size":"1024*1024","n":1,"prompt_extend":false}}`, string(body))

	// Recorded 2026-11-25 response with only the signed media URL replaced.
	const response = `{"request_id":"48ceff86-3804-9f27-acdd-53af9ef8ae2f","output":{"choices":[{"message":{"content":[{"type":"image","image":"https://example.com/qwen.png"}],"role":"assistant"},"finish_reason":"stop"}],"rewrite_status":"not_use"},"usage":{"width":1024,"height":1024,"image_count":1}}`
	_, apiErr := adaptor.DoResponse(c, &http.Response{StatusCode: http.StatusOK, Header: http.Header{}, Body: io.NopCloser(strings.NewReader(response))}, info)
	require.Nil(t, apiErr)
	assert.Equal(t, "https://example.com/qwen.png", gjson.Get(recorder.Body.String(), "data.0.url").String())
	assert.Equal(t, int64(1795604850), gjson.Get(recorder.Body.String(), "created").Int())
	assert.Equal(t, float64(1), info.PriceData.OtherRatios()["n"])

	info.RelayMode = relayconstant.RelayModeImagesEdits
	_, err = adaptor.ConvertImageRequest(c, info, request)
	require.ErrorContains(t, err, "only supports image generation")
}
