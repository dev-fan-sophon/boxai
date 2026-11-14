package ali

import (
	"bytes"
	"encoding/json"
	"io"
	"mime/multipart"
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
	relayhelper "github.com/dev-fan-sophon/boxai/relay/helper"
	"github.com/gin-gonic/gin"
	"github.com/stretchr/testify/assert"
	"github.com/stretchr/testify/require"
	"github.com/tidwall/gjson"
)

func TestAliMultipartEditsUseValidatedProviderQuantity(t *testing.T) {
	gin.SetMode(gin.TestMode)
	for _, tc := range []struct {
		name    string
		convert func(*gin.Context, *relaycommon.RelayInfo, dto.ImageRequest) (*AliImageRequest, error)
	}{
		{"multimodal edit", oaiFormEdit2AliImageEdit},
		{"legacy Wan edit", oaiFormEdit2WanxImageEdit},
	} {
		t.Run(tc.name, func(t *testing.T) {
			var body bytes.Buffer
			writer := multipart.NewWriter(&body)
			require.NoError(t, writer.WriteField("model", "fixture-image"))
			require.NoError(t, writer.WriteField("n", "2"))
			require.NoError(t, writer.WriteField("parameters", `{"n":3,"prompt_extend":false}`))
			part, err := writer.CreateFormFile("image", "input.png")
			require.NoError(t, err)
			_, err = part.Write([]byte("fixture image"))
			require.NoError(t, err)
			require.NoError(t, writer.Close())
			c, _ := gin.CreateTestContext(httptest.NewRecorder())
			c.Request = httptest.NewRequest(http.MethodPost, "/v1/images/edits", &body)
			c.Request.Header.Set("Content-Type", writer.FormDataContentType())
			common.SetContextKey(c, constant.ContextKeyChannelType, constant.ChannelTypeAli)
			request, err := relayhelper.GetAndValidOpenAIImageRequest(c, relayconstant.RelayModeImagesEdits)
			require.NoError(t, err)
			info := &relaycommon.RelayInfo{Request: request}
			converted, err := tc.convert(c, info, *request)
			require.NoError(t, err)
			require.NotNil(t, converted.Parameters.N)
			assert.Equal(t, uint(3), *converted.Parameters.N)
			require.NotNil(t, converted.Parameters.PromptExtend)
			assert.False(t, *converted.Parameters.PromptExtend)
			assert.Equal(t, uint(2), *request.N, "conversion must preserve the incoming request")
		})
	}
}

func TestAliImageConversionSendsReservedQuantity(t *testing.T) {
	gin.SetMode(gin.TestMode)
	for _, tc := range []struct {
		name, body string
		count      int
		extend     float64
	}{
		{"provider override", `{"model":"z-image","n":2,"parameters":{"n":4}}`, 4, 0},
		{"empty parameters inherit top-level", `{"model":"z-image","n":2,"parameters":{}}`, 2, 0},
		{"null count inherits top-level", `{"model":"z-image","n":2,"parameters":{"n":null}}`, 2, 0},
		{"default count", `{"model":"z-image"}`, 1, 0},
		{"prompt extension", `{"model":"z-image","parameters":{"n":3,"prompt_extend":true}}`, 3, 2},
	} {
		t.Run(tc.name, func(t *testing.T) {
			c, _ := gin.CreateTestContext(httptest.NewRecorder())
			c.Request = httptest.NewRequest(http.MethodPost, "/v1/images/generations", strings.NewReader(tc.body))
			c.Request.Header.Set("Content-Type", "application/json")
			common.SetContextKey(c, constant.ContextKeyChannelType, constant.ChannelTypeAli)
			request, err := relayhelper.GetAndValidOpenAIImageRequest(c, relayconstant.RelayModeImagesGenerations)
			require.NoError(t, err)
			info := &relaycommon.RelayInfo{Request: request, ChannelMeta: &relaycommon.ChannelMeta{ChannelType: constant.ChannelTypeAli, UpstreamModelName: request.Model}}
			converted, err := oaiImage2AliImageRequest(info, *request, true)
			require.NoError(t, err)
			encoded, err := common.Marshal(converted)
			require.NoError(t, err)
			assert.Equal(t, int64(tc.count), gjson.GetBytes(encoded, "parameters.n").Int())
			assert.Equal(t, float64(tc.count), info.PriceData.OtherRatios()["n"])
			assert.Equal(t, tc.extend, info.PriceData.OtherRatios()["prompt_extend"])
		})
	}
}

func TestAliImageConversionRejectsUnvalidatedProviderQuantity(t *testing.T) {
	for _, parameters := range []string{`{"n":0}`, `{"n":129}`} {
		t.Run(parameters, func(t *testing.T) {
			request := dto.ImageRequest{Model: "z-image", Extra: map[string]json.RawMessage{"parameters": json.RawMessage(parameters)}}
			_, err := oaiImage2AliImageRequest(&relaycommon.RelayInfo{ChannelMeta: &relaycommon.ChannelMeta{}}, request, true)
			require.Error(t, err)
		})
	}
}

// Ali reports image_count in its usage; it is upstream-controlled and must be
// bounded before it replaces the reserved billing quantity.
func TestAliImageHandlerBoundsUpstreamImageCount(t *testing.T) {
	gin.SetMode(gin.TestMode)
	for _, tc := range []struct {
		name      string
		usage     string
		results   int
		wantRatio float64
	}{
		{name: "reported count", usage: `{"image_count":3}`, results: 1, wantRatio: 3},
		{name: "missing count uses results", usage: `{}`, results: 2, wantRatio: 2},
		{name: "huge count falls back to results", usage: `{"image_count":100000}`, results: 2, wantRatio: 2},
		{name: "negative count falls back to results", usage: `{"image_count":-5}`, results: 1, wantRatio: 1},
		{name: "no count keeps requested", usage: `{"image_count":100000}`, results: 0, wantRatio: 4},
	} {
		t.Run(tc.name, func(t *testing.T) {
			c, _ := gin.CreateTestContext(httptest.NewRecorder())
			c.Request = httptest.NewRequest(http.MethodPost, "/v1/images/generations", nil)
			results := make([]string, tc.results)
			for i := range results {
				results[i] = `{"url":"https://example.com/image.png"}`
			}
			body := `{"output":{"results":[` + strings.Join(results, ",") + `]},"usage":` + tc.usage + `}`
			info := &relaycommon.RelayInfo{StartTime: time.Now(), ChannelMeta: &relaycommon.ChannelMeta{}}
			info.PriceData.AddOtherRatio("n", 4)
			apiErr, _ := aliImageHandler(&Adaptor{IsSyncImageModel: true}, c, &http.Response{StatusCode: http.StatusOK, Header: http.Header{}, Body: io.NopCloser(strings.NewReader(body))}, info)
			require.Nil(t, apiErr)
			assert.Equal(t, tc.wantRatio, info.PriceData.OtherRatios()["n"])
		})
	}
}
