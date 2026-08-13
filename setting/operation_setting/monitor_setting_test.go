package operation_setting

import (
	"testing"

	"github.com/stretchr/testify/assert"
	"github.com/stretchr/testify/require"
)

func TestGetMonitorSetting_ChannelTestEnabledEnvOverridesEnabledConfig(t *testing.T) {
	orig := monitorSetting
	t.Cleanup(func() { monitorSetting = orig })

	t.Setenv("CHANNEL_TEST_ENABLED", "false")
	t.Setenv("CHANNEL_TEST_FREQUENCY", "5")
	monitorSetting = MonitorSetting{
		AutoTestChannelEnabled: true,
		AutoTestChannelMinutes: 20,
	}

	setting := GetMonitorSetting()

	require.NotNil(t, setting)
	assert.False(t, setting.AutoTestChannelEnabled)
	assert.Equal(t, float64(5), setting.AutoTestChannelMinutes)
}

func TestGetMonitorSetting_ChannelTestEnabledEnvCanEnableDisabledConfig(t *testing.T) {
	orig := monitorSetting
	t.Cleanup(func() { monitorSetting = orig })

	t.Setenv("CHANNEL_TEST_ENABLED", "true")
	monitorSetting = MonitorSetting{
		AutoTestChannelEnabled: false,
		AutoTestChannelMinutes: 12,
	}

	setting := GetMonitorSetting()

	require.NotNil(t, setting)
	assert.True(t, setting.AutoTestChannelEnabled)
	assert.Equal(t, float64(12), setting.AutoTestChannelMinutes)
}

func TestGetMonitorSettingPreservesSupportedChannelTestModes(t *testing.T) {
	tests := []struct {
		name string
		mode string
		want string
	}{
		{name: "all channels", mode: ChannelTestModeScheduledAll, want: ChannelTestModeScheduledAll},
		{name: "auto-disable enabled", mode: ChannelTestModeAutoBanOnly, want: ChannelTestModeAutoBanOnly},
		{name: "passive recovery", mode: ChannelTestModePassiveRecovery, want: ChannelTestModePassiveRecovery},
		{name: "unknown falls back safely", mode: "unknown", want: ChannelTestModeScheduledAll},
	}

	for _, tt := range tests {
		t.Run(tt.name, func(t *testing.T) {
			orig := monitorSetting
			t.Cleanup(func() { monitorSetting = orig })
			t.Setenv("CHANNEL_TEST_ENABLED", "")
			t.Setenv("CHANNEL_TEST_FREQUENCY", "")
			monitorSetting = MonitorSetting{ChannelTestMode: tt.mode}

			setting := GetMonitorSetting()

			require.NotNil(t, setting)
			assert.Equal(t, tt.want, setting.ChannelTestMode)
		})
	}
}
