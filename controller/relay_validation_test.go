package controller

import (
	"net/http"
	"net/http/httptest"
	"strings"
	"testing"

	"github.com/dev-fan-sophon/boxai/common"
	"github.com/dev-fan-sophon/boxai/common/limiter"
	"github.com/dev-fan-sophon/boxai/types"
	"github.com/gin-gonic/gin"
	"github.com/stretchr/testify/assert"
	"github.com/stretchr/testify/require"
)

func TestRelayRequestValidationStatus(t *testing.T) {
	for _, protocol := range []struct {
		name   string
		path   string
		format types.RelayFormat
	}{
		{"OpenAI", "/v1/chat/completions", types.RelayFormatOpenAI},
		{"Claude", "/v1/messages", types.RelayFormatClaude},
	} {
		for _, test := range []struct {
			name       string
			body       string
			limitBody  bool
			wantStatus int
			wantCode   types.ErrorCode
		}{
			{"negative max_tokens", `{"model":"test-model","messages":[{"role":"user","content":"hello"}],"max_tokens":-1}`, false, http.StatusBadRequest, types.ErrorCodeInvalidRequest},
			{"malformed JSON", `{`, false, http.StatusBadRequest, types.ErrorCodeInvalidRequest},
			{"body too large", `{"model":"test-model"}`, true, http.StatusRequestEntityTooLarge, types.ErrorCodeReadRequestBodyFailed},
		} {
			t.Run(protocol.name+"/"+test.name, func(t *testing.T) {
				w := httptest.NewRecorder()
				c, _ := gin.CreateTestContext(w)
				c.Request = httptest.NewRequest(http.MethodPost, protocol.path, strings.NewReader(test.body))
				c.Request.Header.Set("Content-Type", "application/json")
				if test.limitBody {
					c.Request.Body = http.MaxBytesReader(w, c.Request.Body, 1)
				}
				t.Cleanup(func() { common.CleanupBodyStorage(c) })

				Relay(c, protocol.format)

				assert.Equal(t, test.wantStatus, w.Code)
				var response struct {
					Type  string            `json:"type"`
					Error types.OpenAIError `json:"error"`
				}
				require.NoError(t, common.Unmarshal(w.Body.Bytes(), &response))
				assert.NotEmpty(t, response.Error.Message)
				assert.Equal(t, string(types.ErrorTypeNewAPIError), response.Error.Type)
				if protocol.format == types.RelayFormatClaude {
					assert.Equal(t, "error", response.Type)
				} else {
					assert.Equal(t, string(test.wantCode), response.Error.Code)
				}
				outcome, exists := c.Get(limiter.RelayOutcomeKey)
				require.True(t, exists)
				assert.Equal(t, false, outcome)
			})
		}
	}
}
