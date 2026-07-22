package controller

import (
	"bytes"
	"encoding/json"
	"net/http"
	"net/http/httptest"
	"testing"

	"github.com/QuantumNous/new-api/service"
	"github.com/QuantumNous/new-api/setting/ratio_setting"
	"github.com/gin-gonic/gin"
	"github.com/stretchr/testify/assert"
	"github.com/stretchr/testify/require"
)

func TestPlaygroundEstimateHandler(t *testing.T) {
	gin.SetMode(gin.TestMode)
	err := ratio_setting.UpdateModelPriceByJSONString(`{"pg-est-handler":0.02}`)
	require.NoError(t, err)

	body, _ := json.Marshal(service.PlaygroundEstimateRequest{
		Modality: "image",
		Model:    "pg-est-handler",
		Group:    "default",
		N:        1,
	})
	w := httptest.NewRecorder()
	c, _ := gin.CreateTestContext(w)
	c.Request = httptest.NewRequest(http.MethodPost, "/api/playground/estimate", bytes.NewReader(body))
	c.Request.Header.Set("Content-Type", "application/json")

	PlaygroundEstimate(c)

	assert.Equal(t, http.StatusOK, w.Code)
	var resp map[string]any
	require.NoError(t, json.Unmarshal(w.Body.Bytes(), &resp))
	assert.Equal(t, true, resp["success"])
	data, ok := resp["data"].(map[string]any)
	require.True(t, ok)
	assert.Equal(t, "per_request", data["kind"])
}
