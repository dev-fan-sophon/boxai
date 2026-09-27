package controller

import (
	"net/http"
	"net/http/httptest"
	"strings"
	"testing"
	"time"

	"github.com/dev-fan-sophon/boxai/model"
	"github.com/gin-gonic/gin"
	"github.com/stretchr/testify/assert"
	"github.com/stretchr/testify/require"
)

func TestVolcengineCallbackCannotSettleOrReplaceOutput(t *testing.T) {
	db := setupVideoProxyTestDB(t)
	task := &model.Task{TaskID: "callback-upstream", UserId: 42, Status: model.TaskStatusInProgress,
		Quota: 123, NextPollAt: time.Now().Add(time.Minute).Unix(),
		PrivateData: model.TaskPrivateData{UpstreamTaskID: "callback-upstream", ResultURL: "original"}}
	require.NoError(t, db.Create(task).Error)
	router := gin.New()
	router.POST("/callback", VolcengineTaskCallback)
	for _, status := range []model.TaskStatus{model.TaskStatusInProgress, model.TaskStatusSuccess} {
		require.NoError(t, db.Model(task).Update("status", status).Error)
		recorder := httptest.NewRecorder()
		router.ServeHTTP(recorder, httptest.NewRequest(http.MethodPost, "/callback", strings.NewReader(
			`{"id":"callback-upstream","status":"succeeded","content":{"video_url":"https://attacker.invalid/output"},"usage":{"total_tokens":1}}`)))
		assert.Equal(t, http.StatusOK, recorder.Code)
		var got model.Task
		require.NoError(t, db.First(&got, task.ID).Error)
		assert.Equal(t, status, got.Status)
		assert.Equal(t, 123, got.Quota)
		assert.Equal(t, "original", got.PrivateData.ResultURL)
		assert.False(t, got.BillingSettled)
		assert.Zero(t, got.FinishTime)
		assert.Empty(t, got.Data)
		assert.LessOrEqual(t, got.NextPollAt, time.Now().Unix())
	}
}
