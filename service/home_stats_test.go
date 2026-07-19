package service

import (
	"testing"
	"time"

	"github.com/QuantumNous/new-api/constant"
	"github.com/QuantumNous/new-api/model"
	perfmetrics "github.com/QuantumNous/new-api/pkg/perf_metrics"
	"github.com/stretchr/testify/assert"
	"github.com/stretchr/testify/require"
)

func TestAggregateHomeStats(t *testing.T) {
	now := time.Date(2023, time.November, 14, 12, 0, 0, 0, time.UTC)
	pricing := []model.Pricing{
		{ModelName: "model-a", VendorID: 1, SupportedEndpointTypes: []constant.EndpointType{constant.EndpointTypeOpenAI, constant.EndpointTypeEmbeddings}},
		{ModelName: "model-b", VendorID: 1, SupportedEndpointTypes: []constant.EndpointType{constant.EndpointTypeOpenAI}},
		{ModelName: "ignored", VendorID: 99, SupportedEndpointTypes: []constant.EndpointType{constant.EndpointTypeGemini}},
	}
	vendors := []model.PricingVendor{{ID: 1, Name: "Vendor A", Icon: "a.svg"}, {ID: 2, Name: "Inactive"}}
	totals := []model.RankingQuotaTotal{{ModelName: "model-a", TotalTokens: 60}, {ModelName: "unknown", TotalTokens: 30}, {ModelName: "model-b", TotalTokens: 10}}
	today := time.Date(2023, time.November, 14, 0, 0, 0, 0, time.UTC).Unix()
	yesterday := time.Date(2023, time.November, 13, 0, 0, 0, 0, time.UTC).Unix()
	buckets := []model.RankingQuotaBucket{{ModelName: "model-a", Bucket: today, Tokens: 40}, {ModelName: "model-b", Bucket: yesterday, Tokens: 10}, {ModelName: "model-a", Bucket: yesterday, Tokens: 20}}
	summaries := []perfmetrics.ModelSummary{{RequestCount: 3, SuccessRate: 100, AvgLatencyMs: 100}, {RequestCount: 1, SuccessRate: 0, AvgLatencyMs: 300}}

	result := aggregateHomeStats(pricing, vendors, totals, buckets, summaries, now)

	require.NotNil(t, result.RequestCount)
	require.NotNil(t, result.SuccessRate)
	require.NotNil(t, result.AvgLatencyMs)
	assert.Equal(t, 30, result.PeriodDays)
	assert.Equal(t, 3, result.AvailableModels)
	assert.Equal(t, 1, result.ActiveVendors)
	assert.Equal(t, 3, result.EndpointTypes)
	assert.Equal(t, int64(4), *result.RequestCount)
	assert.Equal(t, int64(100), result.TotalTokens)
	assert.Equal(t, 75.0, *result.SuccessRate)
	assert.Equal(t, int64(150), *result.AvgLatencyMs)
	assert.Equal(t, now.Unix(), result.UpdatedAt)
	assert.Equal(t, []HomeStatsVendor{{Name: "Vendor A", Icon: "a.svg"}}, result.Vendors)
	assert.Equal(t, []HomeStatsModel{
		{ModelName: "model-a", Vendor: "Vendor A", VendorIcon: "a.svg", TotalTokens: 60, Share: 0.6},
		{ModelName: "model-b", Vendor: "Vendor A", VendorIcon: "a.svg", TotalTokens: 10, Share: 0.1},
	}, result.TopModels)
	require.Len(t, result.Trend, 30)
	assert.Equal(t, int64(30), result.Trend[28].Tokens)
	assert.Equal(t, int64(40), result.Trend[29].Tokens)
}

func TestAggregateHomeStatsNullMetricsWithoutSamples(t *testing.T) {
	result := aggregateHomeStats(nil, nil, nil, nil, []perfmetrics.ModelSummary{{RequestCount: 0}}, time.Unix(10, 0))

	assert.Nil(t, result.RequestCount)
	assert.Nil(t, result.SuccessRate)
	assert.Nil(t, result.AvgLatencyMs)
	assert.Empty(t, result.TopModels)
	assert.Len(t, result.Trend, 30)
	assert.Empty(t, result.Vendors)
}
