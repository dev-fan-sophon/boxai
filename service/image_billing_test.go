package service

import (
	"net/http"
	"net/http/httptest"
	"testing"

	"github.com/dev-fan-sophon/boxai/common"
	"github.com/dev-fan-sophon/boxai/constant"
	relaycommon "github.com/dev-fan-sophon/boxai/relay/common"
	"github.com/dev-fan-sophon/boxai/types"
	"github.com/gin-gonic/gin"
	"github.com/stretchr/testify/assert"
	"github.com/stretchr/testify/require"
)

// A failed Ali attempt must not leak its provider quantity or prompt
// extension surcharge into a retry on another channel.
func TestPrepareImageBillingResetsPerAttemptRatios(t *testing.T) {
	gin.SetMode(gin.TestMode)
	c, _ := gin.CreateTestContext(httptest.NewRecorder())
	info := &relaycommon.RelayInfo{
		ChannelMeta: &relaycommon.ChannelMeta{ChannelType: constant.ChannelTypeAli, UpstreamModelName: "z-image-turbo"},
		PriceData:   types.PriceData{GroupRatioInfo: types.GroupRatioInfo{GroupRatio: 1}},
	}

	require.Nil(t, PrepareImageBillingForRequest(c, info, 3, true))
	assert.Equal(t, 3.0, info.PriceData.OtherRatios()["n"])
	assert.Equal(t, 2.0, info.PriceData.OtherRatios()["prompt_extend"])

	info.ChannelMeta = &relaycommon.ChannelMeta{ChannelType: constant.ChannelTypeOpenAI, UpstreamModelName: "gpt-image-2"}
	require.Nil(t, PrepareImageBillingForRequest(c, info, 3, true))
	assert.Equal(t, 1.0, info.PriceData.OtherRatioMultiplier(), "ratio-priced tokens must not be multiplied by a stale Ali quantity")
}

func TestPrepareImageBillingKeepsSufficientReservation(t *testing.T) {
	gin.SetMode(gin.TestMode)
	c, _ := gin.CreateTestContext(httptest.NewRecorder())
	info := &relaycommon.RelayInfo{
		ChannelMeta: &relaycommon.ChannelMeta{ChannelType: constant.ChannelTypeOpenAI},
		PriceData: types.PriceData{
			UsePrice:       true,
			ModelPrice:     0.04,
			GroupRatioInfo: types.GroupRatioInfo{GroupRatio: 1},
		},
	}
	info.PriceData.QuotaToPreConsume = common.QuotaFromFloat(0.04 * 2 * common.QuotaPerUnit)

	// Same or smaller quantity never needs another reservation (no billing
	// session is required for this path).
	require.Nil(t, PrepareImageBillingForRequest(c, info, 2, false))
	require.Nil(t, PrepareImageBillingForRequest(c, info, 1, false))
	assert.Equal(t, common.QuotaFromFloat(0.04*2*common.QuotaPerUnit), info.PriceData.QuotaToPreConsume)
	assert.Equal(t, 1.0, info.PriceData.OtherRatios()["n"])
}

func TestPrepareImageBillingRejectsOutOfRangeCount(t *testing.T) {
	gin.SetMode(gin.TestMode)
	c, _ := gin.CreateTestContext(httptest.NewRecorder())
	for _, count := range []int{0, -1, 129} {
		apiErr := PrepareImageBillingForRequest(c, &relaycommon.RelayInfo{ChannelMeta: &relaycommon.ChannelMeta{}}, count, false)
		require.NotNil(t, apiErr)
		assert.Equal(t, http.StatusBadRequest, apiErr.StatusCode)
	}
}
