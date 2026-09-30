package relay

import (
	"net/http/httptest"
	"strings"
	"testing"

	"github.com/dev-fan-sophon/boxai/common"
	"github.com/dev-fan-sophon/boxai/constant"
	"github.com/dev-fan-sophon/boxai/dto"
	relaycommon "github.com/dev-fan-sophon/boxai/relay/common"
	"github.com/dev-fan-sophon/boxai/service"
	"github.com/gin-gonic/gin"
	"github.com/stretchr/testify/assert"
	"github.com/stretchr/testify/require"
)

func TestVideoCapabilityChecksSelectedChannelBeforeBilling(t *testing.T) {
	for _, test := range []struct{ name, metadata, extra string }{
		{"fixed frame ratio", `"ratio":"9:16"`, ``},
		{"metadata content bypass", `"ratio":"adaptive","content":[]`, ``},
		{"conflicting metadata frame", `"ratio":"adaptive","first_frame":"https://different"`, ``},
		{"mixed references", `"ratio":"adaptive"`, `,"images":["https://first","https://other"]`},
	} {
		t.Run(test.name, func(t *testing.T) {
			c, _ := gin.CreateTestContext(httptest.NewRecorder())
			body := `{"model":"public-video","prompt":"animate","duration":5,"first_frame":"https://first","metadata":{` + test.metadata + `}` + test.extra + `}`
			c.Request = httptest.NewRequest("POST", "/pg/video/generations", strings.NewReader(body))
			c.Request.Header.Set("Content-Type", "application/json")
			common.SetContextKey(c, constant.ContextKeyChannelType, constant.ChannelTypeDoubaoVideo)
			common.SetContextKey(c, constant.ContextKeyChannelSetting, dto.ChannelSettings{})
			c.Set("model_mapping", `{"public-video":"doubao-seedance-2-5-260628"}`)
			info := &relaycommon.RelayInfo{OriginModelName: "public-video", TaskRelayInfo: &relaycommon.TaskRelayInfo{}}
			result, err := RelayTaskSubmit(c, info)
			require.NotNil(t, err)
			assert.Equal(t, 400, err.StatusCode)
			assert.Nil(t, result)
			assert.Nil(t, info.Billing)
			assert.Empty(t, info.PublicTaskID)
		})
	}
}

func TestVideoCapabilityRechecksFalseAudioOnRetry(t *testing.T) {
	c, _ := gin.CreateTestContext(httptest.NewRecorder())
	c.Request = httptest.NewRequest("POST", "/pg/video/generations", nil)
	info := &relaycommon.RelayInfo{ChannelMeta: &relaycommon.ChannelMeta{ChannelType: constant.ChannelTypeDoubaoVideo, UpstreamModelName: "doubao-seedance-2-5-260628"}}
	c.Set("task_request", relaycommon.TaskSubmitReq{Duration: 5, Metadata: map[string]interface{}{"generate_audio": false}})
	common.SetContextKey(c, constant.ContextKeyChannelSetting, dto.ChannelSettings{})
	require.Nil(t, validatePlaygroundVideoCapability(c, info))
	profile, ok := service.VideoProfileForSelectedChannel(info.ChannelType, dto.ChannelSettings{}, info.UpstreamModelName, "text")
	require.True(t, ok)
	profile.SupportsAudioToggle = false
	common.SetContextKey(c, constant.ContextKeyChannelSetting, dto.ChannelSettings{VideoCapabilities: map[string]map[string]dto.VideoModelCapabilities{info.UpstreamModelName: {"text": profile}}})
	err := validatePlaygroundVideoCapability(c, info)
	require.NotNil(t, err)
	assert.Equal(t, "unsupported_video_capability", err.Code)
}

func TestVideoCapabilityRejectsMetadataIgnoredByTransport(t *testing.T) {
	c, _ := gin.CreateTestContext(httptest.NewRecorder())
	c.Request = httptest.NewRequest("POST", "/pg/video/generations", nil)
	info := &relaycommon.RelayInfo{ChannelMeta: &relaycommon.ChannelMeta{ChannelType: constant.ChannelTypeXai, UpstreamModelName: "grok-imagine-video"}}
	common.SetContextKey(c, constant.ContextKeyChannelSetting, dto.ChannelSettings{})
	// Without this guard, a metadata-only portrait request would validate but
	// the size-based transport would silently generate its default landscape.
	c.Set("task_request", relaycommon.TaskSubmitReq{Duration: 5, Metadata: map[string]interface{}{"ratio": "9:16"}})
	err := validatePlaygroundVideoCapability(c, info)
	require.NotNil(t, err)
	assert.Equal(t, "unsupported_video_capability", err.Code)
	c.Set("task_request", relaycommon.TaskSubmitReq{Duration: 5, Size: "720x1280"})
	assert.Nil(t, validatePlaygroundVideoCapability(c, info))
}
