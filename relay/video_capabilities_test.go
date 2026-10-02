package relay

import (
	"fmt"
	"net/http/httptest"
	"strconv"
	"strings"
	"testing"

	"github.com/dev-fan-sophon/boxai/common"
	"github.com/dev-fan-sophon/boxai/constant"
	"github.com/dev-fan-sophon/boxai/dto"
	"github.com/dev-fan-sophon/boxai/model"
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

func TestPlaygroundVideoCapabilityBounds(t *testing.T) {
	const seedance20, seedance25, grok15 = "doubao-seedance-2-0-260128", "doubao-seedance-2-5-260628", "grok-imagine-video-1.5"
	urls := func(prefix string, n int) []string {
		out := make([]string, n)
		for i := range out {
			out[i] = fmt.Sprintf("https://media.test/%s-%d", prefix, i)
		}
		return out
	}
	tests := []struct {
		name     string
		channel  int
		model    string
		req      relaycommon.TaskSubmitReq
		wantCode string
	}{
		{"seedance 2.0 full multimodal references", constant.ChannelTypeDoubaoVideo, seedance20, relaycommon.TaskSubmitReq{Duration: 5, ReferenceImages: urls("i", 9), ReferenceVideos: urls("v", 3), ReferenceAudios: urls("a", 3)}, ""},
		{"untyped images count as reference images", constant.ChannelTypeDoubaoVideo, seedance20, relaycommon.TaskSubmitReq{Duration: 5, Images: urls("i", 5), ReferenceImages: urls("j", 5)}, "unsupported_video_capability"},
		{"seedance 2.0 too many reference videos", constant.ChannelTypeDoubaoVideo, seedance20, relaycommon.TaskSubmitReq{Duration: 5, ReferenceVideos: urls("v", 4)}, "unsupported_video_capability"},
		{"seedance 2.0 too many reference audios", constant.ChannelTypeSora, seedance20, relaycommon.TaskSubmitReq{Duration: 5, ReferenceImages: urls("i", 1), ReferenceAudios: urls("a", 4)}, "unsupported_video_capability"},
		{"seedance 2.0 audio-only reference", constant.ChannelTypeDoubaoVideo, seedance20, relaycommon.TaskSubmitReq{Duration: 5, ReferenceAudios: urls("a", 1)}, "unsupported_video_capability"},
		{"seedance 2.5 audio-only reference", constant.ChannelTypeDoubaoVideo, seedance25, relaycommon.TaskSubmitReq{Duration: 5, ReferenceAudios: urls("a", 10)}, ""},
		{"seedance 2.5 too many reference videos", constant.ChannelTypeDoubaoVideo, seedance25, relaycommon.TaskSubmitReq{Duration: 5, ReferenceVideos: urls("v", 11)}, "unsupported_video_capability"},
		{"reference video with frames", constant.ChannelTypeDoubaoVideo, seedance20, relaycommon.TaskSubmitReq{Duration: 5, FirstFrame: "https://f", Images: []string{"https://f"}, ReferenceVideos: urls("v", 1)}, "invalid_request"},
		{"seedance 2.0 any integer duration", constant.ChannelTypeDoubaoVideo, seedance20, relaycommon.TaskSubmitReq{Duration: 7}, ""},
		{"seedance 2.0 duration above range", constant.ChannelTypeDoubaoVideo, seedance20, relaycommon.TaskSubmitReq{Duration: 16}, "unsupported_video_capability"},
		{"seedance 2.0 duration below range", constant.ChannelTypeDoubaoVideo, seedance20, relaycommon.TaskSubmitReq{Duration: 3}, "unsupported_video_capability"},
		{"seedance 2.5 long duration", constant.ChannelTypeDoubaoVideo, seedance25, relaycommon.TaskSubmitReq{Duration: 30}, ""},
		{"seedance advanced metadata", constant.ChannelTypeDoubaoVideo, seedance20, relaycommon.TaskSubmitReq{Duration: 5, Metadata: map[string]interface{}{"seed": float64(4294967295), "watermark": false, "return_last_frame": true}}, ""},
		{"seed random sentinel", constant.ChannelTypeDoubaoVideo, seedance20, relaycommon.TaskSubmitReq{Duration: 5, Metadata: map[string]interface{}{"seed": float64(-1)}}, ""},
		{"seed above uint32", constant.ChannelTypeDoubaoVideo, seedance20, relaycommon.TaskSubmitReq{Duration: 5, Metadata: map[string]interface{}{"seed": float64(4294967296)}}, "invalid_request"},
		{"fractional seed", constant.ChannelTypeDoubaoVideo, seedance20, relaycommon.TaskSubmitReq{Duration: 5, Metadata: map[string]interface{}{"seed": 1.5}}, "invalid_request"},
		{"non-boolean watermark", constant.ChannelTypeDoubaoVideo, seedance20, relaycommon.TaskSubmitReq{Duration: 5, Metadata: map[string]interface{}{"watermark": "no"}}, "invalid_request"},
		{"unknown metadata", constant.ChannelTypeDoubaoVideo, seedance20, relaycommon.TaskSubmitReq{Duration: 5, Metadata: map[string]interface{}{"camera_fixed": true}}, "invalid_request"},
		{"xai first and last frame", constant.ChannelTypeXai, grok15, relaycommon.TaskSubmitReq{Duration: 8, Size: "1920x1080", FirstFrame: "https://f", LastFrame: "https://l", Images: []string{"https://f", "https://l"}, Metadata: map[string]interface{}{"first_frame": "https://f", "first_frame_url": "https://f", "last_frame": "https://l", "last_frame_url": "https://l", "generate_audio": false}}, ""},
		{"xai 480p 3:2", constant.ChannelTypeXai, grok15, relaycommon.TaskSubmitReq{Duration: 1, Size: "720x480"}, ""},
		{"xai seven references", constant.ChannelTypeXai, grok15, relaycommon.TaskSubmitReq{Duration: 5, Size: "1280x720", ReferenceImages: urls("i", 7)}, ""},
		{"xai eight references", constant.ChannelTypeXai, grok15, relaycommon.TaskSubmitReq{Duration: 5, Size: "1280x720", ReferenceImages: urls("i", 8)}, "unsupported_video_capability"},
		{"xai references at 1080p", constant.ChannelTypeXai, grok15, relaycommon.TaskSubmitReq{Duration: 5, Size: "1920x1080", ReferenceImages: urls("i", 1)}, "unsupported_video_capability"},
		{"xai reference video", constant.ChannelTypeXai, grok15, relaycommon.TaskSubmitReq{Duration: 5, ReferenceImages: urls("i", 1), ReferenceVideos: urls("v", 1)}, "unsupported_video_capability"},
		{"xai seed", constant.ChannelTypeXai, grok15, relaycommon.TaskSubmitReq{Duration: 5, Metadata: map[string]interface{}{"seed": float64(1)}}, "unsupported_video_capability"},
		{"xai duration above 15", constant.ChannelTypeXai, grok15, relaycommon.TaskSubmitReq{Duration: 16}, "unsupported_video_capability"},
		{"classic xai last frame", constant.ChannelTypeXai, "grok-imagine-video", relaycommon.TaskSubmitReq{Duration: 5, FirstFrame: "https://f", LastFrame: "https://l", Images: []string{"https://f", "https://l"}}, "unsupported_video_capability"},
		{"classic xai audio toggle", constant.ChannelTypeXai, "grok-imagine-video", relaycommon.TaskSubmitReq{Duration: 5, Metadata: map[string]interface{}{"generate_audio": true}}, "unsupported_video_capability"},
	}
	for _, tt := range tests {
		t.Run(tt.name, func(t *testing.T) {
			c, _ := gin.CreateTestContext(httptest.NewRecorder())
			c.Request = httptest.NewRequest("POST", "/pg/video/generations", nil)
			common.SetContextKey(c, constant.ContextKeyChannelSetting, dto.ChannelSettings{})
			c.Set("task_request", tt.req)
			info := &relaycommon.RelayInfo{ChannelMeta: &relaycommon.ChannelMeta{ChannelType: tt.channel, UpstreamModelName: tt.model}}
			err := validatePlaygroundVideoCapability(c, info)
			if tt.wantCode == "" {
				require.Nil(t, err)
				return
			}
			require.NotNil(t, err)
			assert.Equal(t, 400, err.StatusCode)
			assert.Equal(t, tt.wantCode, err.Code)
		})
	}
}

func TestTaskDtoExposesArkLastFrameOnlyOnSuccess(t *testing.T) {
	data := []byte(`{"id":"cgt-1","status":"succeeded","content":{"video_url":"https://v/o.mp4","last_frame_url":"https://v/l.png"}}`)
	doubao := constant.TaskPlatform(strconv.Itoa(constant.ChannelTypeDoubaoVideo))
	assert.Equal(t, "https://v/l.png", TaskModel2Dto(&model.Task{Platform: doubao, Status: model.TaskStatusSuccess, Data: data}).LastFrameURL)
	assert.Empty(t, TaskModel2Dto(&model.Task{Platform: doubao, Status: model.TaskStatusInProgress, Data: data}).LastFrameURL)
	assert.Empty(t, TaskModel2Dto(&model.Task{Platform: doubao, Status: model.TaskStatusSuccess, Data: []byte(`{"content":[{"type":"text"}]}`)}).LastFrameURL)
}
