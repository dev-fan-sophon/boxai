package sora

import (
	"fmt"
	"io"
	"net/http"
	"net/http/httptest"
	"strings"
	"testing"

	"github.com/dev-fan-sophon/boxai/common"
	"github.com/dev-fan-sophon/boxai/constant"
	"github.com/dev-fan-sophon/boxai/model"
	relaycommon "github.com/dev-fan-sophon/boxai/relay/common"
	"github.com/dev-fan-sophon/boxai/service/storage"
	"github.com/dev-fan-sophon/boxai/setting/system_setting"
	"github.com/gin-gonic/gin"
	"github.com/glebarez/sqlite"
	"github.com/stretchr/testify/assert"
	"github.com/stretchr/testify/require"
	"gorm.io/gorm"
)

func TestWanVideoTransportAndBilling(t *testing.T) {
	for _, tt := range []struct {
		name, model, options, resolution string
		seconds, resolutionRatio         float64
		invalid                          bool
	}{
		{"standard 1080p", "wan-3.0-video", `"seconds":"7","size":"1080P"`, "1080P", 7, 1.3125, false},
		{"prime 1080p", "wan-3.0-video-prime", `"duration":9,"resolution":"1080p"`, "1080P", 9, 0.47 / 0.38, false},
		{"fixed standard", "wan3.0-video-1080p", `"seconds":"15"`, "1080P", 15, 1, false},
		{"fixed prime landscape", "wan3.0-video-prime-1080p", `"seconds":"30","size":"1920x1080"`, "1080P", 30, 1, false},
		{"fixed prime 720", "wan3.0-video-prime-720p", `"seconds":"15"`, "720P", 15, 1, false},
		{"nsfw 480", "wan3.0-video-nsfw", `"seconds":"2","size":"480P"`, "480P", 2, 1, false},
		{"nsfw metadata 1080", "wan3.0-video-nsfw", `"duration":3,"metadata":{"resolution":"1080p","ratio":"16:9"}`, "1080P", 3, 4, false},
		{"nsfw ignored portrait unavailable", "wan3.0-video-nsfw", `"duration":2,"aspect_ratio":"9:16"`, "", 0, 0, true},
		{"nsfw portrait size alias unavailable", "wan3.0-video-nsfw", `"duration":2,"size":"720x1280"`, "", 0, 0, true},
		{"nsfw 720", "wan3.0-video-nsfw", `"seconds":"5","size":"1280x720"`, "720P", 5, 2, false},
		{"fixed wrong duration", "wan3.0-video-1080p", `"seconds":"16"`, "", 0, 0, true},
		{"fixed wrong resolution", "wan3.0-video-prime-720p", `"seconds":"15","size":"1080P"`, "", 0, 0, true},
		{"conflicting aliases", "wan3.0-video-nsfw", `"seconds":"2","duration":3`, "", 0, 0, true},
		{"conflicting resolutions", "wan3.0-video-nsfw", `"seconds":"2","size":"480P","resolution":"1080p"`, "", 0, 0, true},
		{"huge seconds", "wan3.0-video-nsfw", `"seconds":"18446744073709551615"`, "", 0, 0, true},
		{"fractional seconds", "wan3.0-video-nsfw", `"duration":2.5`, "", 0, 0, true},
		{"zero seconds", "wan3.0-video-nsfw", `"seconds":"0"`, "", 0, 0, true},
		{"unmetered media bypass", "wan3.0-video-nsfw", `"seconds":"2","input":{"media":[{"url":"https://example.com/reference.mp4"}]}`, "", 0, 0, true},
		{"object frames", "wan3.0-video-prime-1080p", `"seconds":"15","reference_images":[{"url":"https://example.com/first.png","role":"first_frame"},{"url":"https://example.com/last.png","role":"last_frame"}]`, "1080P", 15, 1, false},
		{"playground fields", "wan-3.0-video", `"group":"default","duration":4,"seconds":"4","size":"1280x720"`, "720P", 4, 1, false},
		{"NSFW string video reference unavailable", "wan3.0-video-nsfw", `"seconds":"2","reference_videos":["https://example.com/reference.mp4"]`, "", 0, 0, true},
		{"NSFW object video reference unavailable", "wan3.0-video-nsfw", `"seconds":"2","reference_videos":[{"url":"https://example.com/reference.mp4","duration":0}]`, "", 0, 0, true},
		{"official input video is free", "wan3.0-video-1080p", `"seconds":"15","reference_videos":[{"url":"https://example.com/reference.mp4","duration":999999999}]`, "1080P", 15, 1, false},
		{"mixed frames and references", "wan3.0-video-prime-1080p", `"seconds":"15","first_frame":"https://example.com/first.png","reference_images":["https://example.com/reference.png"]`, "", 0, 0, true},
	} {
		t.Run(tt.name, func(t *testing.T) {
			c, _ := gin.CreateTestContext(httptest.NewRecorder())
			c.Request = httptest.NewRequest(http.MethodPost, "/v1/videos", strings.NewReader(`{"model":"`+tt.model+`","prompt":"A quiet lake",`+tt.options+`}`))
			c.Request.Header.Set("Content-Type", "application/json")
			t.Cleanup(func() { common.CleanupBodyStorage(c) })
			info := &relaycommon.RelayInfo{OriginModelName: tt.model, ChannelMeta: &relaycommon.ChannelMeta{UpstreamModelName: tt.model}, TaskRelayInfo: &relaycommon.TaskRelayInfo{}}
			a := &TaskAdaptor{}
			err := a.ValidateRequestAndSetAction(c, info)
			if tt.invalid {
				require.NotNil(t, err)
				assert.Equal(t, 400, err.StatusCode)
				return
			}
			require.Nil(t, err)
			require.Nil(t, a.ValidateMappedRequest(c, info))
			ratios := a.EstimateBilling(c, info)
			assert.InDelta(t, tt.seconds, ratios["seconds"], 1e-9)
			assert.InDelta(t, tt.resolutionRatio, ratios["resolution"], 1e-9)
			assert.NotContains(t, ratios, "size")
			body, bodyErr := a.BuildRequestBody(c, info)
			require.NoError(t, bodyErr)
			data, readErr := io.ReadAll(body)
			require.NoError(t, readErr)
			var upstream map[string]interface{}
			require.NoError(t, common.Unmarshal(data, &upstream))
			assert.Equal(t, tt.resolution, upstream["size"])
			assert.Equal(t, fmt.Sprintf("%.0f", tt.seconds), upstream["seconds"])
			assert.NotContains(t, upstream, "metadata")
			if tt.name == "object frames" {
				assert.Equal(t, []interface{}{
					map[string]interface{}{"url": "https://example.com/first.png", "role": "first_frame"},
					map[string]interface{}{"url": "https://example.com/last.png", "role": "last_frame"},
				}, upstream["reference_images"])
			}
			if tt.name == "official input video is free" {
				assert.Equal(t, []interface{}{"https://example.com/reference.mp4"}, upstream["reference_videos"])
			}
		})
	}
}

