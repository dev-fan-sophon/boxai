package perfmetrics

import (
	"math"
	"sort"
	"time"

	"github.com/dev-fan-sophon/boxai/model"
)

// Display window for group-status heat map (matches Code Go UX).
const (
	GroupStatusSampleWindowHours = 0.5  // 30 minutes for current status
	GroupStatusSeriesWindowHours = 24.0 // 24h heat map
	GroupStatusBucketSeconds     = 1800 // 30-minute display buckets
	// Minimum requests in the sample window before a non-observing status.
	GroupStatusMinSampleCount = 1
	// Success-rate thresholds (percent).
	GroupStatusHealthyMin = 90.0
	GroupStatusSlowMin    = 50.0
)

const (
	GroupStatusHealthy    = "healthy"
	GroupStatusSlow       = "slow"
	GroupStatusDown       = "down"
	GroupStatusObserving  = "observing"
)

// GroupStatusSeriesPoint is one heat-map cell.
type GroupStatusSeriesPoint struct {
	Ts           int64    `json:"ts"`
	SuccessRate  *float64 `json:"success_rate"` // null when no samples
	RequestCount int64    `json:"request_count"`
}

// GroupStatusModel is per-model availability inside a group.
type GroupStatusModel struct {
	Model          string                   `json:"model"`
	Status         string                   `json:"status"`
	SuccessRate    *float64                 `json:"success_rate"` // null when observing
	SampleWindow   float64                  `json:"sample_window"`
	SeriesWindow   float64                  `json:"series_window"`
	BucketSeconds  int64                    `json:"bucket_seconds"`
	RequestCount   int64                    `json:"request_count"`
	Series         []GroupStatusSeriesPoint `json:"series"`
}

// GroupStatusGroup is one business group with its models.
type GroupStatusGroup struct {
	Group        string             `json:"group"`
	Status       string             `json:"status"`
	RequestCount int64              `json:"request_count"`
	Models       []GroupStatusModel `json:"models"`
}

