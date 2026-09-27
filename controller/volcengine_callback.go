package controller

import (
	"io"
	"net/http"
	"time"

	"github.com/dev-fan-sophon/boxai/model"
	"github.com/dev-fan-sophon/boxai/relay/channel/task/sora"
	"github.com/gin-gonic/gin"
)

// Unauthenticated callbacks are hints only. The authenticated provider query
// remains the authority for status, output URLs and billing.
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
	now := time.Now().Unix()
	if err := model.DB.WithContext(c.Request.Context()).Model(&model.Task{}).
		Where("id = ? AND status NOT IN ? AND next_poll_at > ?", task.ID,
			[]model.TaskStatus{model.TaskStatusSuccess, model.TaskStatusFailure}, now).
		Update("next_poll_at", now).Error; err != nil {
		c.Status(http.StatusInternalServerError)
		return
	}
	c.Status(http.StatusOK)
}
