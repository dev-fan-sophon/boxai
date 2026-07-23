package service

import (
	"testing"

	"github.com/QuantumNous/new-api/common"
	"github.com/QuantumNous/new-api/dto"
	relaycommon "github.com/QuantumNous/new-api/relay/common"
	"github.com/QuantumNous/new-api/types"
	"github.com/gin-gonic/gin"
	"github.com/shopspring/decimal"
	"github.com/stretchr/testify/assert"
	"github.com/stretchr/testify/require"
)

func TestManagedSearchToolSurchargeUsesActualMixedCalls(t *testing.T) {
	c, _ := gin.CreateTestContext(nil)
	c.Set("playground_managed_search", true)
	info := &relaycommon.RelayInfo{ResponsesUsageInfo: &relaycommon.ResponsesUsageInfo{BuiltInTools: map[string]*relaycommon.BuildInToolInfo{
		dto.BuildInToolXAIWebSearch: {CallCount: 2},
		dto.BuildInToolXAIXSearch:   {CallCount: 1},
	}}}
	summary := textQuotaSummary{ModelName: "grok-4.5", GroupRatio: 1}
	surcharge := calculateTextToolCallSurcharge(c, info, &summary)

	assert.True(t, surcharge.Equal(decimal.NewFromInt(7500)))
	assert.Equal(t, 2, summary.XAIWebSearchCallCount)
	assert.Equal(t, 1, summary.XAIXSearchCallCount)
	assert.Equal(t, 5.0, summary.XAIWebSearchPrice)
	assert.Equal(t, 5.0, summary.XAIXSearchPrice)
}

func TestManagedSearchToolSurchargeChargesWhenTokenUsageIsZero(t *testing.T) {
	c, _ := gin.CreateTestContext(nil)
	c.Set("playground_managed_search", true)
	info := &relaycommon.RelayInfo{
		OriginModelName: "grok-4.5",
		PriceData: types.PriceData{
			ModelRatio: 1, CompletionRatio: 1, CacheRatio: 1,
			GroupRatioInfo: types.GroupRatioInfo{GroupRatio: 1},
		},
		ResponsesUsageInfo: &relaycommon.ResponsesUsageInfo{BuiltInTools: map[string]*relaycommon.BuildInToolInfo{
			dto.BuildInToolXAIWebSearch: {CallCount: 1},
			dto.BuildInToolXAIXSearch:   {CallCount: 1},
		}},
	}
	summary := calculateTextQuotaSummary(c, info, &dto.Usage{})
	require.NotZero(t, summary.Quota)
	assert.Equal(t, common.QuotaRound(0.01*common.QuotaPerUnit), summary.Quota)
}
