package sora

import (
	"net/http"
	"net/http/httptest"
	"strings"
	"testing"

	"github.com/dev-fan-sophon/boxai/constant"
	"github.com/dev-fan-sophon/boxai/model"
	relaycommon "github.com/dev-fan-sophon/boxai/relay/common"
	"github.com/gin-gonic/gin"
	"github.com/stretchr/testify/assert"
	"github.com/stretchr/testify/require"
)

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
