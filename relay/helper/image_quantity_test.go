package helper

import (
	"bytes"
	"mime/multipart"
	"net/http"
	"net/http/httptest"
	"testing"

	"github.com/dev-fan-sophon/boxai/common"
	"github.com/dev-fan-sophon/boxai/constant"
	relaycommon "github.com/dev-fan-sophon/boxai/relay/common"
	relayconstant "github.com/dev-fan-sophon/boxai/relay/constant"
	"github.com/dev-fan-sophon/boxai/setting/ratio_setting"
	"github.com/gin-gonic/gin"
	"github.com/stretchr/testify/assert"
	"github.com/stretchr/testify/require"
)

// Provider parameters.n is a billing multiplier on Ali; it must be validated
// at ingress (a 400 before any reservation), not inside the adaptor.
func TestImageRequestValidatesProviderCountBeforePricing(t *testing.T) {
	gin.SetMode(gin.TestMode)
	for _, tc := range []struct {
		body    string
		channel int
		count   int
		invalid bool
	}{
		{`{"model":"z-image","n":2,"parameters":{"n":3,"prompt_extend":true}}`, constant.ChannelTypeAli, 3, false},
		{`{"model":"gpt-image-2","n":2,"parameters":{"n":3}}`, constant.ChannelTypeOpenAI, 2, false},
		{`{"model":"z-image","n":2,"parameters":{"n":129}}`, constant.ChannelTypeAli, 0, true},
		{`{"model":"z-image","parameters":{"n":-1}}`, constant.ChannelTypeAli, 0, true},
		{`{"model":"z-image","n":2,"parameters":{}}`, constant.ChannelTypeAli, 2, false},
		{`{"model":"z-image","n":2,"parameters":{"n":null}}`, constant.ChannelTypeAli, 2, false},
		{`{"model":"z-image","n":2,"parameters":{"n":0}}`, constant.ChannelTypeAli, 0, true},
		{`{"model":"z-image","parameters":{"n":1.5}}`, constant.ChannelTypeAli, 0, true},
		{`{"model":"z-image","parameters":{"n":18446744073686646784}}`, constant.ChannelTypeAli, 0, true},
		{`{"model":"z-image","parameters":{"n":128}}`, constant.ChannelTypeAli, 128, false},
		{`{"model":"z-image","n":0}`, constant.ChannelTypeAli, 1, false},
		{`{"model":"gpt-image-2","n":2,"parameters":{"n":0}}`, constant.ChannelTypeOpenAI, 2, false},
	} {
		t.Run(tc.body, func(t *testing.T) {
			c, _ := gin.CreateTestContext(httptest.NewRecorder())
			c.Request = httptest.NewRequest(http.MethodPost, "/v1/images/generations", bytes.NewBufferString(tc.body))
			c.Request.Header.Set("Content-Type", "application/json")
			common.SetContextKey(c, constant.ContextKeyChannelType, tc.channel)
			request, err := GetAndValidOpenAIImageRequest(c, relayconstant.RelayModeImagesGenerations)
			if tc.invalid {
				require.Error(t, err)
				return
			}
			require.NoError(t, err)
			count, err := request.ImageCount(tc.channel == constant.ChannelTypeAli)
			require.NoError(t, err)
			assert.Equal(t, tc.count, count)
		})
	}
}

func TestImageEditMultipartParametersAreValidated(t *testing.T) {
	gin.SetMode(gin.TestMode)
	for _, tc := range []struct {
		parameters string
		count      int
		invalid    bool
	}{
		{parameters: `{"n":3,"prompt_extend":false}`, count: 3},
		{parameters: `{"n":0}`, invalid: true},
		{parameters: `{"n":200}`, invalid: true},
	} {
		t.Run(tc.parameters, func(t *testing.T) {
			var body bytes.Buffer
			writer := multipart.NewWriter(&body)
			require.NoError(t, writer.WriteField("model", "wan2.6-image"))
			require.NoError(t, writer.WriteField("prompt", "edit"))
			require.NoError(t, writer.WriteField("n", "2"))
			require.NoError(t, writer.WriteField("parameters", tc.parameters))
			part, err := writer.CreateFormFile("image", "input.png")
			require.NoError(t, err)
			_, err = part.Write([]byte("fixture image"))
			require.NoError(t, err)
			require.NoError(t, writer.Close())
			c, _ := gin.CreateTestContext(httptest.NewRecorder())
			c.Request = httptest.NewRequest(http.MethodPost, "/v1/images/edits", &body)
			c.Request.Header.Set("Content-Type", writer.FormDataContentType())
			common.SetContextKey(c, constant.ContextKeyChannelType, constant.ChannelTypeAli)
			request, err := GetAndValidOpenAIImageRequest(c, relayconstant.RelayModeImagesEdits)
			if tc.invalid {
				require.Error(t, err)
				return
			}
			require.NoError(t, err)
			count, err := request.ImageCount(true)
			require.NoError(t, err)
			assert.Equal(t, tc.count, count)
		})
	}
}

// The Ali pre-consume must reserve the provider quantity and the z-image
// prompt extension surcharge that settlement charges.
func TestModelPriceHelperReservesAliImageQuantity(t *testing.T) {
	gin.SetMode(gin.TestMode)
	saved := ratio_setting.ModelPrice2JSONString()
	require.NoError(t, ratio_setting.UpdateModelPriceByJSONString(`{"z-image":0.04}`))
	t.Cleanup(func() { require.NoError(t, ratio_setting.UpdateModelPriceByJSONString(saved)) })
	for _, tc := range []struct {
		name, body string
		channel    int
		count      int
		multiplier float64
	}{
		{"provider override", `{"model":"z-image","n":2,"parameters":{"n":4}}`, constant.ChannelTypeAli, 4, 1},
		{"empty parameters inherit top-level", `{"model":"z-image","n":2,"parameters":{}}`, constant.ChannelTypeAli, 2, 1},
		{"default count", `{"model":"z-image"}`, constant.ChannelTypeAli, 1, 1},
		{"prompt extension", `{"model":"z-image","parameters":{"n":3,"prompt_extend":true}}`, constant.ChannelTypeAli, 3, 2},
		{"non-Ali ignores provider count", `{"model":"z-image","n":2,"parameters":{"n":4,"prompt_extend":true}}`, constant.ChannelTypeOpenAI, 2, 1},
	} {
		t.Run(tc.name, func(t *testing.T) {
			c, _ := gin.CreateTestContext(httptest.NewRecorder())
			c.Request = httptest.NewRequest(http.MethodPost, "/v1/images/generations", bytes.NewBufferString(tc.body))
			c.Request.Header.Set("Content-Type", "application/json")
			common.SetContextKey(c, constant.ContextKeyChannelType, tc.channel)
			request, err := GetAndValidOpenAIImageRequest(c, relayconstant.RelayModeImagesGenerations)
			require.NoError(t, err)
			info := &relaycommon.RelayInfo{Request: request, OriginModelName: request.Model, UserGroup: "default", UsingGroup: "default"}
			price, err := ModelPriceHelper(c, info, 0, request.GetTokenCountMeta())
			require.NoError(t, err)
			assert.Equal(t, common.QuotaFromFloat(0.04*float64(tc.count)*tc.multiplier*common.QuotaPerUnit), price.QuotaToPreConsume)
		})
	}
}
