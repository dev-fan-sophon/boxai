package service

import (
	"math"

	"github.com/dev-fan-sophon/boxai/common"
	"github.com/dev-fan-sophon/boxai/model"
)

const (
	quotaForecastWindowDays = 7
	// LowBalanceForecastDays raises the in-app low-balance warning when the
	// forecast says the balance runs out sooner than this.
	LowBalanceForecastDays = 3
)

// QuotaForecast estimates how long a wallet balance lasts at the user's
// recent spending pace.
type QuotaForecast struct {
	Quota            int     `json:"quota"`
	Spent24h         int64   `json:"spent_24h"`
	Spent7d          int64   `json:"spent_7d"`
	DailySpend       int     `json:"daily_spend"`
	DaysLeft         float64 `json:"days_left"` // -1 when there is no recent spend
	WarningThreshold int     `json:"warning_threshold"`
	Low              bool    `json:"low"`
}

// ForecastQuota blends the last 24 hours with the average over the active
// part of the last 7 days, so a fresh spike or a quiet day moves the
// estimate without a single day dominating it. Accounts younger than a week
// are averaged over the days they actually spent, not a full week.
func ForecastQuota(quota int, spent24h int64, spent7d int64, firstSpendAt int64, now int64, threshold int) QuotaForecast {
	forecast := QuotaForecast{
		Quota:            quota,
		Spent24h:         spent24h,
		Spent7d:          spent7d,
		DaysLeft:         -1,
		WarningThreshold: threshold,
	}

	if spent7d > 0 && firstSpendAt > 0 {
		activeDays := float64(now-firstSpendAt) / 86400
		activeDays = math.Min(math.Max(activeDays, 1), quotaForecastWindowDays)
		average := float64(spent7d) / activeDays
		dailySpend := (average + float64(spent24h)) / 2
		if dailySpend > 0 {
			forecast.DailySpend = common.QuotaRound(dailySpend)
			forecast.DaysLeft = math.Max(float64(quota), 0) / dailySpend
		}
	}

	forecast.Low = quota <= threshold ||
		(forecast.DaysLeft >= 0 && forecast.DaysLeft < LowBalanceForecastDays)
	return forecast
}

func GetUserQuotaForecast(userId int) (QuotaForecast, error) {
	quota, err := model.GetUserQuota(userId, true)
	if err != nil {
		return QuotaForecast{}, err
	}
	setting, err := model.GetUserSetting(userId, false)
	if err != nil {
		return QuotaForecast{}, err
	}
	threshold := common.QuotaRemindThreshold
	if setting.QuotaWarningThreshold != 0 {
		threshold = common.QuotaRound(setting.QuotaWarningThreshold)
	}

	now := common.GetTimestamp()
	week, err := model.SumUserConsumeSince(userId, now-quotaForecastWindowDays*86400)
	if err != nil {
		return QuotaForecast{}, err
	}
	day, err := model.SumUserConsumeSince(userId, now-86400)
	if err != nil {
		return QuotaForecast{}, err
	}
	return ForecastQuota(quota, day.Quota, week.Quota, week.FirstAt, now, threshold), nil
}
