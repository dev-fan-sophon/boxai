package common_test

import (
	"net/http"
	"net/http/httptest"
	"strings"
	"testing"

	"github.com/dev-fan-sophon/boxai/common"
	"github.com/dev-fan-sophon/boxai/constant"
	relaycommon "github.com/dev-fan-sophon/boxai/relay/common"
	relayconstant "github.com/dev-fan-sophon/boxai/relay/constant"
	"github.com/dev-fan-sophon/boxai/relay/helper"
	"github.com/gin-gonic/gin"
	"github.com/stretchr/testify/assert"
	"github.com/stretchr/testify/require"
)

func TestNativeImageGenerateContract(t *testing.T) {
	gin.SetMode(gin.TestMode)
	for _, model := range []string{"doubao-seedream-5-0-flash-260915", "qwen-image-2.1-turbo"} {
		t.Run(model, func(t *testing.T) {
			profile := relaycommon.DefaultImageCapabilities(model)
			require.NotNil(t, profile)
			assert.Equal(t, []string{"generate"}, profile.Modes)
			assert.Zero(t, profile.MaxReferenceImages)
			assert.False(t, profile.SupportsMask)
			assert.Equal(t, 1, profile.MaxN)
			for _, size := range append([]string{""}, profile.Sizes...) {
				body, err := common.Marshal(map[string]any{"model": model, "prompt": "a cup", "size": size, "n": 1})
				require.NoError(t, err)
				c, _ := gin.CreateTestContext(httptest.NewRecorder())
				c.Request = httptest.NewRequest(http.MethodPost, "/v1/images/generations", strings.NewReader(string(body)))
				c.Request.Header.Set("Content-Type", "application/json")
				request, err := helper.GetAndValidOpenAIImageRequest(c, relayconstant.RelayModeImagesGenerations)
				require.NoError(t, err, "every advertised size must be accepted")
				assert.Contains(t, profile.Sizes, request.Size)
			}
			for _, tc := range []struct {
				name, fields, want string
				mode               int
			}{
				{name: "batch", fields: `,"n":2`, want: "between 1 and 1"},
				{name: "unadvertised size", fields: `,"size":"2048x2048"`, want: "size must be one of"},
				{name: "ratio size", fields: `,"size":"1:1"`, want: "size must be one of"},
				{name: "aspect", fields: `,"aspect_ratio":"1:1"`, want: "only size"},
				{name: "resolution", fields: `,"resolution":"1K"`, want: "only size"},
				{name: "quality", fields: `,"quality":"high"`, want: "only size"},
				{name: "mask", fields: `,"mask":"https://example.com/m.png"`, want: "mask is not supported"},
				{name: "reference", fields: `,"image":"https://example.com/a.png"`, want: "at most 0 reference images"},
				{name: "references", fields: `,"images":["https://example.com/a.png"]`, want: "at most 0 reference images"},
				{name: "stream", fields: `,"stream":true`, want: "stream is not supported"},
				{name: "hidden reference", fields: `,"input":{"messages":[{"content":[{"image":"https://example.com/a.png"}]}]}`, want: "input is not supported"},
				{name: "hidden batch", fields: `,"parameters":{"n":2}`, want: "parameters is not supported"},
				{name: "layers", fields: `,"layer_decomposition":true`, want: "layer_decomposition is not supported"},
				{name: "edit without reference", mode: relayconstant.RelayModeImagesEdits, want: "image is required"},
				{name: "edit with reference", mode: relayconstant.RelayModeImagesEdits, fields: `,"image":"https://example.com/a.png"`, want: "at most 0 reference images"},
			} {
				t.Run(tc.name, func(t *testing.T) {
					mode := tc.mode
					if mode == 0 {
						mode = relayconstant.RelayModeImagesGenerations
					}
					c, _ := gin.CreateTestContext(httptest.NewRecorder())
					body := `{"model":"` + model + `","prompt":"a cup"` + tc.fields + `}`
					c.Request = httptest.NewRequest(http.MethodPost, "/v1/images/generations", strings.NewReader(body))
					c.Request.Header.Set("Content-Type", "application/json")
					common.SetContextKey(c, constant.ContextKeyChannelType, constant.ChannelTypeAli)
					_, err := helper.GetAndValidOpenAIImageRequest(c, mode)
					require.ErrorContains(t, err, tc.want)
				})
			}
		})
	}
	assert.Nil(t, relaycommon.DefaultImageCapabilities("doubao-seedream-5-5-261028"))
	assert.Nil(t, relaycommon.DefaultImageCapabilities("qwen-image-3.0-pro"))
}
