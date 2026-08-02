package doubao

import (
	"net/http/httptest"
	"testing"

	relaycommon "github.com/dev-fan-sophon/boxai/relay/common"
	"github.com/gin-gonic/gin"
	"github.com/stretchr/testify/require"
)

// TestEstimateBillingUsesUpstreamModelName guards the billing contract that
// resolution/video-input surcharges keyed by official upstream model names
// still apply when a channel exposes the model under a mapped alias.
func TestEstimateBillingUsesUpstreamModelName(t *testing.T) {
	gin.SetMode(gin.TestMode)

	tests := []struct {
		name       string
		resolution string
		hasVideo   bool
		want       map[string]float64
	}{
		{name: "base tier has no surcharge", resolution: "720p", want: nil},
		{name: "1080p surcharge applies", resolution: "1080p", want: map[string]float64{"video_input": 51.0 / 46.0}},
		{name: "video input discount applies", resolution: "720p", hasVideo: true, want: map[string]float64{"video_input": 28.0 / 46.0}},
	}

	for _, tt := range tests {
		t.Run(tt.name, func(t *testing.T) {
			c, _ := gin.CreateTestContext(httptest.NewRecorder())
			metadata := map[string]interface{}{"resolution": tt.resolution}
			if tt.hasVideo {
				metadata["content"] = []interface{}{
					map[string]interface{}{"type": "video_url", "video_url": map[string]interface{}{"url": "https://example.test/in.mp4"}},
				}
			}
			c.Set("task_request", relaycommon.TaskSubmitReq{Metadata: metadata})

			info := &relaycommon.RelayInfo{
				OriginModelName: "seedance-2-0",
				ChannelMeta:     &relaycommon.ChannelMeta{UpstreamModelName: "doubao-seedance-2-0-260128"},
			}

			got := (&TaskAdaptor{}).EstimateBilling(c, info)
			require.Equal(t, tt.want, got)
		})
	}
}

func TestConvertToRequestPayloadMapsSharedVideoFields(t *testing.T) {
	payload, err := (&TaskAdaptor{}).convertToRequestPayload(&relaycommon.TaskSubmitReq{
		Model:    "doubao-seedance-2-0-260128",
		Prompt:   "blue square",
		Duration: 5,
		Size:     "1280x720",
	})

	require.NoError(t, err)
	require.NotNil(t, payload.Duration)
	require.Equal(t, 5, int(*payload.Duration))
	require.Equal(t, "720p", payload.Resolution)
	require.Equal(t, "16:9", payload.Ratio)
	require.Len(t, payload.Content, 1)
	require.Equal(t, "text", payload.Content[0].Type)
	require.Equal(t, "blue square", payload.Content[0].Text)
}

func TestEstimateBillingDerivesResolutionFromSharedSize(t *testing.T) {
	gin.SetMode(gin.TestMode)
	c, _ := gin.CreateTestContext(httptest.NewRecorder())
	c.Set("task_request", relaycommon.TaskSubmitReq{Size: "1920x1080"})
	info := &relaycommon.RelayInfo{
		ChannelMeta: &relaycommon.ChannelMeta{UpstreamModelName: "doubao-seedance-2-0-260128"},
	}

	require.Equal(t, map[string]float64{"video_input": 51.0 / 46.0}, (&TaskAdaptor{}).EstimateBilling(c, info))
}
