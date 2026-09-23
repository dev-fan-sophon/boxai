package sora

import (
	"testing"

	"github.com/dev-fan-sophon/boxai/common"
	"github.com/dev-fan-sophon/boxai/model"
	"github.com/stretchr/testify/assert"
	"github.com/stretchr/testify/require"
)

func TestGatewayCreateFromPassthroughMapsCdanceRequest(t *testing.T) {
	body := map[string]interface{}{
		"model":    "seedance-2-0",
		"prompt":   "a red apple",
		"seconds":  "11",
		"size":     "1280x720",
		"images":   []interface{}{"https://example.com/a.jpg"},
		"metadata": map[string]interface{}{"generate_audio": true},
	}
	require.NoError(t, normalizeSeedancePassthroughBody(body, "cdance2.0-0611"))

	payload, err := gatewayCreateFromPassthrough(body, "cdance2.0-0611")
	require.NoError(t, err)
	assert.Equal(t, "cdance2.0-0611", payload.Model)
	require.NotNil(t, payload.Duration)
	assert.Equal(t, 11, *payload.Duration)
	assert.Equal(t, "720p", payload.Resolution)
	assert.Equal(t, "16:9", payload.Ratio)
	require.NotNil(t, payload.GenerateAudio)
	assert.True(t, *payload.GenerateAudio)

	require.GreaterOrEqual(t, len(payload.Content), 2)
	assert.Equal(t, "text", payload.Content[0].Type)
	assert.Equal(t, "a red apple", payload.Content[0].Text)
	assert.Equal(t, "image_url", payload.Content[1].Type)
	assert.Equal(t, "reference_image", payload.Content[1].Role)
	require.NotNil(t, payload.Content[1].ImageURL)
	assert.Equal(t, "https://example.com/a.jpg", payload.Content[1].ImageURL.URL)
}

func TestParseVolcengineGatewayTaskSucceeded(t *testing.T) {
	raw := []byte(`{"id":"cgt-2026xxxx","status":"succeeded","content":{"video_url":"https://tos.example/video.mp4"},"usage":{"completion_tokens":108900,"total_tokens":108900}}`)
	assert.True(t, isVolcengineGatewayTask(raw))
	assert.False(t, isVolcengineGatewayTask([]byte(`{"id":"video_123","status":"completed","metadata":{"url":"https://example/v.mp4"}}`)))

	result, err := parseVolcengineGatewayTask(raw)
	require.NoError(t, err)
	assert.Equal(t, model.TaskStatusSuccess, result.Status)
	assert.Equal(t, "https://tos.example/video.mp4", result.Url)
	assert.Equal(t, 108900, result.TotalTokens)
}

func TestConvertVolcengineGatewayToOpenAIVideo(t *testing.T) {
	raw, err := common.Marshal(map[string]any{
		"id":      "cgt-2026xxxx",
		"status":  "succeeded",
		"content": map[string]string{"video_url": "https://tos.example/video.mp4"},
	})
	require.NoError(t, err)
	task := &model.Task{
		TaskID: "task_public",
		Status: model.TaskStatusSuccess,
		Data:   raw,
	}
	task.Properties.OriginModelName = "seedance-2-0"
	out, err := convertVolcengineGatewayToOpenAIVideo(task)
	require.NoError(t, err)
	var decoded map[string]any
	require.NoError(t, common.Unmarshal(out, &decoded))
	assert.Equal(t, "task_public", decoded["id"])
	assert.Equal(t, "seedance-2-0", decoded["model"])
}
