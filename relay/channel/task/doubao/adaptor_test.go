package doubao

import (
	"fmt"
	"net/http"
	"net/http/httptest"
	"strings"
	"testing"

	"github.com/dev-fan-sophon/boxai/common"
	relaycommon "github.com/dev-fan-sophon/boxai/relay/common"
	"github.com/gin-gonic/gin"
	"github.com/stretchr/testify/assert"
	"github.com/stretchr/testify/require"
)

func TestVideoImageRoles(t *testing.T) {
	for _, tt := range []struct {
		name, upstream, first, last string
		images, roles               []string
	}{
		{"references", "doubao-seedance-2-0-260128", "", "", []string{"https://test/subject.png", "https://test/scene.png", "data:image/png;base64,YQ=="}, []string{"reference_image", "reference_image", "reference_image"}},
		{"fast single reference", "doubao-seedance-2-0-fast-260128", "", "", []string{"https://test/style.png"}, []string{"reference_image"}},
		{"explicit frames", "doubao-seedance-2-0-260128", "https://test/start.png", "https://test/end.png", nil, []string{"first_frame", "last_frame"}},
		{"legacy image", "doubao-seedance-1-0-pro-250528", "", "", []string{"https://test/start.png"}, []string{""}},
	} {
		t.Run(tt.name, func(t *testing.T) {
			req := relaycommon.TaskSubmitReq{Model: "public-alias", Prompt: "animate the references", Images: tt.images, FirstFrame: tt.first, LastFrame: tt.last}
			data, err := common.Marshal(req)
			require.NoError(t, err)
			c, _ := gin.CreateTestContext(httptest.NewRecorder())
			c.Request = httptest.NewRequest(http.MethodPost, "/pg/video/generations", strings.NewReader(string(data)))
			c.Request.Header.Set("Content-Type", "application/json")
			info := &relaycommon.RelayInfo{
				TaskRelayInfo: &relaycommon.TaskRelayInfo{},
				ChannelMeta:   &relaycommon.ChannelMeta{IsModelMapped: true, UpstreamModelName: tt.upstream},
			}
			a := &TaskAdaptor{}
			require.Nil(t, a.ValidateRequestAndSetAction(c, info))
			require.Nil(t, a.ValidateMappedRequest(c, info))
			body, err := a.BuildRequestBody(c, info)
			require.NoError(t, err)
			var payload requestPayload
			require.NoError(t, common.DecodeJson(body, &payload))
			assert.Equal(t, tt.upstream, payload.Model)
			require.Len(t, payload.Content, len(tt.roles)+1)
			images := tt.images
			if tt.first != "" {
				images = []string{tt.first, tt.last}
			}
			for i, role := range tt.roles {
				assert.Equal(t, role, payload.Content[i].Role)
				require.NotNil(t, payload.Content[i].ImageURL)
				assert.Equal(t, images[i], payload.Content[i].ImageURL.URL)
			}
			assert.Equal(t, "animate the references", payload.Content[len(tt.roles)].Text)
		})
	}
}

func TestValidateMappedReferenceImages(t *testing.T) {
	for _, metadata := range []bool{false, true} {
		for _, count := range []int{9, 10} {
			t.Run(fmt.Sprintf("metadata=%t/count=%d", metadata, count), func(t *testing.T) {
				req := relaycommon.TaskSubmitReq{Model: "custom-alias", Prompt: "animate"}
				content := []ContentItem{}
				for i := 0; i < count; i++ {
					url := fmt.Sprintf("https://test/%d.png", i)
					req.Images = append(req.Images, url)
					content = append(content, ContentItem{Type: "image_url", Role: "reference_image", ImageURL: &MediaURL{URL: url}})
				}
				if metadata {
					req.Images = nil
					req.Metadata = map[string]interface{}{"content": content}
				}
				c, _ := gin.CreateTestContext(httptest.NewRecorder())
				c.Set("task_request", req)
				info := &relaycommon.RelayInfo{ChannelMeta: &relaycommon.ChannelMeta{UpstreamModelName: "doubao-seedance-2-0-260128"}}
				err := (&TaskAdaptor{}).ValidateMappedRequest(c, info)
				if count == 9 {
					require.Nil(t, err)
				} else {
					require.NotNil(t, err)
					assert.Equal(t, http.StatusBadRequest, err.StatusCode)
				}
			})
		}
	}
	_, err := (&TaskAdaptor{}).convertToRequestPayload(&relaycommon.TaskSubmitReq{
		Model: "seedance-2-0", FirstFrame: "https://test/start.png",
		Images: []string{"https://test/start.png", "https://test/reference.png"},
	})
	require.ErrorContains(t, err, "cannot be combined")
}

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
