/*
Copyright (C) 2023-2026 QuantumNous

This program is free software: you can redistribute it and/or modify
it under the terms of the GNU Affero General Public License as
published by the Free Software Foundation, either version 3 of the
License, or (at your option) any later version.

This program is distributed in the hope that it will be useful,
but WITHOUT ANY WARRANTY; without even the implied warranty of
MERCHANTABILITY or FITNESS FOR A PARTICULAR PURPOSE. See the
GNU Affero General Public License for more details.

You should have received a copy of the GNU Affero General Public License
along with this program. If not, see <https://www.gnu.org/licenses/>.

For commercial licensing, please contact support@quantumnous.com
*/
package service

import (
	"testing"
	"time"

	"github.com/stretchr/testify/assert"
	"github.com/stretchr/testify/require"

	"github.com/QuantumNous/new-api/model"
)

const testDay = int64(24 * 3600)

func weekConfig() rankingPeriodConfig {
	return rankingPeriodConfig{id: "week", duration: 7 * 24 * time.Hour, bucketSize: testDay, labelLayout: "Jan 2", hasPrevious: true}
}

// A quiet day must still occupy a slot on the axis, otherwise neighbouring
// buckets render side by side and the chart implies they are consecutive.
func TestRankingBucketAxisIncludesEmptyBuckets(t *testing.T) {
	start := int64(1753315200) // 2025-07-24T00:00:00Z
	end := start + 3*testDay

	axis := rankingBucketAxis(weekConfig(), start, end)

	require.Len(t, axis, 4)
	got := make([]string, 0, len(axis))
	for _, bucket := range axis {
		got = append(got, bucket.Ts)
	}
	assert.Equal(t, []string{
		"2025-07-24T00:00:00Z",
		"2025-07-25T00:00:00Z",
		"2025-07-26T00:00:00Z",
		"2025-07-27T00:00:00Z",
	}, got)
}

// The generated axis has to use the same epoch alignment as the SQL bucket
// expression, or generated slots never match the buckets carrying data.
func TestRankingBucketAxisAlignsToBucketSize(t *testing.T) {
	start := int64(1753315200) + 3600*5 // mid-bucket
	end := start + testDay

	axis := rankingBucketAxis(weekConfig(), start, end)

	require.Len(t, axis, 2)
	assert.Equal(t, "2025-07-24T00:00:00Z", axis[0].Ts)
	assert.Equal(t, "2025-07-25T00:00:00Z", axis[1].Ts)
}

func TestRankingBucketAxisRejectsUnboundedRange(t *testing.T) {
	config := rankingPeriodConfig{id: "week", bucketSize: 1, labelLayout: "Jan 2"}

	assert.Nil(t, rankingBucketAxis(config, 0, int64(rankingMaxAxisBuckets)+1))
	assert.Nil(t, rankingBucketAxis(weekConfig(), 100, 0))
	assert.Nil(t, rankingBucketAxis(rankingPeriodConfig{bucketSize: 0}, 0, 100))
}

// The series must expose the full axis even though points stay sparse, so the
// client can zero-fill without re-deriving bucket labels.
func TestBuildModelHistoryEmitsFullAxisWithSparsePoints(t *testing.T) {
	start := int64(1753315200)
	end := start + 2*testDay
	config := weekConfig()
	axis := rankingBucketAxis(config, start, end)

	buckets := []model.RankingQuotaBucket{
		{ModelName: "gpt-5", Bucket: start, Tokens: 100},
		{ModelName: "gpt-5", Bucket: start + 2*testDay, Tokens: 300},
	}
	totals := []model.RankingQuotaTotal{{ModelName: "gpt-5", TotalTokens: 400}}

	series := buildModelHistory(buckets, totals, map[string]rankingModelMeta{}, config, axis)

	require.Len(t, series.Axis, 3)
	assert.Equal(t, 3, series.Buckets)
	assert.Equal(t, "2025-07-25T00:00:00Z", series.Axis[1].Ts)
	// The quiet middle day contributes no point, only an axis slot.
	assert.Len(t, series.Points, 2)
}