func TestWanObjectReferenceResolvesOnlyOwnedUploads(t *testing.T) {
	oldDB, oldAddress := model.DB, system_setting.ServerAddress
	db, err := gorm.Open(sqlite.Open(":memory:"), &gorm.Config{})
	require.NoError(t, err)
	require.NoError(t, db.AutoMigrate(&model.PlaygroundAsset{}))
	model.DB, system_setting.ServerAddress = db, "https://example.test"
	t.Setenv("STORAGE_BACKEND", "local")
	t.Setenv("PLAYGROUND_ASSETS_DIR", t.TempDir())
	t.Setenv("CRYPTO_SECRET", "wan-upload-reference-test")
	storage.Reset()
	t.Cleanup(func() {
		model.DB, system_setting.ServerAddress = oldDB, oldAddress
		storage.Reset()
		sqlDB, err := db.DB()
		require.NoError(t, err)
		require.NoError(t, sqlDB.Close())
	})
	asset := &model.PlaygroundAsset{UserId: 9, Kind: "image", Source: model.PlaygroundAssetSourceAttachment, Name: "frame.png", StorageKey: "uploads/9/frame.png", Backend: "local", Mime: "image/png", Size: 8}
	require.NoError(t, model.CreatePlaygroundAsset(asset))
	for _, userID := range []int{9, 10} {
		c, _ := gin.CreateTestContext(httptest.NewRecorder())
		c.Set("id", userID)
		c.Request = httptest.NewRequest(http.MethodPost, "/v1/videos", strings.NewReader(fmt.Sprintf(`{"model":"wan-3.0-video","prompt":"Animate the image","reference_images":[{"url":"file-%d"}]}`, asset.Id)))
		c.Request.Header.Set("Content-Type", "application/json")
		t.Cleanup(func() { common.CleanupBodyStorage(c) })
		info := &relaycommon.RelayInfo{OriginModelName: "wan-3.0-video", ChannelMeta: &relaycommon.ChannelMeta{UpstreamModelName: "wan-3.0-video"}, TaskRelayInfo: &relaycommon.TaskRelayInfo{}}
		a := &TaskAdaptor{}
		taskErr := a.ValidateRequestAndSetAction(c, info)
		if userID != 9 {
			require.NotNil(t, taskErr)
			assert.Equal(t, 400, taskErr.StatusCode)
			continue
		}
		require.Nil(t, taskErr)
		body, err := a.BuildRequestBody(c, info)
		require.NoError(t, err)
		data, err := io.ReadAll(body)
		require.NoError(t, err)
		var request struct {
			References []struct{ URL string } `json:"reference_images"`
		}
		require.NoError(t, common.Unmarshal(data, &request))
		require.Len(t, request.References, 1)
		assert.Contains(t, request.References[0].URL, "https://example.test")
		assert.Contains(t, request.References[0].URL, "media-fetch")
	}
}

