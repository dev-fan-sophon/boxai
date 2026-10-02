package doubao

import (
	"fmt"
	"net/http"
	"net/http/httptest"
	"strings"
	"testing"

	"github.com/dev-fan-sophon/boxai/common"
	"github.com/dev-fan-sophon/boxai/model"
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
		{"2.5 reference", "doubao-seedance-2-5-260628", "", "", []string{"https://test/style.png"}, []string{"reference_image"}},
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

func TestNativeMetadataQuantityBounds(t *testing.T) {
	for _, field := range []string{"duration", "frames"} {
		max := relaycommon.MaxTaskDurationSeconds
		if field == "frames" {
			max *= 24
		}
		for _, value := range []any{-1, 0, max + 1, "18446744073709551615", 1.5, "invalid", 1, max, "6"} {
			t.Run(fmt.Sprintf("%s/%v", field, value), func(t *testing.T) {
				valid := value == 1 || value == max || value == "6"
				c, _ := gin.CreateTestContext(httptest.NewRecorder())
				c.Set("task_request", relaycommon.TaskSubmitReq{
					Model: "alias", Prompt: "animate", Duration: 5,
					Metadata: map[string]interface{}{field: value},
				})
				info := &relaycommon.RelayInfo{ChannelMeta: &relaycommon.ChannelMeta{
					IsModelMapped: true, UpstreamModelName: "doubao-seedance-2-0-mini-260615",
				}}
				a := &TaskAdaptor{}
				taskErr := a.ValidateMappedRequest(c, info)
				_, err := a.BuildRequestBody(c, info)
				if valid {
					require.Nil(t, taskErr)
					require.NoError(t, err)
				} else {
					require.NotNil(t, taskErr)
					assert.Equal(t, http.StatusBadRequest, taskErr.StatusCode)
					require.Error(t, err)
					assert.Nil(t, a.EstimateBilling(c, info))
				}
			})
		}
	}
}

func TestNativeMetadataPreservesParametersNotModelOrPrompt(t *testing.T) {
	for _, mapped := range []bool{false, true} {
		t.Run(fmt.Sprintf("mapped=%t", mapped), func(t *testing.T) {
			c, _ := gin.CreateTestContext(httptest.NewRecorder())
			c.Set("task_request", relaycommon.TaskSubmitReq{
				Model: "doubao-seedance-2-0-mini-260615", Prompt: "unified prompt",
				Metadata: map[string]interface{}{
					"model": "unpriced-model", "duration": 6, "frames": 144,
					"seed": 0, "generate_audio": false, "ratio": "9:16", "resolution": "1080p",
					"content": []ContentItem{{Type: "text", Text: "metadata prompt"},
						{Type: "audio_url", AudioURL: &MediaURL{URL: "https://test/audio.mp3"}}},
				},
			})
			info := &relaycommon.RelayInfo{ChannelMeta: &relaycommon.ChannelMeta{
				IsModelMapped: mapped, UpstreamModelName: "doubao-seedance-2-5-260628",
			}}
			body, err := (&TaskAdaptor{}).BuildRequestBody(c, info)
			require.NoError(t, err)
			var payload map[string]interface{}
			require.NoError(t, common.DecodeJson(body, &payload))
			wantModel := "doubao-seedance-2-0-mini-260615"
			if mapped {
				wantModel = "doubao-seedance-2-5-260628"
			}
			assert.Equal(t, wantModel, payload["model"])
			assert.Equal(t, float64(0), payload["seed"])
			assert.Equal(t, false, payload["generate_audio"])
			assert.Equal(t, float64(6), payload["duration"])
			assert.Equal(t, float64(144), payload["frames"])
			assert.Equal(t, "9:16", payload["ratio"])
			assert.Equal(t, "1080p", payload["resolution"])
			assert.Equal(t, []interface{}{
				map[string]interface{}{"type": "audio_url", "audio_url": map[string]interface{}{"url": "https://test/audio.mp3"}},
				map[string]interface{}{"type": "text", "text": "unified prompt"},
			}, payload["content"])
		})
	}
}

func TestUnifiedRequestRequiresPrompt(t *testing.T) {
	c, _ := gin.CreateTestContext(httptest.NewRecorder())
	c.Request = httptest.NewRequest(http.MethodPost, "/v1/videos", strings.NewReader(`{"model":"doubao-seedance-2-5-260628","metadata":{"content":[{"type":"text","text":"native prompt"}]}}`))
	c.Request.Header.Set("Content-Type", "application/json")
	err := (&TaskAdaptor{}).ValidateRequestAndSetAction(c, &relaycommon.RelayInfo{TaskRelayInfo: &relaycommon.TaskRelayInfo{}})
	require.NotNil(t, err)
	assert.Equal(t, http.StatusBadRequest, err.StatusCode)
}

func TestCompletedVideoUsesPublicAuthenticatedURL(t *testing.T) {
	body, err := (&TaskAdaptor{}).ConvertToOpenAIVideo(&model.Task{
		TaskID: "task_public", Status: model.TaskStatusSuccess,
		Data: []byte(`{"status":"succeeded","content":{"video_url":"https://upstream.test/v1/videos/private/content"}}`),
	})
	require.NoError(t, err)
	assert.Contains(t, string(body), "/v1/videos/task_public/content")
	assert.NotContains(t, string(body), "upstream.test")
}

func TestSeedance25ReferenceLimit(t *testing.T) {
	for _, count := range []int{30, 31} {
		req := relaycommon.TaskSubmitReq{Model: "doubao-seedance-2-5-260628", Prompt: "animate"}
		for i := 0; i < count; i++ {
			req.Images = append(req.Images, fmt.Sprintf("https://example.test/%d.png", i))
		}
		payload, err := (&TaskAdaptor{}).convertToRequestPayload(&req)
		if count == 30 {
			require.NoError(t, err)
			assert.Len(t, payload.Content, 31)
		} else {
			require.ErrorContains(t, err, "at most 30")
		}
	}
}

func TestOfficialSeedanceBillingMatchesPayload(t *testing.T) {
	for _, tt := range []struct {
		model                        string
		base, video, full, fullVideo float64
	}{
		{"doubao-seedance-2-0-mini-260615", 23, 14, 23, 14},
		{"doubao-seedance-2-0-fast-260128", 37, 22, 37, 22},
		{"doubao-seedance-2-0-260128", 46, 28, 51, 31},
		{"doubao-seedance-2-5-260628", 70, 42, 77, 46},
	} {
		for _, resolution := range []string{"720p", "1080p"} {
			for _, video := range []bool{false, true} {
				for _, typed := range []bool{false, true} {
					t.Run(fmt.Sprintf("%s/%s/video=%t/typed=%t", tt.model, resolution, video, typed), func(t *testing.T) {
						metadata := map[string]interface{}{"resolution": resolution, "model": "unpriced"}
						if video {
							if typed {
								metadata["content"] = []ContentItem{{Type: "video_url", VideoURL: &MediaURL{URL: "https://test/input.mp4"}}}
							} else {
								metadata["content"] = []interface{}{map[string]interface{}{"type": "video_url", "video_url": map[string]interface{}{"url": "https://test/input.mp4"}}}
							}
						}
						c, _ := gin.CreateTestContext(httptest.NewRecorder())
						c.Set("task_request", relaycommon.TaskSubmitReq{Model: "alias", Prompt: "animate", Size: "1920x1080", Metadata: metadata})
						info := &relaycommon.RelayInfo{ChannelMeta: &relaycommon.ChannelMeta{IsModelMapped: true, UpstreamModelName: tt.model}}
						a := &TaskAdaptor{}
						require.Nil(t, a.ValidateMappedRequest(c, info))
						body, err := a.BuildRequestBody(c, info)
						require.NoError(t, err)
						var payload requestPayload
						require.NoError(t, common.DecodeJson(body, &payload))
						assert.Equal(t, resolution, payload.Resolution)
						assert.Equal(t, tt.model, payload.Model)
						price := tt.base
						if resolution == "1080p" {
							price = tt.full
						}
						if video {
							price = tt.video
							if resolution == "1080p" {
								price = tt.fullVideo
							}
						}
						var want map[string]float64
						if price != tt.base {
							want = map[string]float64{"video_input": price / tt.base}
						}
						assert.Equal(t, want, a.EstimateBilling(c, info))
					})
				}
			}
		}
	}
	ratio, ok := GetVideoInputRatio("doubao-seedance-2-0-fast-260128", "4k", true)
	require.True(t, ok)
	assert.Equal(t, 22.0/37.0, ratio)
}

func TestCompletedVideoUsesProxyWithoutArchive(t *testing.T) {
	task := &model.Task{TaskID: "task_public", Status: model.TaskStatusSuccess, Progress: "100%", Data: []byte(`{"status":"succeeded"}`)}
	task.PrivateData.ResultURL = "https://gateway.example/v1/videos/task_private/content"
	data, err := (&TaskAdaptor{}).ConvertToOpenAIVideo(task)
	require.NoError(t, err)
	var video map[string]any
	require.NoError(t, common.Unmarshal(data, &video))
	assert.Equal(t, "completed", video["status"])
	assert.Contains(t, string(data), "/v1/videos/task_public/content")
	assert.NotContains(t, string(data), "task_private")
	assert.Equal(t, "https://gateway.example/v1/videos/task_private/content", task.GetResultURL(), "proxy retains its upstream source")
	task.OutputAssetID = 123
	data, err = (&TaskAdaptor{}).ConvertToOpenAIVideo(task)
	require.NoError(t, err)
	assert.Contains(t, string(data), "/v1/videos/task_public/content", "previously archived outputs remain usable")
}

func TestTypedReferenceMediaMapsToArkRolesAndVideoPricing(t *testing.T) {
	const upstream = "doubao-seedance-2-0-260128"
	tests := []struct {
		name      string
		req       relaycommon.TaskSubmitReq
		wantTypes []string
		wantRoles []string
		videoTier bool
		wantErr   string
	}{
		{
			name:      "image video audio references",
			req:       relaycommon.TaskSubmitReq{ReferenceImages: []string{"https://m/i.png"}, ReferenceVideos: []string{"https://m/v.mp4"}, ReferenceAudios: []string{"https://m/a.mp3"}, Metadata: map[string]interface{}{"return_last_frame": true, "seed": float64(7), "watermark": false}},
			wantTypes: []string{"image_url", "video_url", "audio_url", "text"},
			wantRoles: []string{"reference_image", "reference_video", "reference_audio", ""},
			videoTier: true,
		},
		{
			name:      "audio with image reference stays on the no-video tier",
			req:       relaycommon.TaskSubmitReq{ReferenceImages: []string{"https://m/i.png"}, ReferenceAudios: []string{"https://m/a.mp3"}},
			wantTypes: []string{"image_url", "audio_url", "text"},
			wantRoles: []string{"reference_image", "reference_audio", ""},
		},
		{name: "too many videos", req: relaycommon.TaskSubmitReq{ReferenceVideos: []string{"https://m/1", "https://m/2", "https://m/3", "https://m/4"}}, wantErr: "at most 3 reference videos"},
		{name: "too many audios", req: relaycommon.TaskSubmitReq{ReferenceImages: []string{"https://m/i"}, ReferenceAudios: []string{"https://m/1", "https://m/2", "https://m/3", "https://m/4"}}, wantErr: "at most 3 reference audios"},
		{name: "frames with reference video", req: relaycommon.TaskSubmitReq{FirstFrame: "https://m/f.png", Images: []string{"https://m/f.png"}, ReferenceVideos: []string{"https://m/v.mp4"}}, wantErr: "cannot be combined"},
	}
	for _, tt := range tests {
		t.Run(tt.name, func(t *testing.T) {
			req := tt.req
			req.Model, req.Prompt, req.Duration = upstream, "dance", 5
			c, _ := gin.CreateTestContext(httptest.NewRecorder())
			c.Set("task_request", req)
			info := &relaycommon.RelayInfo{ChannelMeta: &relaycommon.ChannelMeta{IsModelMapped: true, UpstreamModelName: upstream}}
			a := &TaskAdaptor{}
			taskErr := a.ValidateMappedRequest(c, info)
			if tt.wantErr != "" {
				require.NotNil(t, taskErr)
				assert.Contains(t, taskErr.Message, tt.wantErr)
				return
			}
			require.Nil(t, taskErr)
			body, err := a.BuildRequestBody(c, info)
			require.NoError(t, err)
			var payload requestPayload
			require.NoError(t, common.DecodeJson(body, &payload))
			require.Len(t, payload.Content, len(tt.wantTypes))
			for i, item := range payload.Content {
				assert.Equal(t, tt.wantTypes[i], item.Type)
				assert.Equal(t, tt.wantRoles[i], item.Role)
			}
			if tt.req.Metadata != nil {
				require.NotNil(t, payload.ReturnLastFrame)
				assert.True(t, bool(*payload.ReturnLastFrame))
				require.NotNil(t, payload.Seed)
				assert.Equal(t, 7, int(*payload.Seed))
				require.NotNil(t, payload.Watermark)
				assert.False(t, bool(*payload.Watermark))
			}
			ratios := a.EstimateBilling(c, info)
			if tt.videoTier {
				expected, ok := GetVideoInputRatio(upstream, "", true)
				require.True(t, ok)
				assert.Equal(t, expected, ratios["video_input"])
			} else {
				assert.NotContains(t, ratios, "video_input")
			}
		})
	}
}

func TestTypedReferenceMediaRequiresSeedance2(t *testing.T) {
	c, _ := gin.CreateTestContext(httptest.NewRecorder())
	c.Set("task_request", relaycommon.TaskSubmitReq{Model: "doubao-seedance-1-5-pro-251215", Prompt: "p", ReferenceVideos: []string{"https://m/v.mp4"}})
	info := &relaycommon.RelayInfo{ChannelMeta: &relaycommon.ChannelMeta{IsModelMapped: true, UpstreamModelName: "doubao-seedance-1-5-pro-251215"}}
	taskErr := (&TaskAdaptor{}).ValidateMappedRequest(c, info)
	require.NotNil(t, taskErr)
	assert.Equal(t, http.StatusBadRequest, taskErr.StatusCode)
}

func TestParseLastFrameIntoOpenAIVideo(t *testing.T) {
	task := &model.Task{TaskID: "task_x", Status: model.TaskStatusSuccess, Data: []byte(`{"id":"cgt-1","status":"succeeded","content":{"video_url":"https://v/out.mp4","last_frame_url":"https://v/last.png"}}`)}
	raw, err := (&TaskAdaptor{}).ConvertToOpenAIVideo(task)
	require.NoError(t, err)
	var video map[string]interface{}
	require.NoError(t, common.Unmarshal(raw, &video))
	metadata, ok := video["metadata"].(map[string]interface{})
	require.True(t, ok)
	assert.Equal(t, "https://v/last.png", metadata["last_frame_url"])
}
