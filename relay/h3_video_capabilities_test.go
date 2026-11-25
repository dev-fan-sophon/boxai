package relay

import (
	"io"
	"net/http/httptest"
	"strconv"
	"strings"
	"testing"

	"github.com/dev-fan-sophon/boxai/common"
	"github.com/dev-fan-sophon/boxai/constant"
	"github.com/dev-fan-sophon/boxai/dto"
	"github.com/dev-fan-sophon/boxai/relay/channel"
	relaycommon "github.com/dev-fan-sophon/boxai/relay/common"
	"github.com/dev-fan-sophon/boxai/setting/ratio_setting"
	"github.com/gin-gonic/gin"
	"github.com/stretchr/testify/assert"
	"github.com/stretchr/testify/require"
)

func TestH3StudioRequestContractBeforeBilling(t *testing.T) {
	prices := ratio_setting.ModelPrice2JSONString()
	t.Cleanup(func() { require.NoError(t, ratio_setting.UpdateModelPriceByJSONString(prices)) })
	require.NoError(t, ratio_setting.UpdateModelPriceByJSONString(`{"public-video":0.123}`))
	for _, tt := range []struct {
		name    string
		options string
		valid   bool
	}{
		{"studio size", `"duration":4,"seconds":"4","size":"1344x768"`, true},
		{"metadata lower case", `"duration":4,"metadata":{"resolution":"768p","ratio":"16:9"}`, true},
		{"size and upper case metadata", `"duration":4,"size":"1344x768","metadata":{"resolution":"768P","ratio":"16:9"}`, true},
		{"resolution size", `"duration":4,"size":"768p"`, true},
		{"unsupported duration", `"duration":5,"size":"1344x768"`, false},
		{"unsupported frames", `"duration":4,"first_frame":"https://media.test/image.png"`, false},
		{"unsupported reference video", `"duration":4,"reference_videos":["https://media.test/video.mp4"]`, false},
		{"unsupported reference audio", `"duration":4,"reference_audios":["https://media.test/audio.mp3"]`, false},
		{"unsupported resolution", `"duration":4,"size":"1280x720"`, false},
		{"unsupported metadata resolution", `"duration":4,"metadata":{"resolution":"720p"}`, false},
		{"unsupported ratio", `"duration":4,"metadata":{"ratio":"9:16"}`, false},
		{"metadata count bypass", `"duration":4,"metadata":{"n":2}`, false},
		{"metadata content bypass", `"duration":4,"metadata":{"content":[{"type":"video_url"}]}`, false},
		{"metadata huge duration", `"duration":4,"metadata":{"duration":18446744073686646784}`, false},
	} {
		t.Run(tt.name, func(t *testing.T) {
			c, _ := gin.CreateTestContext(httptest.NewRecorder())
			c.Request = httptest.NewRequest("POST", "/pg/video/generations", strings.NewReader(`{"model":"public-video","prompt":"A toy sailboat",`+tt.options+`}`))
			c.Request.Header.Set("Content-Type", "application/json")
			common.SetContextKey(c, constant.ContextKeyChannelType, constant.ChannelTypeMiniMax)
			common.SetContextKey(c, constant.ContextKeyChannelSetting, dto.ChannelSettings{})
			c.Set("model_mapping", `{"public-video":"MiniMax-H3"}`)
			info := &relaycommon.RelayInfo{OriginModelName: "public-video", TaskRelayInfo: &relaycommon.TaskRelayInfo{}}
			if !tt.valid {
				result, taskErr := RelayTaskSubmit(c, info)
				require.NotNil(t, taskErr)
				assert.Equal(t, 400, taskErr.StatusCode)
				assert.Nil(t, result)
				assert.Nil(t, info.Billing)
				assert.Empty(t, info.PublicTaskID)
				return
			}
			info.InitChannelMeta(c)
			info.UpstreamModelName = "MiniMax-H3"
			adaptor := GetTaskAdaptor(constant.TaskPlatform(strconv.Itoa(constant.ChannelTypeMiniMax)))
			require.NotNil(t, adaptor)
			adaptor.Init(info)
			require.Nil(t, adaptor.ValidateRequestAndSetAction(c, info))
			require.Nil(t, adaptor.(channel.MappedTaskRequestValidator).ValidateMappedRequest(c, info))
			require.Nil(t, validatePlaygroundVideoCapability(c, info))
			body, err := adaptor.BuildRequestBody(c, info)
			require.NoError(t, err)
			data, err := io.ReadAll(body)
			require.NoError(t, err)
			assert.JSONEq(t, `{"model":"MiniMax-H3","content":[{"type":"text","text":"A toy sailboat"}],"resolution":"768P","duration":4,"ratio":"16:9"}`, string(data))
			assert.Equal(t, map[string]float64{"seconds": 4}, adaptor.EstimateBilling(c, info))
		})
	}
}
