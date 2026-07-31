package xai

import (
	"io"
	"net/http"
	"net/http/httptest"
	"strings"
	"testing"

	"github.com/dev-fan-sophon/boxai/common"
	"github.com/dev-fan-sophon/boxai/model"
	relaycommon "github.com/dev-fan-sophon/boxai/relay/common"
	"github.com/dev-fan-sophon/boxai/service"
	"github.com/gin-gonic/gin"
	"github.com/stretchr/testify/assert"
	"github.com/stretchr/testify/require"
)

func requestContext(t *testing.T, body string) (*gin.Context, *relaycommon.RelayInfo) {
	t.Helper()
	gin.SetMode(gin.TestMode)
	c, _ := gin.CreateTestContext(httptest.NewRecorder())
	c.Request = httptest.NewRequest(http.MethodPost, "/pg/video/generations", strings.NewReader(body))
	c.Request.Header.Set("Content-Type", "application/json")
	return c, &relaycommon.RelayInfo{ChannelMeta: &relaycommon.ChannelMeta{}, TaskRelayInfo: &relaycommon.TaskRelayInfo{}}
}

func TestValidateRequestConstraints(t *testing.T) {
	tests := []struct {
		name, body string
		valid      bool
	}{
		{"minimum duration", `{"model":"grok-imagine-video","prompt":"p","duration":1}`, true},
		{"maximum duration", `{"model":"grok-imagine-video","prompt":"p","duration":15}`, true},
		{"zero duration", `{"model":"grok-imagine-video","prompt":"p","duration":0}`, false},
		{"too long", `{"model":"grok-imagine-video","prompt":"p","duration":16}`, false},
		{"1.5 needs image", `{"model":"grok-imagine-video-1.5","prompt":"p","duration":8}`, false},
		{"1.5 image", `{"model":"grok-imagine-video-1.5","prompt":"p","duration":8,"image":"data:image/png;base64,AA"}`, true},
		{"base rejects 1080p", `{"model":"grok-imagine-video","prompt":"p","duration":8,"size":"1920x1080","image":"https://img.test/a.png"}`, false},
		{"1.5 accepts 1080p image", `{"model":"grok-imagine-video-1.5","prompt":"p","duration":8,"size":"1920x1080","input_reference":"https://img.test/a.png"}`, true},
		{"unknown size", `{"model":"grok-imagine-video","prompt":"p","duration":8,"size":"1024x1024"}`, false},
	}
	for _, tt := range tests {
		t.Run(tt.name, func(t *testing.T) {
			c, info := requestContext(t, tt.body)
			err := (&TaskAdaptor{}).ValidateRequestAndSetAction(c, info)
			if tt.valid {
				require.Nil(t, err)
			} else {
				require.NotNil(t, err)
			}
		})
	}
}

func TestValidateMappedRequestUsesUpstreamModel(t *testing.T) {
	c, info := requestContext(t, `{"model":"video-alias","prompt":"p","duration":8}`)
	require.Nil(t, (&TaskAdaptor{}).ValidateRequestAndSetAction(c, info))

	info.UpstreamModelName = modelImagine15
	taskErr := (&TaskAdaptor{}).ValidateMappedRequest(c, info)
	require.NotNil(t, taskErr)
	require.Contains(t, taskErr.Message, "requires an image")

	info.UpstreamModelName = "unsupported-video-model"
	taskErr = (&TaskAdaptor{}).ValidateMappedRequest(c, info)
	require.NotNil(t, taskErr)
	require.Contains(t, taskErr.Message, "unsupported xAI video model")
}