func TestParseTaskResultKeepsCompletedMediaURL(t *testing.T) {
	result, err := (&TaskAdaptor{}).ParseTaskResult([]byte(`{
		"id":"upstream-task",
		"status":"completed",
		"progress":100,
		"metadata":{"url":"https://media.example/result.mp4?signature=test"}
	}`))

	require.NoError(t, err)
	require.Equal(t, model.TaskStatusSuccess, result.Status)
	require.Equal(t, "https://media.example/result.mp4?signature=test", result.Url)
}

func TestRemixIsRejectedOnVolcengineGateway(t *testing.T) {
	for _, tt := range []struct {
		baseURL string
		allowed bool
	}{
		{"https://www.volcengine-aigc.com.cn", false},
		{"https://api.openai.com", true},
	} {
		c, _ := gin.CreateTestContext(httptest.NewRecorder())
		c.Request = httptest.NewRequest(http.MethodPost, "/v1/videos/task_1/remix", strings.NewReader(`{"prompt":"again"}`))
		c.Request.Header.Set("Content-Type", "application/json")
		info := &relaycommon.RelayInfo{ChannelMeta: &relaycommon.ChannelMeta{ChannelBaseUrl: tt.baseURL}, TaskRelayInfo: &relaycommon.TaskRelayInfo{Action: constant.TaskActionRemix}}
		adaptor := &TaskAdaptor{}
		adaptor.Init(info)
		taskErr := adaptor.ValidateRequestAndSetAction(c, info)
		if tt.allowed {
			assert.Nil(t, taskErr, tt.baseURL)
			continue
		}
		require.NotNil(t, taskErr, tt.baseURL)
		assert.Equal(t, http.StatusBadRequest, taskErr.StatusCode)
		assert.Equal(t, "unsupported_action", taskErr.Code)
	}
}
