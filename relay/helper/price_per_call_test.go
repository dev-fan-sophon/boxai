package helper

import (
	"net/http/httptest"
	"testing"

	"github.com/dev-fan-sophon/boxai/common"
	relaycommon "github.com/dev-fan-sophon/boxai/relay/common"
	"github.com/dev-fan-sophon/boxai/setting/ratio_setting"
	"github.com/gin-gonic/gin"
	"github.com/stretchr/testify/assert"
	"github.com/stretchr/testify/require"
)

func TestModelPriceHelperPerCallSeedanceUsesPerSecondPrice(t *testing.T) {
	gin.SetMode(gin.TestMode)
	savedPrices := ratio_setting.ModelPrice2JSONString()
	savedRatios := ratio_setting.ModelRatio2JSONString()
	t.Cleanup(func() {
		require.NoError(t, ratio_setting.UpdateModelPriceByJSONString(savedPrices))
		require.NoError(t, ratio_setting.UpdateModelRatioByJSONString(savedRatios))
	})

	require.NoError(t, ratio_setting.UpdateModelPriceByJSONString(`{}`))
	ratios, err := common.Marshal(map[string]float64{"dreamina-seedance-2-5": 4.9})
	require.NoError(t, err)
	require.NoError(t, ratio_setting.UpdateModelRatioByJSONString(string(ratios)))

	ctx, _ := gin.CreateTestContext(httptest.NewRecorder())
	ctx.Set("group", "default")
	info := &relaycommon.RelayInfo{
		OriginModelName: "dreamina-seedance-2-5",
		UserGroup:       "default",
		UsingGroup:      "default",
	}

	priceData, err := ModelPriceHelperPerCall(ctx, info)
	require.NoError(t, err)
	require.True(t, priceData.UsePrice)
	assert.InDelta(t, 1.51/7.3, priceData.ModelPrice, 1e-9)

	wantQuota, err := common.QuotaFromFloatStrict(priceData.ModelPrice * common.QuotaPerUnit)
	require.NoError(t, err)
	assert.Equal(t, wantQuota, priceData.Quota)
	assert.NotEqual(t, 4.9/2*common.QuotaPerUnit, float64(priceData.Quota))
}

func TestModelPriceHelperPerCallSeedanceDoesNotUseModelRatioFallback(t *testing.T) {
	gin.SetMode(gin.TestMode)
	savedPrices := ratio_setting.ModelPrice2JSONString()
	savedRatios := ratio_setting.ModelRatio2JSONString()
	t.Cleanup(func() {
		require.NoError(t, ratio_setting.UpdateModelPriceByJSONString(savedPrices))
		require.NoError(t, ratio_setting.UpdateModelRatioByJSONString(savedRatios))
	})

	require.NoError(t, ratio_setting.UpdateModelPriceByJSONString(`{}`))
	ratios, err := common.Marshal(map[string]float64{"unknown-seedance-9-9": 4.9})
	require.NoError(t, err)
	require.NoError(t, ratio_setting.UpdateModelRatioByJSONString(string(ratios)))

	ctx, _ := gin.CreateTestContext(httptest.NewRecorder())
	info := &relaycommon.RelayInfo{
		OriginModelName: "unknown-seedance-9-9",
		UserGroup:       "default",
		UsingGroup:      "default",
	}

	_, err = ModelPriceHelperPerCall(ctx, info)
	require.Error(t, err)
	assert.Contains(t, err.Error(), "unknown-seedance-9-9")
}
