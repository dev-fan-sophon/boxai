package controller

import (
	"net/http/httptest"
	"strings"
	"testing"

	"github.com/dev-fan-sophon/boxai/common/limiter"
	"github.com/dev-fan-sophon/boxai/types"
	"github.com/gin-gonic/gin"
	"github.com/stretchr/testify/assert"
	"github.com/stretchr/testify/require"
)

func TestRelayPublishesFailureDespiteCommittedHTTP200(t *testing.T) {
	w := httptest.NewRecorder()
	c, _ := gin.CreateTestContext(w)
	c.Request = httptest.NewRequest("POST", "/v1/chat/completions", strings.NewReader("{"))
	c.Request.Header.Set("Content-Type", "application/json")
	c.Writer.WriteHeader(200)
	c.Writer.Flush()
	Relay(c, types.RelayFormatOpenAI)
	outcome, exists := c.Get(limiter.RelayOutcomeKey)
	require.True(t, exists)
	assert.Equal(t, false, outcome)
	assert.Equal(t, 200, w.Code, "already committed status cannot expose final protocol error")
}
