package operation_setting

import (
	"testing"

	"github.com/stretchr/testify/assert"
)

func TestVietnameseDongDisplay(t *testing.T) {
	original := generalSetting
	t.Cleanup(func() {
		generalSetting = original
	})

	generalSetting.QuotaDisplayType = QuotaDisplayTypeVND

	assert.Equal(t, "₫", GetCurrencySymbol())
	assert.Equal(t, 26000.0, GetUsdToCurrencyRate(26000))
}

func TestGetBusinessTimezoneFallsBackForInvalidConfiguration(t *testing.T) {
	original := generalSetting.BusinessTimezone
	t.Cleanup(func() { generalSetting.BusinessTimezone = original })

	generalSetting.BusinessTimezone = "Asia/Ho_Chi_Minh"
	assert.Equal(t, "Asia/Ho_Chi_Minh", GetBusinessTimezone())

	generalSetting.BusinessTimezone = "not/a-timezone"
	assert.Equal(t, DefaultBusinessTimezone, GetBusinessTimezone())

	generalSetting.BusinessTimezone = ""
	assert.Equal(t, DefaultBusinessTimezone, GetBusinessTimezone())

	generalSetting.BusinessTimezone = "Local"
	assert.Equal(t, DefaultBusinessTimezone, GetBusinessTimezone())
}

func TestValidateBusinessTimezoneNormalizesExplicitIANAZone(t *testing.T) {
	timezone, err := ValidateBusinessTimezone("  Asia/Ho_Chi_Minh  ")
	assert.NoError(t, err)
	assert.Equal(t, "Asia/Ho_Chi_Minh", timezone)
}

func TestGetBusinessLocationUsesConfiguredTimezone(t *testing.T) {
	original := generalSetting.BusinessTimezone
	t.Cleanup(func() { generalSetting.BusinessTimezone = original })

	generalSetting.BusinessTimezone = "Asia/Tokyo"
	assert.Equal(t, "Asia/Tokyo", GetBusinessLocation().String())
}
