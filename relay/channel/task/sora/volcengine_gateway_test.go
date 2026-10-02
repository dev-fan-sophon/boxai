package sora

import (
	"strings"
	"testing"

	"github.com/dev-fan-sophon/boxai/common"
	"github.com/dev-fan-sophon/boxai/model"
	"github.com/dev-fan-sophon/boxai/setting/system_setting"
	"github.com/glebarez/sqlite"
	"github.com/stretchr/testify/assert"
	"github.com/stretchr/testify/require"
	"gorm.io/gorm"
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

func TestGatewayRewritesAppAssetToFetchGrant(t *testing.T) {
	t.Setenv("CRYPTO_SECRET", "gateway-test-shared-secret")
	db, err := gorm.Open(sqlite.Open(":memory:"), &gorm.Config{})
	require.NoError(t, err)
	oldDB := model.DB
	model.DB = db
	t.Cleanup(func() { model.DB = oldDB })
	require.NoError(t, db.AutoMigrate(&model.PlaygroundAsset{}))
	require.NoError(t, db.Create(&model.PlaygroundAsset{Id: 42, UserId: 7, Kind: "image", StorageKey: "test"}).Error)
	old := system_setting.ServerAddress
	system_setting.ServerAddress = "https://you-box.com"
	t.Cleanup(func() { system_setting.ServerAddress = old })

	body := map[string]interface{}{
		"prompt": "a red apple",
		"images": []interface{}{"/api/playground/assets/42/content"},
	}
	require.NoError(t, normalizeSeedancePassthroughBody(body, "cdance2.0-0611"))
	require.NoError(t, rewriteGatewayReferenceURLs(body, 7))

	payload, err := gatewayCreateFromPassthrough(body, "cdance2.0-0611")
	require.NoError(t, err)
	require.GreaterOrEqual(t, len(payload.Content), 2)
	got := payload.Content[1].ImageURL.URL
	assert.True(t, strings.HasPrefix(got, "https://you-box.com/api/playground/media-fetch/"))
	assert.NotContains(t, got, "/api/playground/assets/")
	assert.NotContains(t, got, "base64")
}

func TestGatewayCreateIncludesCallbackAndNoInlineBytes(t *testing.T) {
	old := system_setting.ServerAddress
	system_setting.ServerAddress = "https://you-box.com"
	t.Cleanup(func() { system_setting.ServerAddress = old })

	body := map[string]interface{}{
		"prompt": "a red apple",
		"images": []interface{}{"https://cdn.example/ref.jpg"},
	}
	payload, err := gatewayCreateFromPassthrough(body, "cdance2.0-0611")
	require.NoError(t, err)
	assert.Equal(t, "https://you-box.com/api/playground/task/volcengine/callback", payload.CallbackURL)
	raw, err := common.Marshal(payload)
	require.NoError(t, err)
	assert.NotContains(t, string(raw), "base64")
	assert.NotContains(t, string(raw), "data:")
}

func TestGatewayCreateOmitsLocalCallback(t *testing.T) {
	old := system_setting.ServerAddress
	system_setting.ServerAddress = "http://localhost:3000"
	t.Cleanup(func() { system_setting.ServerAddress = old })

	body := map[string]interface{}{"prompt": "a red apple"}
	payload, err := gatewayCreateFromPassthrough(body, "cdance2.0-0611")
	require.NoError(t, err)
	assert.Empty(t, payload.CallbackURL)
}

func TestGatewayCreateRejectsInlineReferenceBytes(t *testing.T) {
	body := map[string]interface{}{
		"prompt": "a red apple",
		"metadata": map[string]interface{}{
			"content": []interface{}{
				map[string]interface{}{
					"type":      "image_url",
					"role":      "reference_image",
					"image_url": map[string]interface{}{"url": "data:image/png;base64,YQ=="},
				},
			},
		},
	}
	_, err := gatewayCreateFromPassthrough(body, "cdance2.0-0611")
	require.Error(t, err)
	assert.Contains(t, err.Error(), "not inline file bytes")
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

func TestGatewayMapsTypedReferenceMediaAndAdvancedOptions(t *testing.T) {
	body := decodeBody(t, `{"prompt":"dance","seconds":"6","reference_images":["https://m/i.png"],"reference_videos":["https://m/v.mp4"],"reference_audios":["https://m/a.mp3"],"metadata":{"ratio":"9:16","resolution":"720p","seed":4294967295,"return_last_frame":true,"watermark":false}}`)
	require.NoError(t, normalizeSeedancePassthroughBody(body, "cdance2.0-0611"))
	for _, alias := range []string{"reference_images", "reference_videos", "reference_audios"} {
		assert.NotContains(t, body, alias, "gateways would duplicate typed media")
	}
	payload, err := gatewayCreateFromPassthrough(body, "cdance2.0-0611")
	require.NoError(t, err)
	require.Len(t, payload.Content, 4)
	assert.Equal(t, gatewayContentItem{Type: "image_url", Role: "reference_image", ImageURL: &gatewayMedia{URL: "https://m/i.png"}}, payload.Content[1])
	assert.Equal(t, gatewayContentItem{Type: "video_url", Role: "reference_video", VideoURL: &gatewayMedia{URL: "https://m/v.mp4"}}, payload.Content[2])
	assert.Equal(t, gatewayContentItem{Type: "audio_url", Role: "reference_audio", AudioURL: &gatewayMedia{URL: "https://m/a.mp3"}}, payload.Content[3])
	require.NotNil(t, payload.Seed)
	assert.Equal(t, int64(4294967295), *payload.Seed)
	require.NotNil(t, payload.ReturnLastFrame)
	assert.True(t, *payload.ReturnLastFrame)
	require.NotNil(t, payload.Watermark)
	assert.False(t, *payload.Watermark)
}

func TestGatewayReferenceMediaLimitsAndSeedBounds(t *testing.T) {
	tests := []struct {
		name, model, body, wantErr string
	}{
		{"2.0 videos", "cdance2.0-0611", `{"prompt":"p","reference_videos":["a","b","c","d"]}`, "at most 3 reference videos"},
		{"2.0 audios", "cdance2.0-fast-0611", `{"prompt":"p","reference_images":["i"],"reference_audios":["a","b","c","d"]}`, "at most 3 reference audios"},
		{"2.5 accepts ten videos", "cdance2.5-0807", `{"prompt":"p","reference_videos":["1","2","3","4","5","6","7","8","9","10"]}`, ""},
		{"frames with audio", "cdance2.0-0611", `{"prompt":"p","first_frame":"https://f","reference_audios":["a"]}`, "cannot be combined"},
	}
	for _, tt := range tests {
		t.Run(tt.name, func(t *testing.T) {
			err := normalizeSeedancePassthroughBody(decodeBody(t, tt.body), tt.model)
			if tt.wantErr == "" {
				require.NoError(t, err)
				return
			}
			require.ErrorContains(t, err, tt.wantErr)
		})
	}
	_, err := gatewayCreateFromPassthrough(decodeBody(t, `{"prompt":"p","metadata":{"seed":4294967296}}`), "cdance2.0-0611")
	require.Error(t, err)
}

func TestGatewayParseExposesLastFrameURL(t *testing.T) {
	task := &model.Task{TaskID: "task_g", Status: model.TaskStatusSuccess, Data: []byte(`{"id":"cgt-9","status":"succeeded","content":{"video_url":"https://v/o.mp4","last_frame_url":"https://v/l.png"}}`)}
	raw, err := convertVolcengineGatewayToOpenAIVideo(task)
	require.NoError(t, err)
	assert.Contains(t, string(raw), `"last_frame_url":"https://v/l.png"`)
}