func TestBuildRequestUsesMappedModelAndJSONProtocol(t *testing.T) {
	c, info := requestContext(t, `{"model":"client-alias","prompt":"animate","duration":8,"size":"720x1280","images":["https://img.test/a.png"]}`)
	adaptor := &TaskAdaptor{}
	require.Nil(t, adaptor.ValidateRequestAndSetAction(c, info))
	info.UpstreamModelName = modelImagine15
	body, err := adaptor.BuildRequestBody(c, info)
	require.NoError(t, err)
	b, err := io.ReadAll(body)
	require.NoError(t, err)
	var got videoRequest
	require.NoError(t, common.Unmarshal(b, &got))
	assert.Equal(t, modelImagine15, got.Model)
	assert.Equal(t, "9:16", got.AspectRatio)
	assert.Equal(t, "720p", got.Resolution)
	require.NotNil(t, got.Image)
	assert.Equal(t, "https://img.test/a.png", got.Image.URL)

	adaptor.Init(&relaycommon.RelayInfo{ChannelMeta: &relaycommon.ChannelMeta{ApiKey: "secret", ChannelBaseUrl: "https://api.x.ai/"}})
	url, err := adaptor.BuildRequestURL(info)
	require.NoError(t, err)
	assert.Equal(t, "https://api.x.ai/v1/videos/generations", url)
	req := httptest.NewRequest(http.MethodPost, url, nil)
	require.NoError(t, adaptor.BuildRequestHeader(c, req, info))
	assert.Equal(t, "Bearer secret", req.Header.Get("Authorization"))
	assert.Equal(t, "application/json", req.Header.Get("Content-Type"))
}

func TestBillingRatios(t *testing.T) {
	tests := []struct {
		model, size string
		resolution  float64
	}{
		{modelImagine, "", 1.4}, {modelImagine, "1280x720", 1.4},
		{modelImagine15, "720x1280", 1.75}, {modelImagine15, "1920x1080", 3.125},
	}
	for _, tt := range tests {
		c, info := requestContext(t, `{"model":"`+tt.model+`","prompt":"p","duration":8,"size":"`+tt.size+`","image":"https://img.test/a"}`)
		a := &TaskAdaptor{}
		require.Nil(t, a.ValidateRequestAndSetAction(c, info))
		info.UpstreamModelName = tt.model
		ratios := a.EstimateBilling(c, info)
		assert.Equal(t, 8.0, ratios["seconds"])
		assert.Equal(t, tt.resolution, ratios["resolution"])
	}
}

func TestSubmitAndPollHTTPProtocol(t *testing.T) {
	service.InitHttpClient()
	var method, path, auth string
	server := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		method, path, auth = r.Method, r.URL.Path, r.Header.Get("Authorization")
		w.Header().Set("Content-Type", "application/json")
		_, _ = w.Write([]byte(`{"status":"done","video":{"url":"https://video.test/v.mp4","duration":8}}`))
	}))
	defer server.Close()
	a := &TaskAdaptor{}
	resp, err := a.FetchTask(server.URL, "key", map[string]any{"task_id": "req_123"}, "")
	require.NoError(t, err)
	require.NoError(t, resp.Body.Close())
	assert.Equal(t, http.MethodGet, method)
	assert.Equal(t, "/v1/videos/req_123", path)
	assert.Equal(t, "Bearer key", auth)

	c, info := requestContext(t, `{}`)
	info.PublicTaskID, info.OriginModelName = "task_public", modelImagine
	response := &http.Response{Body: io.NopCloser(strings.NewReader(`{"request_id":"req_123"}`))}
	id, data, taskErr := a.DoResponse(c, response, info)
	require.Nil(t, taskErr)
	assert.Equal(t, "req_123", id)
	assert.JSONEq(t, `{"request_id":"req_123"}`, string(data))
}

func TestFetchTaskHandlesHTTPFailures(t *testing.T) {
	service.InitHttpClient()
	tests := []struct {
		name       string
		statusCode int
		body       string
		retryable  bool
	}{
		{"forbidden", http.StatusForbidden, `{"error":{"message":"permission denied"}}`, false},
		{"rate limited", http.StatusTooManyRequests, `{}`, true},
		{"server error", http.StatusServiceUnavailable, `{}`, true},
	}
	for _, tt := range tests {
		t.Run(tt.name, func(t *testing.T) {
			server := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, _ *http.Request) {
				w.WriteHeader(tt.statusCode)
				_, _ = w.Write([]byte(tt.body))
			}))
			defer server.Close()

			resp, err := (&TaskAdaptor{}).FetchTask(server.URL, "key", map[string]any{"task_id": "req_123"}, "")
			if tt.retryable {
				require.Error(t, err)
				require.Nil(t, resp)
				return
			}
			require.NoError(t, err)
			defer resp.Body.Close()
			body, err := io.ReadAll(resp.Body)
			require.NoError(t, err)
			result, err := (&TaskAdaptor{}).ParseTaskResult(body)
			require.NoError(t, err)
			assert.Equal(t, string(model.TaskStatusFailure), result.Status)
			assert.Equal(t, "permission denied", result.Reason)
		})
	}
}

