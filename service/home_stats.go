package service

import (
	"math"
	"sort"
	"sync"
	"time"

	"github.com/QuantumNous/new-api/constant"
	"github.com/QuantumNous/new-api/model"
	perfmetrics "github.com/QuantumNous/new-api/pkg/perf_metrics"
)

const (
	homeStatsPeriodDays = 30
	homeStatsCacheTTL   = 5 * time.Minute
)

type HomeStats struct {
	PeriodDays      int               `json:"period_days"`
	AvailableModels int               `json:"available_models"`
	ActiveVendors   int               `json:"active_vendors"`
	EndpointTypes   int               `json:"endpoint_types"`
	RequestCount    *int64            `json:"request_count"`
	TotalTokens     int64             `json:"total_tokens"`
	SuccessRate     *float64          `json:"success_rate"`
	AvgLatencyMs    *int64            `json:"avg_latency_ms"`
	Vendors         []HomeStatsVendor `json:"vendors"`
	TopModels       []HomeStatsModel  `json:"top_models"`
	Trend           []HomeStatsPoint  `json:"trend"`
	UpdatedAt       int64             `json:"updated_at"`
}

type HomeStatsVendor struct {
	Name string `json:"name"`
	Icon string `json:"icon"`
}

type HomeStatsModel struct {
	ModelName   string  `json:"model_name"`
	Vendor      string  `json:"vendor"`
	VendorIcon  string  `json:"vendor_icon"`
	TotalTokens int64   `json:"total_tokens"`
	Share       float64 `json:"share"`
}

type HomeStatsPoint struct {
	Ts     int64  `json:"ts"`
	Label  string `json:"label"`
	Tokens int64  `json:"tokens"`
}

var homeStatsCache struct {
	sync.Mutex
	expiresAt time.Time
	data      *HomeStats
}

func GetHomeStats() (*HomeStats, error) {
	homeStatsCache.Lock()
	defer homeStatsCache.Unlock()

	now := time.Now()
	if homeStatsCache.data != nil && now.Before(homeStatsCache.expiresAt) {
		return homeStatsCache.data, nil
	}

	today := time.Date(now.UTC().Year(), now.UTC().Month(), now.UTC().Day(), 0, 0, 0, 0, time.UTC)
	startTime := today.AddDate(0, 0, -(homeStatsPeriodDays - 1)).Unix()
	endTime := now.Unix()
	totals, err := model.GetRankingQuotaTotals(startTime, endTime)
	if err != nil {
		return nil, err
	}
	buckets, err := model.GetRankingQuotaBuckets(startTime, endTime, 24*3600)
	if err != nil {
		return nil, err
	}

	metrics, err := perfmetrics.QuerySummaryAll(24*homeStatsPeriodDays, nil)
	if err != nil {
		return nil, err
	}

	data := aggregateHomeStats(model.GetPricing(), model.GetVendors(), totals, buckets, metrics.Models, now)
	homeStatsCache.data = data
	homeStatsCache.expiresAt = now.Add(homeStatsCacheTTL)
	return data, nil
}

type homeStatsVendorMeta struct {
	name string
	icon string
}

func aggregateHomeStats(pricing []model.Pricing, vendors []model.PricingVendor, totals []model.RankingQuotaTotal, buckets []model.RankingQuotaBucket, summaries []perfmetrics.ModelSummary, now time.Time) *HomeStats {
	vendorByID := make(map[int]homeStatsVendorMeta, len(vendors))
	for _, vendor := range vendors {
		vendorByID[vendor.ID] = homeStatsVendorMeta{name: vendor.Name, icon: vendor.Icon}
	}
	activeVendors := make(map[int]struct{})
	availableModels := make(map[string]struct{})
	endpointTypes := make(map[constant.EndpointType]struct{})
	modelMeta := make(map[string]homeStatsVendorMeta)
	for _, item := range pricing {
		availableModels[item.ModelName] = struct{}{}
		for _, endpointType := range item.SupportedEndpointTypes {
			if endpointType == "" {
				continue
			}
			endpointTypes[endpointType] = struct{}{}
		}
		vendor, ok := vendorByID[item.VendorID]
		if !ok {
			continue
		}
		activeVendors[item.VendorID] = struct{}{}
		modelMeta[item.ModelName] = vendor
	}

	result := &HomeStats{
		PeriodDays:      homeStatsPeriodDays,
		AvailableModels: len(availableModels),
		ActiveVendors:   len(activeVendors),
		EndpointTypes:   len(endpointTypes),
		Vendors:         make([]HomeStatsVendor, 0, len(activeVendors)),
		TopModels:       make([]HomeStatsModel, 0, 4),
		Trend:           make([]HomeStatsPoint, 0, homeStatsPeriodDays),
		UpdatedAt:       now.Unix(),
	}
	for vendorID := range activeVendors {
		vendor := vendorByID[vendorID]
		result.Vendors = append(result.Vendors, HomeStatsVendor{Name: vendor.name, Icon: vendor.icon})
	}
	sort.Slice(result.Vendors, func(i, j int) bool { return result.Vendors[i].Name < result.Vendors[j].Name })
	for _, item := range totals {
		result.TotalTokens += item.TotalTokens
	}
	for _, item := range totals {
		vendor, ok := modelMeta[item.ModelName]
		if !ok || len(result.TopModels) == 4 {
			continue
		}
		share := 0.0
		if result.TotalTokens > 0 {
			share = float64(item.TotalTokens) / float64(result.TotalTokens)
		}
		result.TopModels = append(result.TopModels, HomeStatsModel{ModelName: item.ModelName, Vendor: vendor.name, VendorIcon: vendor.icon, TotalTokens: item.TotalTokens, Share: share})
	}

	tokensByBucket := make(map[int64]int64)
	for _, item := range buckets {
		tokensByBucket[item.Bucket] += item.Tokens
	}
	today := time.Date(now.UTC().Year(), now.UTC().Month(), now.UTC().Day(), 0, 0, 0, 0, time.UTC)
	firstDay := today.AddDate(0, 0, -(homeStatsPeriodDays - 1))
	for day := 0; day < homeStatsPeriodDays; day++ {
		bucket := firstDay.AddDate(0, 0, day).Unix()
		result.Trend = append(result.Trend, HomeStatsPoint{Ts: bucket, Label: time.Unix(bucket, 0).UTC().Format("Jan 2"), Tokens: tokensByBucket[bucket]})
	}

	var requestCount int64
	var weightedSuccess, weightedLatency float64
	for _, summary := range summaries {
		if summary.RequestCount <= 0 {
			continue
		}
		requestCount += summary.RequestCount
		weightedSuccess += summary.SuccessRate * float64(summary.RequestCount)
		weightedLatency += float64(summary.AvgLatencyMs) * float64(summary.RequestCount)
	}
	if requestCount > 0 {
		result.RequestCount = &requestCount
		successRate := weightedSuccess / float64(requestCount)
		avgLatency := int64(math.Round(weightedLatency / float64(requestCount)))
		result.SuccessRate = &successRate
		result.AvgLatencyMs = &avgLatency
	}
	return result
}
