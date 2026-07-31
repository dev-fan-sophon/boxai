package relay

import (
	"strconv"
	"strings"
	"testing"

	"github.com/dev-fan-sophon/boxai/constant"
	"github.com/dev-fan-sophon/boxai/model"
	relaycommon "github.com/dev-fan-sophon/boxai/relay/common"
	"github.com/stretchr/testify/require"
)

func TestTaskPlatformForGrokImagineVideo(t *testing.T) {
	openAIPlatform := constant.TaskPlatform(strconv.Itoa(constant.ChannelTypeOpenAI))
	xAIPlatform := constant.TaskPlatform(strconv.Itoa(constant.ChannelTypeXai))

	require.Equal(t, xAIPlatform, taskPlatformForModel(openAIPlatform, "grok-imagine-video"))
	require.Equal(t, xAIPlatform, taskPlatformForModel(openAIPlatform, "grok-imagine-video-1.5"))
	require.Equal(t, openAIPlatform, taskPlatformForModel(openAIPlatform, "sora-2"))
}

func TestXAITaskPersistsSelectedMultiKeyChannelKey(t *testing.T) {
	platform := constant.TaskPlatform(strconv.Itoa(constant.ChannelTypeXai))
	relayInfo := &relaycommon.RelayInfo{
		UserId:     1,
		UsingGroup: "default",
		ChannelMeta: &relaycommon.ChannelMeta{
			ChannelType:       constant.ChannelTypeOpenAI,
			ChannelId:         7,
			ChannelIsMultiKey: true,
			ApiKey:            "selected-key",
		},
		TaskRelayInfo: &relaycommon.TaskRelayInfo{},
	}

	task := model.InitTask(platform, relayInfo)

	require.Equal(t, "selected-key", task.PrivateData.Key)
}

func TestXAITaskDtoOnlyExposesAuthenticatedProxyURL(t *testing.T) {
	upstreamURL := "https://signed.video.example/video.mp4?secret=token"
	task := &model.Task{
		TaskID:   "task_public",
		Platform: constant.TaskPlatform(strconv.Itoa(constant.ChannelTypeXai)),
		Status:   model.TaskStatusSuccess,
		PrivateData: model.TaskPrivateData{
			ResultURL: upstreamURL,
		},
		Data: []byte(`{"status":"done","video":{"url":"https://signed.video.example/video.mp4?secret=token","duration":8}}`),
	}

	result := TaskModel2Dto(task)

	require.Contains(t, result.ResultURL, "/v1/videos/task_public/content")
	require.NotEqual(t, upstreamURL, result.ResultURL)
	require.Empty(t, result.Data)
	require.False(t, strings.Contains(result.ResultURL, "secret=token"))
}
