package hailuo

import (
	"io"
	"net/http"
	"net/http/httptest"
	"strings"
	"testing"

	"github.com/dev-fan-sophon/boxai/common"
	"github.com/dev-fan-sophon/boxai/constant"
	"github.com/dev-fan-sophon/boxai/dto"
	"github.com/dev-fan-sophon/boxai/model"
	"github.com/dev-fan-sophon/boxai/relay/channel"
	relaycommon "github.com/dev-fan-sophon/boxai/relay/common"
	"github.com/dev-fan-sophon/boxai/service"
	"github.com/dev-fan-sophon/boxai/setting/ratio_setting"
	"github.com/gin-gonic/gin"
	"github.com/stretchr/testify/assert"
	"github.com/stretchr/testify/require"
)

// The H3 success payload mirrors the real PPIO 768P/4s task. Other statuses
// and generate_audio=false check documented protocol behavior, not live tests.
func TestVideoAdaptorContracts(t *testing.T) {
	gin.SetMode(gin.TestMode)
	service.InitHttpClient()
	prices := ratio_setting.ModelPrice2JSONString()
	t.Cleanup(func() { require.NoError(t, ratio_setting.UpdateModelPriceByJSONString(prices)) })
	// Test-only prices exercise configuration plumbing, not provider pricing.
	require.NoError(t, ratio_setting.UpdateModelPriceByJSONString(`{"MiniMax-H3":0.123,"public-video":0.123}`))

	const success = `{"task":{"id":"upstream-123","status":"succeeded","content":{"url":"https://cdn.example/video.mp4"},"usage":{"total_tokens":130196,"completion_tokens":130196,"output_seconds":4,"total_seconds":4},"duration":4,"resolution":"768P","ratio":"16:9"}}`
	const h3Body = `{"model":"MiniMax-H3","content":[{"type":"text","text":"A toy sailboat"}],"resolution":"768P","duration":4,"ratio":"16:9"}`
	tests := []struct {
		name       string
		request    string
		upstream   string
		origin     string
		basePath   string
		submit     string
		submitCode int
		poll       string
		wantBody   string
		status     string
		errStage   string
		legacy     bool
	}{
		{name: "PPIO live shape", request: `{"prompt":"A toy sailboat","duration":4,"size":"768P","metadata":{"resolution":"768P","ratio":"16:9"}}`, basePath: "/v3/minimax"},
		{name: "native host independent defaults"},
		{name: "mapped public alias", origin: "public-video"},
		{name: "seconds alias", request: `{"prompt":"A toy sailboat","seconds":"4","size":"1344x768"}`},
		{name: "studio 768p contract", request: `{"prompt":"A toy sailboat","duration":4,"size":"1344x768","metadata":{"resolution":"768p","ratio":"16:9"}}`},
		{name: "optional false preserved", request: `{"prompt":"A toy sailboat","metadata":{"generate_audio":false,"duration":4}}`, wantBody: `{"model":"MiniMax-H3","content":[{"type":"text","text":"A toy sailboat"}],"resolution":"768P","duration":4,"ratio":"16:9","generate_audio":false}`},
		{name: "legacy v1 file retrieval", legacy: true, upstream: "MiniMax-Hailuo-2.3", submit: `{"task_id":"upstream-123","base_resp":{"status_code":0}}`, poll: `{"task_id":"upstream-123","status":"Success","file_id":"file-123","base_resp":{"status_code":0}}`, wantBody: `{"model":"MiniMax-Hailuo-2.3","prompt":"A toy sailboat","duration":6,"resolution":"768P","prompt_optimizer":false}`, request: `{"prompt":"A toy sailboat","metadata":{"prompt_optimizer":false}}`},
		{name: "unverified variant rejected", upstream: "MiniMax-H3-Max", errStage: "validation"},
		{name: "unverified highspeed rejected", upstream: "MiniMax-H3-Highspeed", errStage: "validation"},
		{name: "requires explicit per second price", origin: "unpriced-video", errStage: "validation"},
		{name: "metadata duration huge", request: `{"prompt":"A toy sailboat","metadata":{"duration":18446744073686646784}}`, errStage: "validation"},
		{name: "metadata duration above bound", request: `{"prompt":"A toy sailboat","metadata":{"duration":3601}}`, errStage: "validation"},
		{name: "metadata zero not omitted", request: `{"prompt":"A toy sailboat","metadata":{"duration":0}}`, errStage: "validation"},
		{name: "metadata null rejected", request: `{"prompt":"A toy sailboat","metadata":{"duration":null}}`, errStage: "validation"},
		{name: "conflicting seconds rejected", request: `{"prompt":"A toy sailboat","duration":15,"seconds":"4"}`, errStage: "validation"},
		{name: "unverified resolution rejected", request: `{"prompt":"A toy sailboat","metadata":{"resolution":"2K"}}`, errStage: "validation"},
		{name: "reference image rejected", request: `{"prompt":"A toy sailboat","reference_images":["https://example/image.png"]}`, errStage: "validation"},
		{name: "frame alias rejected", request: `{"prompt":"A toy sailboat","last_frame":"https://example/image.png"}`, errStage: "validation"},
		{name: "v1 metadata rejected", request: `{"prompt":"A toy sailboat","metadata":{"first_frame_image":"https://example/image.png"}}`, errStage: "validation"},
		{name: "content bypass rejected", request: `{"prompt":"A toy sailboat","metadata":{"content":[{"type":"video_url","video_url":{"url":"https://example/video.mp4"}}]}}`, errStage: "validation"},
		{name: "model override rejected", request: `{"prompt":"A toy sailboat","metadata":{"model":"MiniMax-H3-Max"}}`, errStage: "validation"},
		{name: "submit error with zero base resp", submitCode: 401, submit: `{"error":{"type":"authorized_error","message":"bad key","http_code":"401"},"base_resp":{"status_code":0}}`, errStage: "submit"},
		{name: "submit empty response not success", submit: `{}`, errStage: "submit"},
		{name: "submit nonzero base resp", submit: `{"task_id":"upstream-123","base_resp":{"status_code":1008,"status_msg":"no balance"}}`, errStage: "submit"},
		{name: "queued", poll: `{"task":{"id":"upstream-123","status":"queued"}}`, status: model.TaskStatusQueued},
		{name: "running", poll: `{"task":{"id":"upstream-123","status":"running"}}`, status: model.TaskStatusInProgress},
		{name: "failed", poll: `{"task":{"id":"upstream-123","status":"failed","error":{"code":"1026","message":"sensitive content"}}}`, status: model.TaskStatusFailure},
		{name: "cancelled", poll: `{"task":{"id":"upstream-123","status":"cancelled"}}`, status: model.TaskStatusFailure},
		{name: "poll error beats zero base resp", poll: `{"error":{"type":"bad_request_error","message":"invalid task"},"base_resp":{"status_code":0}}`, errStage: "poll"},
		{name: "poll empty not success", poll: `{}`, errStage: "poll"},
		{name: "poll missing result URL", poll: `{"task":{"id":"upstream-123","status":"succeeded"}}`, errStage: "poll"},
		{name: "poll unknown status", poll: `{"task":{"id":"upstream-123","status":"unknown"}}`, errStage: "poll"},
	}
	for _, tt := range tests {
		t.Run(tt.name, func(t *testing.T) {
			if tt.upstream == "" {
				tt.upstream = "MiniMax-H3"
			}
			if tt.origin == "" {
				tt.origin = tt.upstream
			}
			if tt.request == "" {
				tt.request = `{"prompt":"A toy sailboat"}`
			}
			if tt.submit == "" {
				tt.submit = `{"task_id":"upstream-123"}`
			}
			if tt.submitCode == 0 {
				tt.submitCode = 200
			}
			if tt.poll == "" {
				tt.poll = success
			}
			if tt.wantBody == "" {
				tt.wantBody = h3Body
			}
			if tt.status == "" {
				tt.status = model.TaskStatusSuccess
			}
			var receivedBody string
			var paths []string
			server := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
				paths = append(paths, r.URL.RequestURI())
				assert.Equal(t, "Bearer test-key", r.Header.Get("Authorization"))
				w.Header().Set("Content-Type", "application/json")
				if r.Method == http.MethodPost {
					data, err := io.ReadAll(r.Body)
					assert.NoError(t, err)
					receivedBody = string(data)
					w.WriteHeader(tt.submitCode)
					_, _ = io.WriteString(w, tt.submit)
				} else if strings.Contains(r.URL.Path, "/files/retrieve") {
					_, _ = io.WriteString(w, `{"file":{"download_url":"https://cdn.example/video.mp4"},"base_resp":{"status_code":0}}`)
				} else {
					_, _ = io.WriteString(w, tt.poll)
				}
			}))
			defer server.Close()
			baseURL := server.URL + tt.basePath
			info := &relaycommon.RelayInfo{
				ChannelMeta:   &relaycommon.ChannelMeta{ChannelBaseUrl: baseURL, ApiKey: "test-key", UpstreamModelName: tt.upstream},
				TaskRelayInfo: &relaycommon.TaskRelayInfo{PublicTaskID: "task_public"}, OriginModelName: tt.origin,
			}
			c, _ := gin.CreateTestContext(httptest.NewRecorder())
			c.Request = httptest.NewRequest(http.MethodPost, "/v1/videos", strings.NewReader(tt.request))
			c.Request.Header.Set("Content-Type", "application/json")
			var adaptor channel.TaskAdaptor = &TaskAdaptor{}
			adaptor.Init(info)
			validationErr := adaptor.ValidateRequestAndSetAction(c, info)
			if validationErr == nil {
				validationErr = adaptor.(channel.MappedTaskRequestValidator).ValidateMappedRequest(c, info)
			}
			if tt.errStage == "validation" {
				require.NotNil(t, validationErr)
				assert.Equal(t, 400, validationErr.StatusCode)
				_, bodyErr := adaptor.BuildRequestBody(c, info)
				if tt.origin != "unpriced-video" {
					assert.Error(t, bodyErr, "serialization must also reject metadata bypasses")
				}
				return
			}
			require.Nil(t, validationErr)
			if tt.legacy {
				assert.Nil(t, adaptor.EstimateBilling(c, info))
			} else {
				assert.Equal(t, map[string]float64{"seconds": 4}, adaptor.EstimateBilling(c, info))
			}
			body, err := adaptor.BuildRequestBody(c, info)
			require.NoError(t, err)
			response, err := adaptor.DoRequest(c, info, body)
			require.NoError(t, err)
			assert.JSONEq(t, tt.wantBody, receivedBody)
			id, data, submitErr := adaptor.DoResponse(c, response, info)
			if tt.errStage == "submit" {
				require.NotNil(t, submitErr)
				assert.Empty(t, id)
				return
			}
			require.Nil(t, submitErr)
			assert.Equal(t, "upstream-123", id)
			task := &model.Task{TaskID: "task_public", Status: model.TaskStatusSubmitted, Action: info.Action, Data: data, Properties: model.Properties{OriginModelName: tt.origin, UpstreamModelName: tt.upstream}}
			_, err = adaptor.(channel.OpenAIVideoConverter).ConvertToOpenAIVideo(task)
			require.NoError(t, err, "submit data must be readable before first poll")
			// Production polling creates a fresh adaptor without a model. Only
			// persisted action and upstream task ID are provided to FetchTask.
			var poller channel.TaskAdaptor = &TaskAdaptor{}
			poller.Init(&relaycommon.RelayInfo{ChannelMeta: &relaycommon.ChannelMeta{ChannelBaseUrl: baseURL, ApiKey: "test-key"}})
			response, err = poller.FetchTask(baseURL, "test-key", map[string]any{"task_id": id, "action": info.Action}, "")
			require.NoError(t, err)
			pollData, err := io.ReadAll(response.Body)
			require.NoError(t, err)
			require.NoError(t, response.Body.Close())
			result, err := poller.ParseTaskResult(pollData)
			if tt.errStage == "poll" {
				require.Error(t, err)
				return
			}
			require.NoError(t, err)
			assert.Equal(t, tt.status, result.Status)
			if tt.status == model.TaskStatusSuccess {
				assert.Equal(t, "https://cdn.example/video.mp4", result.Url)
				if !tt.legacy {
					assert.Equal(t, 130196, result.TotalTokens)
					assert.Equal(t, 130196, result.CompletionTokens)
				}
			}
			task.Data, task.Status, task.Progress = pollData, model.TaskStatus(result.Status), result.Progress
			converted, err := poller.(channel.OpenAIVideoConverter).ConvertToOpenAIVideo(task)
			require.NoError(t, err)
			var video dto.OpenAIVideo
			require.NoError(t, common.Unmarshal(converted, &video))
			assert.Equal(t, "task_public", video.ID)
			assert.Equal(t, tt.origin, video.Model)
			assert.Equal(t, task.Status.ToVideoStatus(), video.Status)
			if tt.status == model.TaskStatusSuccess && !tt.legacy {
				assert.Equal(t, "https://cdn.example/video.mp4", video.Metadata["url"])
				assert.Equal(t, "4", video.Seconds)
				assert.Equal(t, Resolution768P, video.Size)
				task.OutputAssetID = 99
				converted, err = poller.(channel.OpenAIVideoConverter).ConvertToOpenAIVideo(task)
				require.NoError(t, err)
				require.NoError(t, common.Unmarshal(converted, &video))
				assert.Equal(t, "/v1/videos/task_public/content", video.Metadata["url"], "durable public output must win over the expiring upstream URL")
			}
			if tt.status == model.TaskStatusFailure && !tt.legacy {
				require.NotNil(t, video.Error)
				assert.NotEmpty(t, video.Error.Message)
			}
			if tt.legacy {
				assert.Equal(t, constant.TaskActionGenerate, info.Action)
				assert.Equal(t, []string{"/v1/video_generation", "/v1/query/video_generation?task_id=upstream-123", "/v1/files/retrieve?file_id=file-123"}, paths)
			} else {
				assert.Equal(t, []string{tt.basePath + "/v2/video_generation", tt.basePath + "/v2/query/video_generation/upstream-123"}, paths)
			}
		})
	}
}
