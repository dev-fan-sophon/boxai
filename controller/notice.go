package controller

import (
	"strconv"

	"github.com/dev-fan-sophon/boxai/common"
	"github.com/dev-fan-sophon/boxai/model"
	"github.com/dev-fan-sophon/boxai/service"

	"github.com/gin-gonic/gin"
)

// GetNotices returns the newest published site notices, newest first.
func GetNotices(c *gin.Context) {
	notices, err := model.ListSystemNotices(model.SystemNoticeListLimit)
	if err != nil {
		common.ApiError(c, err)
		return
	}
	common.ApiSuccess(c, notices)
}

type publishNoticeRequest struct {
	Content string `json:"content"`
}

// PublishNotice appends a new site notice without replacing earlier ones.
func PublishNotice(c *gin.Context) {
	var req publishNoticeRequest
	if err := common.DecodeJson(c.Request.Body, &req); err != nil {
		common.ApiErrorMsg(c, "invalid request body")
		return
	}
	notice, err := model.CreateSystemNotice(req.Content)
	if err != nil {
		common.ApiError(c, err)
		return
	}
	common.ApiSuccess(c, notice)
}

func DeleteNotice(c *gin.Context) {
	id, err := strconv.Atoi(c.Param("id"))
	if err != nil {
		common.ApiErrorMsg(c, "invalid notice id")
		return
	}
	if err := model.DeleteSystemNotice(id); err != nil {
		common.ApiError(c, err)
		return
	}
	common.ApiSuccess(c, nil)
}

// GetSelfQuotaForecast reports the caller's balance runway and whether the
// in-app low-balance warning should show.
func GetSelfQuotaForecast(c *gin.Context) {
	forecast, err := service.GetUserQuotaForecast(c.GetInt("id"))
	if err != nil {
		common.ApiError(c, err)
		return
	}
	common.ApiSuccess(c, forecast)
}