// QueryGroupStatus builds Code-Go-style group → model availability snapshots
// from relay perf_metrics (real traffic, not external probes).
func QueryGroupStatus(groups []string) ([]GroupStatusGroup, error) {
	if len(groups) == 0 {
		return []GroupStatusGroup{}, nil
	}

	now := time.Now().Unix()
	seriesBucket := int64(GroupStatusBucketSeconds)
	seriesWindowSec := int64(GroupStatusSeriesWindowHours * 3600)
	sampleWindowSec := int64(GroupStatusSampleWindowHours * 3600)

	// Align series end to current display bucket so UI cells stay stable.
	seriesEnd := alignBucket(now, seriesBucket)
	seriesStart := seriesEnd - seriesWindowSec + seriesBucket
	if seriesStart < 0 {
		seriesStart = 0
	}
	sampleStart := now - sampleWindowSec

	// Load a bit earlier than seriesStart so coarser storage buckets still map in.
	loadStart := seriesStart - seriesBucket
	if loadStart < 0 {
		loadStart = 0
	}

	rows, err := model.GetPerfMetricsInRange(loadStart, now, groups)
	if err != nil {
		return nil, err
	}

	// group → model → displayBucketTs → counters
	type gmKey struct {
		group string
		model string
	}
	merged := map[gmKey]map[int64]counters{}

	addRow := func(group, modelName string, bucketTs int64, c counters) {
		if c.requestCount == 0 || modelName == "" || group == "" {
			return
		}
		displayTs := alignBucket(bucketTs, seriesBucket)
		if displayTs < seriesStart || displayTs > seriesEnd {
			// Still keep for sample window if overlapping.
			if bucketTs+seriesBucket < sampleStart && displayTs < sampleStart {
				return
			}
		}
		key := gmKey{group: group, model: modelName}
		if merged[key] == nil {
			merged[key] = map[int64]counters{}
		}
		cur := merged[key][displayTs]
		cur.requestCount += c.requestCount
		cur.successCount += c.successCount
		cur.totalLatencyMs += c.totalLatencyMs
		cur.ttftSumMs += c.ttftSumMs
		cur.ttftCount += c.ttftCount
		cur.outputTokens += c.outputTokens
		cur.generationMs += c.generationMs
		merged[key][displayTs] = cur
	}

	for _, row := range rows {
		addRow(row.Group, row.ModelName, row.BucketTs, counters{
			requestCount:   row.RequestCount,
			successCount:   row.SuccessCount,
			totalLatencyMs: row.TotalLatencyMs,
			ttftSumMs:      row.TtftSumMs,
			ttftCount:      row.TtftCount,
			outputTokens:   row.OutputTokens,
			generationMs:   row.GenerationMs,
		})
	}

	allowed := allowedGroupSet(groups)
	hotBuckets.Range(func(key, value any) bool {
		k := key.(bucketKey)
		if allowed != nil {
			if _, ok := allowed[k.group]; !ok {
				return true
			}
		}
		snap := value.(*atomicBucket).snapshot()
		if snap.requestCount == 0 {
			return true
		}
		addRow(k.group, k.model, k.bucketTs, snap)
		return true
	})

	// Build full series timestamps (inclusive).
	seriesTs := make([]int64, 0, int(seriesWindowSec/seriesBucket))
	for ts := seriesStart; ts <= seriesEnd; ts += seriesBucket {
		seriesTs = append(seriesTs, ts)
	}

	// group → models
	byGroup := map[string][]GroupStatusModel{}
	for key, buckets := range merged {
		// Sample window: sum display buckets that overlap [sampleStart, now].
		sample := counters{}
		for ts, c := range buckets {
			// Display bucket [ts, ts+bucket) intersects sample window.
			bucketEnd := ts + seriesBucket
			if bucketEnd > sampleStart && ts <= now {
				sample.requestCount += c.requestCount
				sample.successCount += c.successCount
			}
		}

		status, ratePtr, sampleCount := classifyGroupStatus(sample)
		series := make([]GroupStatusSeriesPoint, 0, len(seriesTs))
		for _, ts := range seriesTs {
			c := buckets[ts]
			pt := GroupStatusSeriesPoint{
				Ts:           ts,
				RequestCount: c.requestCount,
			}
			if c.requestCount > 0 {
				rate := math.Round(successRate(c)*100) / 100
				pt.SuccessRate = &rate
			}
			series = append(series, pt)
		}

		byGroup[key.group] = append(byGroup[key.group], GroupStatusModel{
			Model:         key.model,
			Status:        status,
			SuccessRate:   ratePtr,
			SampleWindow:  GroupStatusSampleWindowHours,
			SeriesWindow:  GroupStatusSeriesWindowHours,
			BucketSeconds: seriesBucket,
			RequestCount:  sampleCount,
			Series:        series,
		})
	}

	// Ensure every requested group appears, even if empty.
	result := make([]GroupStatusGroup, 0, len(groups))
	for _, groupName := range groups {
		models := byGroup[groupName]
		sort.Slice(models, func(i, j int) bool {
			pi, pj := statusPriority(models[i].Status), statusPriority(models[j].Status)
			if pi != pj {
				return pi < pj
			}
			if models[i].RequestCount != models[j].RequestCount {
				return models[i].RequestCount > models[j].RequestCount
			}
			return models[i].Model < models[j].Model
		})
		var totalReq int64
		for _, m := range models {
			totalReq += m.RequestCount
		}
		result = append(result, GroupStatusGroup{
			Group:        groupName,
			Status:       aggregateGroupStatus(models),
			RequestCount: totalReq,
			Models:       models,
		})
	}

	sort.Slice(result, func(i, j int) bool {
		pi, pj := statusPriority(result[i].Status), statusPriority(result[j].Status)
		if pi != pj {
			return pi < pj
		}
		return result[i].Group < result[j].Group
	})

	return result, nil
}

func alignBucket(ts, bucketSec int64) int64 {
	if bucketSec <= 0 {
		return ts
	}
	return ts - (ts % bucketSec)
}

func classifyGroupStatus(sample counters) (status string, rate *float64, requestCount int64) {
	requestCount = sample.requestCount
	if sample.requestCount < GroupStatusMinSampleCount {
		return GroupStatusObserving, nil, requestCount
	}
	r := math.Round(successRate(sample)*100) / 100
	rate = &r
	switch {
	case r >= GroupStatusHealthyMin:
		return GroupStatusHealthy, rate, requestCount
	case r >= GroupStatusSlowMin:
		return GroupStatusSlow, rate, requestCount
	default:
		return GroupStatusDown, rate, requestCount
	}
}

func statusPriority(status string) int {
	switch status {
	case GroupStatusDown:
		return 0
	case GroupStatusSlow:
		return 1
	case GroupStatusHealthy:
		return 2
	case GroupStatusObserving:
		return 3
	default:
		return 4
	}
}

func aggregateGroupStatus(models []GroupStatusModel) string {
	if len(models) == 0 {
		return GroupStatusObserving
	}
	best := 4
	chosen := GroupStatusObserving
	for _, m := range models {
		p := statusPriority(m.Status)
		if p < best {
			best = p
			chosen = m.Status
		}
	}
	return chosen
}
