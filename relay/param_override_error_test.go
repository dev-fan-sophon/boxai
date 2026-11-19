package relay

import (
	"net/http"
	"testing"

	"github.com/dev-fan-sophon/boxai/common"
	relaycommon "github.com/dev-fan-sophon/boxai/relay/common"
	"github.com/dev-fan-sophon/boxai/service"
	"github.com/dev-fan-sophon/boxai/types"
	"github.com/stretchr/testify/assert"
	"github.com/stretchr/testify/require"
)

// A param override failure is a request error when the request's own value
// broke a valid condition, and a channel error when the rule itself is
// invalid and would fail every request on the channel.
func TestParamOverrideFailureClassification(t *testing.T) {
	previousAutoDisable := common.AutomaticDisableChannelEnabled
	common.AutomaticDisableChannelEnabled = true
	t.Cleanup(func() { common.AutomaticDisableChannelEnabled = previousAutoDisable })
	condition := func(mode string, value any) map[string]any {
		return map[string]any{"operations": []any{map[string]any{
			"path": "max_tokens", "mode": "set", "value": 512,
			"conditions": []any{map[string]any{"path": "temperature", "mode": mode, "value": value}},
		}}}
	}
	for _, tc := range []struct {
		name        string
		body        string
		override    map[string]any
		code        types.ErrorCode
		status      int
		wantDisable bool
	}{
		{name: "numeric rule meets a string request value", body: `{"temperature":"hot"}`, override: condition("gt", 1), code: types.ErrorCodeInvalidRequest, status: http.StatusBadRequest},
		{name: "equality rule meets a request value of another type", body: `{"temperature":"1"}`, override: condition("full", 1), code: types.ErrorCodeInvalidRequest, status: http.StatusBadRequest},
		{name: "numeric rule with a non-numeric rule value", body: `{"temperature":2}`, override: condition("gt", "1"), code: types.ErrorCodeChannelParamOverrideInvalid, status: http.StatusInternalServerError, wantDisable: true},
	} {
		t.Run(tc.name, func(t *testing.T) {
			_, err := relaycommon.ApplyParamOverride([]byte(tc.body), tc.override, nil)
			require.Error(t, err)

			apiErr := newAPIErrorFromParamOverride(err)

			assert.Equal(t, tc.code, apiErr.GetErrorCode())
			assert.Equal(t, tc.status, apiErr.StatusCode)
			assert.True(t, types.IsSkipRetryError(apiErr))
			assert.Equal(t, tc.wantDisable, service.ShouldDisableChannel(apiErr))
		})
	}
}
