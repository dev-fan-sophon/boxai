package openai

import (
	"net/http"
	"net/http/httptest"
	"testing"

	"github.com/dev-fan-sophon/boxai/common"
	"github.com/dev-fan-sophon/boxai/dto"
	relayconstant "github.com/dev-fan-sophon/boxai/relay/constant"
	"github.com/gin-gonic/gin"
	"github.com/stretchr/testify/assert"
	"github.com/stretchr/testify/require"
)

// TestSeedreamImageRequestCarriesTheRatioInSize locks the Rolldek Seedream
// contract: the upstream reads the aspect ratio from `size`, while the gateway
// contract spells it aspect_ratio. n and references stay untouched.
func TestSeedreamImageRequestCarriesTheRatioInSize(t *testing.T) {
	gin.SetMode(gin.TestMode)
	c, _ := gin.CreateTestContext(httptest.NewRecorder())
	c.Request = httptest.NewRequest(http.MethodPost, "/v1/images/generations", nil)

	tests := []struct {
		name        string
		aspectRatio string
		size        string
		wantSize    string
	}{
		{name: "aspect_ratio becomes size", aspectRatio: "21:9", wantSize: "21:9"},
		{name: "upstream size spelling is kept", size: "16:9", wantSize: "16:9"},
		{name: "auto passes through", aspectRatio: "auto", wantSize: "auto"},
	}

	for _, tt := range tests {
		t.Run(tt.name, func(t *testing.T) {
			request := dto.ImageRequest{
				Model:       "seedream-5.0",
				Prompt:      "a lantern",
				AspectRatio: tt.aspectRatio,
				Size:        tt.size,
				N:           common.GetPointer(uint(2)),
			}
			info := geminiImageRelayInfo(relayconstant.RelayModeImagesGenerations, &request)

			converted, err := (&Adaptor{}).ConvertImageRequest(c, info, request)
			require.NoError(t, err)
			body, ok := converted.(dto.ImageRequest)
			require.True(t, ok)

			assert.Equal(t, "seedream-5.0", body.Model)
			assert.Equal(t, tt.wantSize, body.Size)
			assert.Empty(t, body.AspectRatio)
			require.NotNil(t, body.N)
			assert.Equal(t, uint(2), *body.N)
		})
	}
}