func TestParseTaskResult(t *testing.T) {
	tests := []struct {
		name, body  string
		status      model.TaskStatus
		reason, url string
	}{
		{"pending", `{"status":"pending"}`, model.TaskStatusQueued, "", ""},
		{"done", `{"status":"done","video":{"url":"https://video.test/v.mp4","duration":8,"respect_moderation":true}}`, model.TaskStatusSuccess, "", "https://video.test/v.mp4"},
		{"done without video", `{"status":"done"}`, model.TaskStatusFailure, "xAI video task completed without a video URL", ""},
		{"done with blank URL", `{"status":"done","video":{"url":"  "}}`, model.TaskStatusFailure, "xAI video task completed without a video URL", ""},
		{"done but blocked by moderation", `{"status":"done","video":{"url":"https://video.test/rejected.mp4","respect_moderation":false}}`, model.TaskStatusFailure, "xAI video task was blocked by moderation", ""},
		{"failed", `{"status":"failed","error":{"code":"moderation","message":"rejected"}}`, model.TaskStatusFailure, "rejected", ""},
		{"expired", `{"status":"expired"}`, model.TaskStatusFailure, "xAI video task expired", ""},
		{"unknown status", `{"status":"new_state"}`, model.TaskStatusFailure, `unknown xAI video task status "new_state"`, ""},
		{"error without status", `{"error":{"code":"permission_denied","message":"denied"}}`, model.TaskStatusFailure, "denied", ""},
	}
	for _, tt := range tests {
		t.Run(tt.name, func(t *testing.T) {
			result, err := (&TaskAdaptor{}).ParseTaskResult([]byte(tt.body))
			require.NoError(t, err)
			assert.Equal(t, string(tt.status), result.Status)
			assert.Equal(t, tt.reason, result.Reason)
			assert.Equal(t, tt.url, result.Url)
		})
	}
}

func TestConvertToOpenAIVideoPreservesPublicIDAndUsesAuthenticatedProxy(t *testing.T) {
	task := &model.Task{TaskID: "task_public", Status: model.TaskStatusSuccess, Progress: "100%", CreatedAt: 10, FinishTime: 20, Properties: model.Properties{OriginModelName: modelImagine}, PrivateData: model.TaskPrivateData{ResultURL: "https://video.test/v.mp4"}, Data: []byte(`{"status":"done","video":{"url":"https://video.test/v.mp4","duration":8,"respect_moderation":true}}`)}
	b, err := (&TaskAdaptor{}).ConvertToOpenAIVideo(task)
	require.NoError(t, err)
	var got map[string]any
	require.NoError(t, common.Unmarshal(b, &got))
	assert.Equal(t, "task_public", got["id"])
	assert.Equal(t, "completed", got["status"])
	assert.Equal(t, "8", got["seconds"])
	assert.Contains(t, got["metadata"].(map[string]any)["url"], "/v1/videos/task_public/content")
}

func TestConvertToOpenAIVideoUsesPersistedFailureReason(t *testing.T) {
	task := &model.Task{
		TaskID:     "task_public",
		Status:     model.TaskStatusFailure,
		FailReason: "completed without a URL",
		Properties: model.Properties{OriginModelName: modelImagine},
		PrivateData: model.TaskPrivateData{
			ResultURL: "https://video.test/rejected.mp4",
		},
	}
	b, err := (&TaskAdaptor{}).ConvertToOpenAIVideo(task)
	require.NoError(t, err)
	var got map[string]any
	require.NoError(t, common.Unmarshal(b, &got))
	assert.Equal(t, "completed without a URL", got["error"].(map[string]any)["message"])
	metadata, _ := got["metadata"].(map[string]any)
	assert.NotContains(t, metadata, "url")
}
