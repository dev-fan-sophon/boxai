package kling

import (
	"context"
	"io"
	"net/http"
	"net/http/httptest"
	"strings"
	"testing"

	"github.com/dev-fan-sophon/boxai/common"
	"github.com/dev-fan-sophon/boxai/constant"
	"github.com/dev-fan-sophon/boxai/dto"
	"github.com/dev-fan-sophon/boxai/model"
	relaycommon "github.com/dev-fan-sophon/boxai/relay/common"
	"github.com/dev-fan-sophon/boxai/setting/ratio_setting"
	"github.com/gin-gonic/gin"
	"github.com/stretchr/testify/assert"
	"github.com/stretchr/testify/require"
)

func TestPPIOKlingLifecycle(t *testing.T) {
	prices := ratio_setting.ModelPrice2JSONString()
	t.Cleanup(func() { require.NoError(t, ratio_setting.UpdateModelPriceByJSONString(prices)) })
	require.NoError(t, ratio_setting.UpdateModelPriceByJSONString(`{"ppio-kling-3.0":0.12}`))
	server := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		assert.Equal(t, http.MethodGet, r.Method)
		assert.Equal(t, "/v3/kling/tasks", r.URL.Path)
		assert.Equal(t, "954505224193459620", r.URL.Query().Get("task_ids"))
		assert.Equal(t, "Bearer plain-ppio-key", r.Header.Get("Authorization"))
		_, err := io.WriteString(w, `{"code":0,"data":[{"id":"954505224193459620","status":"succeeded","outputs":[{"type":"video","url":"https://example.com/video.mp4","duration":"5.041"}]}]}`)
		assert.NoError(t, err)
	}))
	t.Cleanup(server.Close)
	info := &relaycommon.RelayInfo{OriginModelName: "ppio-kling-3.0", TaskRelayInfo: &relaycommon.TaskRelayInfo{PublicTaskID: "task_public"},
		ChannelMeta: &relaycommon.ChannelMeta{ChannelBaseUrl: server.URL + "/v3/kling", ApiKey: "plain-ppio-key", UpstreamModelName: "kling-3.0"}}
	adaptor := &TaskAdaptor{}
	adaptor.Init(info)
	w := httptest.NewRecorder()
	c, _ := gin.CreateTestContext(w)
	c.Set("task_request", relaycommon.TaskSubmitReq{Model: "ppio-kling-3.0", Prompt: "A yellow sailboat on a pond", Duration: 5, Size: "1280x720"})
	require.Nil(t, adaptor.ValidateMappedRequest(c, info))
	body, err := adaptor.BuildRequestBody(c, info)
	require.NoError(t, err)
	var payload map[string]any
	require.NoError(t, common.DecodeJson(body, &payload))
	assert.Equal(t, map[string]any{"prompt": "A yellow sailboat on a pond", "settings": map[string]any{"resolution": "720p", "duration": float64(5), "audio": "off"}}, payload)
	assert.Equal(t, map[string]float64{"seconds": 5}, adaptor.EstimateBilling(c, info))
	requestURL, err := adaptor.BuildRequestURL(info)
	require.NoError(t, err)
	assert.Equal(t, server.URL+"/v3/kling/text-to-video/kling-3.0", requestURL)
	req, err := http.NewRequest(http.MethodPost, requestURL, nil)
	require.NoError(t, err)
	require.NoError(t, adaptor.BuildRequestHeader(c, req, info))
	assert.Equal(t, "Bearer plain-ppio-key", req.Header.Get("Authorization"))
	id, _, taskErr := adaptor.DoResponse(c, &http.Response{StatusCode: 200, Body: io.NopCloser(strings.NewReader(`{"code":0,"data":{"id":"954505224193459620","status":"submitted"}}`))}, info)
	require.Nil(t, taskErr)
	assert.Equal(t, "954505224193459620", id)
	assert.Contains(t, w.Body.String(), "task_public")
	assert.NotContains(t, w.Body.String(), id)
	// Polling must also work with a fresh adaptor after process restart.
	fresh := &TaskAdaptor{}
	resp, err := fresh.FetchTaskWithContext(context.Background(), server.URL+"/v3/kling", "plain-ppio-key", map[string]any{"task_id": id, "action": constant.TaskActionGenerate}, "")
	require.NoError(t, err)
	defer resp.Body.Close()
	data, err := io.ReadAll(resp.Body)
	require.NoError(t, err)
	result, err := fresh.ParseTaskResult(data)
	require.NoError(t, err)
	assert.Equal(t, model.TaskStatusSuccess, result.Status)
	assert.Equal(t, "https://example.com/video.mp4", result.Url)
	encoded, err := fresh.ConvertToOpenAIVideo(&model.Task{TaskID: "task_public", Data: data, Status: model.TaskStatusSuccess, Properties: model.Properties{UpstreamModelName: "kling-3.0"}})
	require.NoError(t, err)
	var video dto.OpenAIVideo
	require.NoError(t, common.Unmarshal(encoded, &video))
	assert.Equal(t, "task_public", video.ID)
	assert.Equal(t, "5.041", video.Seconds)
}

func TestPPIOKlingRejectsUnverifiedOrUnsafeRequests(t *testing.T) {
	for _, body := range []string{
		`{"prompt":"boat","duration":6}`, `{"prompt":"boat","seconds":"-1"}`,
		`{"prompt":"boat","size":"3840x2160"}`, `{"prompt":"boat","image":"https://example.com/image.jpg"}`,
		`{"prompt":"boat","metadata":{"settings":{"duration":999999999}}}`,
		`{"prompt":"boat","metadata":{"generate_audio":true}}`, `{"prompt":"boat","metadata":{"resolution":"1080p"}}`,
	} {
		t.Run(body, func(t *testing.T) {
			c, _ := gin.CreateTestContext(httptest.NewRecorder())
			var req relaycommon.TaskSubmitReq
			require.NoError(t, common.UnmarshalJsonStr(body, &req))
			c.Set("task_request", req)
			info := &relaycommon.RelayInfo{ChannelMeta: &relaycommon.ChannelMeta{ChannelBaseUrl: "https://api.ppio.com/v3/kling", UpstreamModelName: "kling-3.0"}}
			a := &TaskAdaptor{}
			a.Init(info)
			require.NotNil(t, a.ValidateMappedRequest(c, info))
			_, err := a.BuildRequestBody(c, info)
			require.Error(t, err)
		})
	}
	for _, response := range []string{
		`{"code":0,"data":[]}`, `{"code":1,"message":"denied","data":[]}`,
		`{"code":0,"data":[{"id":"123","status":"succeeded","outputs":[]}]}`,
	} {
		_, err := (&TaskAdaptor{}).ParseTaskResult([]byte(response))
		require.Error(t, err)
	}
	result, err := (&TaskAdaptor{}).ParseTaskResult([]byte(`{"code":0,"data":[{"id":"123","status":"failed","message":"content rejected"}]}`))
	require.NoError(t, err)
	assert.Equal(t, model.TaskStatusFailure, result.Status)
	assert.Equal(t, "content rejected", result.Reason)
	legacy, err := (&TaskAdaptor{}).ParseTaskResult([]byte(`{"code":0,"data":{"task_id":"old","task_status":"succeed","task_result":{"videos":[{"url":"https://example.com/old.mp4"}]}}}`))
	require.NoError(t, err)
	assert.Equal(t, "https://example.com/old.mp4", legacy.Url)
}
