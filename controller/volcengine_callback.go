package controller

import (
	"io"
	"net/http"

	"github.com/dev-fan-sophon/boxai/model"
	"github.com/dev-fan-sophon/boxai/relay/channel/task/sora"
	"github.com/dev-fan-sophon/boxai/service"
	"github.com/gin-gonic/gin"
)

// VolcengineTaskCallback receives Ark contents task status changes so the API
// process does not have to poll a finished task. The body matches the query
// task response. Polling remains the fallback when delivery fails.
func VolcengineTaskCallback(c *gin.Context) {
	body, err := io.ReadAll(io.LimitReader(c.Request.Body, 1<<20))
	if err != nil {
		c.Status(http.StatusBadRequest)
		return
	}
	info, err := sora.ParseVolcengineGatewayCallback(body)
	if err != nil || info.TaskID == "" {
		c.Status(http.StatusBadRequest)
		return
	}
	task, exists, err := model.GetByUpstreamTaskID(info.TaskID)
	if err != nil || !exists {
		c.Status(http.StatusAccepted)
		return
	}
	if info.Status != "" {
		task.Status = model.TaskStatus(info.Status)
	}
	if info.Progress != "" {
		task.Progress = info.Progress
	}
	if info.Url != "" {
		task.PrivateData.ResultURL = info.Url
	}
	if info.Reason != "" {
		task.FailReason = info.Reason
	}
	task.Data = body
	if err := model.DB.Model(task).Select("status", "progress", "fail_reason", "data", "private_data").Updates(task).Error; err != nil {
		c.Status(http.StatusInternalServerError)
		return
	}
	if task.Status == model.TaskStatusSuccess && info.Url != "" {
		service.QueuePlaygroundVideoOutputReconciliation(task.TaskID, task.UserId, info.Url)
	}
	c.Status(http.StatusOK)
}
