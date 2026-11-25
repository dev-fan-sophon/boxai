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

func TestNativeArkImageRecordedContract(t *testing.T) {
	gin.SetMode(gin.TestMode)
	recorder := httptest.NewRecorder()
	c, _ := gin.CreateTestContext(recorder)
	c.Request = httptest.NewRequest(http.MethodPost, "/v1/images/generations", nil)
	c.Request.Header.Set("Content-Type", "application/json")
	request := dto.ImageRequest{
		Model: "doubao-seedream-5-0-flash-260915", Prompt: "a blue ceramic cup",
		Size: "1024x1024", N: common.GetPointer(uint(1)), ResponseFormat: "url", Watermark: common.GetPointer(false),
	}
	info := &relaycommon.RelayInfo{
		RelayMode: relayconstant.RelayModeImagesGenerations, RequestURLPath: "/v1/images/generations",
		Request: &request, OriginModelName: request.Model,
		ChannelMeta: &relaycommon.ChannelMeta{
			ChannelType: constant.ChannelTypeCustom, UpstreamModelName: request.Model, ApiKey: "fixture-key",
			ChannelBaseUrl: "https://api.ppio.com/v3/bytedance-cn/api/v3/images/generations",
		},
	}
	adaptor := &Adaptor{}
	url, err := adaptor.GetRequestURL(info)
	require.NoError(t, err)
	assert.Equal(t, "https://api.ppio.com/v3/bytedance-cn/api/v3/images/generations", url)
	header := http.Header{}
	require.NoError(t, adaptor.SetupRequestHeader(c, &header, info))
	assert.Equal(t, "Bearer fixture-key", header.Get("Authorization"))
	converted, err := adaptor.ConvertImageRequest(c, info, request)
	require.NoError(t, err)
	body, err := common.Marshal(converted)
	require.NoError(t, err)
	assert.JSONEq(t, `{"model":"doubao-seedream-5-0-flash-260915","prompt":"a blue ceramic cup","size":"1024x1024","response_format":"url","watermark":false}`, string(body))
	assert.Equal(t, uint(1), *request.N, "reservation quantity is unchanged")
	request.Size = "1K"
	converted, err = adaptor.ConvertImageRequest(c, info, request)
	require.NoError(t, err)
	body, err = common.Marshal(converted)
	require.NoError(t, err)
	assert.Contains(t, string(body), `"size":"1024x1024"`, "the 1K alias must not allow automatic aspect ratios")

	// Recorded 2026-11-25 response; only the expiring signed URL is replaced.
	const response = `{"model":"doubao-seedream-5-0-flash-260915","created":1795604858,"data":[{"url":"https://example.com/seedream.jpg","size":"1024x1024","output_format":"jpeg","background":"opaque"}],"usage":{"input_images":0,"generated_images":1,"output_tokens":4096,"total_tokens":4096}}`
	info.PriceData.UsePrice = true
	_, apiErr := adaptor.DoResponse(c, &http.Response{StatusCode: http.StatusOK, Header: http.Header{}, Body: io.NopCloser(strings.NewReader(response))}, info)
	require.Nil(t, apiErr)
	assert.JSONEq(t, response, recorder.Body.String())
	assert.Equal(t, float64(1), info.PriceData.OtherRatios()["n"])

	info.RelayMode = relayconstant.RelayModeImagesEdits
	_, err = adaptor.ConvertImageRequest(c, info, request)
	require.ErrorContains(t, err, "only supports image generation")
}
