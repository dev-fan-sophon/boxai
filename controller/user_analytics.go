package controller

import (
	"strconv"
	"time"

	"github.com/dev-fan-sophon/boxai/common"
	"github.com/dev-fan-sophon/boxai/model"

	"github.com/gin-gonic/gin"
)

// analyticsDefaultRangeDays is used when the caller does not pin a window, and
// analyticsMaxRangeDays bounds it so a single request cannot scan years of
// rollup rows.
const (
	analyticsDefaultRangeDays = 30
	analyticsMaxRangeDays     = 366
)

// analyticsTimeRange resolves start_timestamp / end_timestamp query parameters
// into a bounded window aligned to local calendar days, which is the grain the
// rollup tables are stored at.
func analyticsTimeRange(c *gin.Context) (int64, int64) {
	end, err := strconv.ParseInt(c.Query("end_timestamp"), 10, 64)
	if err != nil || end <= 0 {
		end = common.GetTimestamp()
	}
	start, err := strconv.ParseInt(c.Query("start_timestamp"), 10, 64)
	if err != nil || start <= 0 {
		start = model.StartOfLocalDay(time.Unix(end, 0).AddDate(0, 0, -(analyticsDefaultRangeDays - 1)))
	}
	if start > end {
		start, end = end, start
	}
	maxSpan := int64(analyticsMaxRangeDays) * 86400
	if end-start > maxSpan {
		start = end - maxSpan
	}
	return model.StartOfLocalDay(time.Unix(start, 0)), end
}

func GetUserGrowthOverview(c *gin.Context) {
	start, end := analyticsTimeRange(c)
	overview, err := model.GetUserGrowthOverview(start, end)
	if err != nil {
		common.ApiError(c, err)
		return
	}
	common.ApiSuccess(c, overview)
}

func GetUserFunnelAnalytics(c *gin.Context) {
	start, end := analyticsTimeRange(c)
	stages, err := model.GetUserFunnel(start, end)
	if err != nil {
		common.ApiError(c, err)
		return
	}
	common.ApiSuccess(c, stages)
}

func GetUserRetentionAnalytics(c *gin.Context) {
	start, end := analyticsTimeRange(c)
	offsets, _ := strconv.Atoi(c.Query("offsets"))
	cohorts, err := model.GetUserRetentionCohorts(start, end, offsets)
	if err != nil {
		common.ApiError(c, err)
		return
	}
	common.ApiSuccess(c, cohorts)
}

func GetUserRevenueAnalytics(c *gin.Context) {
	start, end := analyticsTimeRange(c)
	analytics, err := model.GetRevenueAnalytics(start, end)
	if err != nil {
		common.ApiError(c, err)
		return
	}
	common.ApiSuccess(c, analytics)
}

func GetUserAcquisitionAnalytics(c *gin.Context) {
	start, end := analyticsTimeRange(c)
	analytics, err := model.GetAcquisitionAnalytics(start, end)
	if err != nil {
		common.ApiError(c, err)
		return
	}
	common.ApiSuccess(c, analytics)
}
