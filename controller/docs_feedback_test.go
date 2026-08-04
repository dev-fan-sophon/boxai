package controller

import (
	"bytes"
	"encoding/json"
	"net/http"
	"net/http/httptest"
	"testing"

	"github.com/gin-gonic/gin"
	"github.com/stretchr/testify/assert"
	"github.com/stretchr/testify/require"
)

func TestSubmitDocsFeedbackRequiresHelpful(t *testing.T) {
	gin.SetMode(gin.TestMode)
	w := httptest.NewRecorder()
	c, _ := gin.CreateTestContext(w)
	body := bytes.NewBufferString(`{"path":"docs/start/getting-started"}`)
	c.Request = httptest.NewRequest(http.MethodPost, "/api/docs/feedback", body)
	c.Request.Header.Set("Content-Type", "application/json")

	SubmitDocsFeedback(c)

	require.Equal(t, http.StatusOK, w.Code)
	var resp map[string]any
	require.NoError(t, json.Unmarshal(w.Body.Bytes(), &resp))
	assert.Equal(t, false, resp["success"])
}

func TestSubmitDocsFeedbackAcceptsValidPayload(t *testing.T) {
	gin.SetMode(gin.TestMode)
	w := httptest.NewRecorder()
	c, _ := gin.CreateTestContext(w)
	payload := map[string]any{
		"path":    "start/getting-started",
		"helpful": true,
		"comment": "clear steps",
		"locale":  "vi",
	}
	raw, err := json.Marshal(payload)
	require.NoError(t, err)
	c.Request = httptest.NewRequest(http.MethodPost, "/api/docs/feedback", bytes.NewReader(raw))
	c.Request.Header.Set("Content-Type", "application/json")

	SubmitDocsFeedback(c)

	require.Equal(t, http.StatusOK, w.Code)
	var resp map[string]any
	require.NoError(t, json.Unmarshal(w.Body.Bytes(), &resp))
	assert.Equal(t, true, resp["success"])
}

func TestSubmitDocsFeedbackRejectsPathTraversal(t *testing.T) {
	gin.SetMode(gin.TestMode)
	w := httptest.NewRecorder()
	c, _ := gin.CreateTestContext(w)
	helpful := true
	payload := map[string]any{
		"path":    "../etc/passwd",
		"helpful": helpful,
	}
	raw, err := json.Marshal(payload)
	require.NoError(t, err)
	c.Request = httptest.NewRequest(http.MethodPost, "/api/docs/feedback", bytes.NewReader(raw))
	c.Request.Header.Set("Content-Type", "application/json")

	SubmitDocsFeedback(c)

	require.Equal(t, http.StatusOK, w.Code)
	var resp map[string]any
	require.NoError(t, json.Unmarshal(w.Body.Bytes(), &resp))
	assert.Equal(t, false, resp["success"])
}
