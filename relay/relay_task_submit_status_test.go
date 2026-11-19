package relay

import (
	"net/http"
	"net/http/httptest"
	"strconv"
	"strings"
	"testing"

	"github.com/dev-fan-sophon/boxai/common"
	"github.com/dev-fan-sophon/boxai/constant"
	"github.com/dev-fan-sophon/boxai/dto"
	relaycommon "github.com/dev-fan-sophon/boxai/relay/common"
	"github.com/dev-fan-sophon/boxai/service"
	"github.com/dev-fan-sophon/boxai/setting/ratio_setting"
	"github.com/gin-gonic/gin"
	"github.com/stretchr/testify/assert"
	"github.com/stretchr/testify/require"
)

// Task APIs may answer 201 Created or 202 Accepted on submission. Every 2xx
// must reach the adaptor's DoResponse; other statuses stay upstream failures.
func TestRelayTaskSubmitAcceptsAnySuccessfulUpstreamStatus(t *testing.T) {
	service.InitHttpClient()
	previousPrices := ratio_setting.ModelPrice2JSONString()
	require.NoError(t, ratio_setting.UpdateModelPriceByJSONString(`{"viduq1":0.1}`))
	t.Cleanup(func() { require.NoError(t, ratio_setting.UpdateModelPriceByJSONString(previousPrices)) })

	for _, tc := range []struct {
		status  int
		wantErr bool
	}{
		{status: http.StatusOK},
		{status: http.StatusCreated},
		{status: http.StatusAccepted},
		{status: http.StatusBadRequest, wantErr: true},
		{status: http.StatusBadGateway, wantErr: true},
	} {
		t.Run(strconv.Itoa(tc.status), func(t *testing.T) {
			server := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, _ *http.Request) {
				w.Header().Set("Content-Type", "application/json")
				w.WriteHeader(tc.status)
				_, _ = w.Write([]byte(`{"task_id":"job-42","state":"created","message":"upstream body"}`))
			}))
			defer server.Close()

			c, _ := gin.CreateTestContext(httptest.NewRecorder())
			body := `{"model":"viduq1","prompt":"animate","duration":5}`
			c.Request = httptest.NewRequest(http.MethodPost, "/v1/video/generations", strings.NewReader(body))
			c.Request.Header.Set("Content-Type", "application/json")
			common.SetContextKey(c, constant.ContextKeyChannelType, constant.ChannelTypeVidu)
			common.SetContextKey(c, constant.ContextKeyChannelBaseUrl, server.URL)
			common.SetContextKey(c, constant.ContextKeyChannelKey, "test-key")
			common.SetContextKey(c, constant.ContextKeyChannelSetting, dto.ChannelSettings{})
			info := &relaycommon.RelayInfo{
				OriginModelName: "viduq1",
				TaskRelayInfo:   &relaycommon.TaskRelayInfo{},
				// An existing reservation skips pre-consume so the fixture reaches the upstream call.
				Billing: &fakeTaskReservation{limit: 1 << 30},
			}

			result, taskErr := RelayTaskSubmit(c, info)
			if tc.wantErr {
				require.NotNil(t, taskErr)
				assert.Equal(t, tc.status, taskErr.StatusCode)
				assert.Nil(t, result)
				return
			}
			require.Nil(t, taskErr, "submission error: %+v", taskErr)
			require.NotNil(t, result)
			assert.Equal(t, "job-42", result.UpstreamTaskID)
		})
	}
}
