package service

import (
	"testing"

	"github.com/stretchr/testify/assert"
)

func TestForecastQuota(t *testing.T) {
	const day = int64(86400)
	const now = int64(1_800_000_000)

	tests := []struct {
		name         string
		quota        int
		spent24h     int64
		spent7d      int64
		firstSpendAt int64
		threshold    int
		wantDaily    int
		wantDaysLeft float64
		wantLow      bool
	}{
		{
			name:         "no recent spend has no runway estimate",
			quota:        500_000,
			threshold:    1000,
			wantDaysLeft: -1,
		},
		{
			name:         "steady week blends average and last day",
			quota:        700_000,
			spent24h:     100_000,
			spent7d:      700_000,
			firstSpendAt: now - 7*day,
			threshold:    1000,
			wantDaily:    100_000,
			wantDaysLeft: 7,
		},
		{
			name:         "young account averages over active days only",
			quota:        300_000,
			spent24h:     100_000,
			spent7d:      200_000,
			firstSpendAt: now - 2*day,
			threshold:    1000,
			wantDaily:    100_000,
			wantDaysLeft: 3,
		},
		{
			name:         "fast burn warns before the threshold is reached",
			quota:        200_000,
			spent24h:     100_000,
			spent7d:      700_000,
			firstSpendAt: now - 7*day,
			threshold:    1000,
			wantDaily:    100_000,
			wantDaysLeft: 2,
			wantLow:      true,
		},
		{
			name:         "balance under threshold is low without spend",
			quota:        500,
			threshold:    1000,
			wantDaysLeft: -1,
			wantLow:      true,
		},
		{
			name:         "negative balance never yields negative runway",
			quota:        -10,
			spent24h:     100,
			spent7d:      700,
			firstSpendAt: now - 7*day,
			threshold:    0,
			wantDaily:    100,
			wantDaysLeft: 0,
			wantLow:      true,
		},
	}

	for _, tt := range tests {
		t.Run(tt.name, func(t *testing.T) {
			got := ForecastQuota(tt.quota, tt.spent24h, tt.spent7d, tt.firstSpendAt, now, tt.threshold)
			assert.Equal(t, tt.wantDaily, got.DailySpend)
			assert.InDelta(t, tt.wantDaysLeft, got.DaysLeft, 1e-9)
			assert.Equal(t, tt.wantLow, got.Low)
		})
	}
}
