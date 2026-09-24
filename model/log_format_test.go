package model

import (
	"testing"

	"github.com/dev-fan-sophon/boxai/common"

	"github.com/stretchr/testify/assert"
	"github.com/stretchr/testify/require"
)

// TestFormatUserLogsStripsQuotaSaturation verifies the admin-only quota
// saturation marker (nested under other.admin_info) is removed for non-admin
// log views, since formatUserLogs strips the whole admin_info object.
func TestFormatUserLogsStripsQuotaSaturation(t *testing.T) {
	other := common.MapToJsonStr(map[string]interface{}{
		"model_price": 0.004,
		"admin_info": map[string]interface{}{
			"quota_saturation": map[string]interface{}{
				"op":      "QuotaFromDecimal",
				"kind":    "overflow",
				"clamped": common.MaxQuota,
			},
		},
	})
	logs := []*Log{{Other: other}}

	formatUserLogs(logs, 0)

	parsed, err := common.StrToMap(logs[0].Other)
	require.NoError(t, err)
	_, hasAdminInfo := parsed["admin_info"]
	require.False(t, hasAdminInfo, "admin_info (and nested quota_saturation) must be stripped for non-admin views")
	// Non-admin billing fields remain visible.
	require.Contains(t, parsed, "model_price")
}

func TestFormatUserLogsPreservesStreamStatus(t *testing.T) {
	other := common.MapToJsonStr(map[string]interface{}{
		"root_info":        "private",
		"reject_reason":    "internal rule",
		"po":               map[string]interface{}{"authorization": "private"},
		"channel_affinity": "private channel",
		"stream_status": map[string]interface{}{
			"status":            "error",
			"end_reason":        "upstream_error",
			"error_count":       1,
			"end_error":         "upstream secret",
			"errors":            []string{"upstream secret"},
			"future_diagnostic": "private",
		},
	})
	logs := []*Log{{Other: other}}

	formatUserLogs(logs, 0)

	parsed, err := common.StrToMap(logs[0].Other)
	require.NoError(t, err)
	for _, key := range []string{"root_info", "reject_reason", "po", "channel_affinity"} {
		assert.NotContains(t, parsed, key)
	}
	streamStatus, ok := parsed["stream_status"].(map[string]interface{})
	require.True(t, ok)
	assert.Len(t, streamStatus, 3)
	require.Equal(t, "error", streamStatus["status"])
	require.Equal(t, "upstream_error", streamStatus["end_reason"])
	require.Equal(t, float64(1), streamStatus["error_count"])
}
