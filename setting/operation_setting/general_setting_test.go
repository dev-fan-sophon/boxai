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
