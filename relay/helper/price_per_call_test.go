package helper

import (
	"net/http/httptest"
	"testing"

	"github.com/dev-fan-sophon/boxai/common"
	"github.com/dev-fan-sophon/boxai/constant"
	relaycommon "github.com/dev-fan-sophon/boxai/relay/common"
	"github.com/dev-fan-sophon/boxai/setting/operation_setting"
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

func TestModelPriceHelperPerCallNativeSeedancePricingPrecedence(t *testing.T) {
	savedPrices := ratio_setting.ModelPrice2JSONString()
	savedRatios := ratio_setting.ModelRatio2JSONString()
	savedGroups := ratio_setting.GroupRatio2JSONString()
	savedFree := operation_setting.GetQuotaSetting().EnableFreeModelPreConsume
	savedSelfUse := operation_setting.SelfUseModeEnabled
	t.Cleanup(func() {
		require.NoError(t, ratio_setting.UpdateModelPriceByJSONString(savedPrices))
		require.NoError(t, ratio_setting.UpdateModelRatioByJSONString(savedRatios))
		require.NoError(t, ratio_setting.UpdateGroupRatioByJSONString(savedGroups))
		operation_setting.GetQuotaSetting().EnableFreeModelPreConsume = savedFree
		operation_setting.SelfUseModeEnabled = savedSelfUse
	})
	operation_setting.GetQuotaSetting().EnableFreeModelPreConsume = false
	operation_setting.SelfUseModeEnabled = true // Not an explicit token price.
	require.NoError(t, ratio_setting.UpdateGroupRatioByJSONString(`{"native-test":1.25}`))
	for _, tt := range []struct {
		name, prices, ratios      string
		channel                   int
		usePrice, free, wantError bool
		quota                     int
	}{
		{"native token reserve", `{}`, `{"dreamina-seedance-2-5":4.9}`, constant.ChannelTypeDoubaoVideo, false, false, false, 1531250},
		{"explicit zero ratio", `{}`, `{"dreamina-seedance-2-5":0}`, constant.ChannelTypeDoubaoVideo, false, true, false, 0},
		{"explicit zero price wins", `{"dreamina-seedance-2-5":0}`, `{"dreamina-seedance-2-5":4.9}`, constant.ChannelTypeDoubaoVideo, true, true, false, 0},
		{"native default", `{}`, `{}`, constant.ChannelTypeDoubaoVideo, true, false, false, 129280},
		{"sora unchanged", `{}`, `{"dreamina-seedance-2-5":4.9}`, constant.ChannelTypeSora, true, false, false, 129280},
		{"oversized reserve rejected", `{}`, `{"dreamina-seedance-2-5":100000000}`, constant.ChannelTypeDoubaoVideo, false, false, true, 0},
	} {
		t.Run(tt.name, func(t *testing.T) {
			require.NoError(t, ratio_setting.UpdateModelPriceByJSONString(tt.prices))
			require.NoError(t, ratio_setting.UpdateModelRatioByJSONString(tt.ratios))
			ctx, _ := gin.CreateTestContext(httptest.NewRecorder())
			price, err := ModelPriceHelperPerCall(ctx, &relaycommon.RelayInfo{
				ChannelMeta:     &relaycommon.ChannelMeta{ChannelType: tt.channel},
				OriginModelName: "dreamina-seedance-2-5", UserGroup: "native-test", UsingGroup: "native-test",
			})
			if tt.wantError {
				require.Error(t, err)
				return
			}
			require.NoError(t, err)
			assert.Equal(t, tt.usePrice, price.UsePrice)
			assert.Equal(t, tt.free, price.FreeModel)
			assert.Equal(t, tt.quota, price.Quota)
		})
	}
}
