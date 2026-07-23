package openai

import (
	"io"
	"net/http"
	"net/http/httptest"
	"strings"
	"testing"

	"github.com/QuantumNous/new-api/dto"
	relaycommon "github.com/QuantumNous/new-api/relay/common"
	"github.com/gin-gonic/gin"
	"github.com/stretchr/testify/assert"
	"github.com/stretchr/testify/require"
)

func TestOaiResponsesHandlerCountsActualManagedSearchCalls(t *testing.T) {
	tests := []struct {
		name string
		body string
		web  int
		x    int
	}{
		{name: "configured but unused", body: `{"status":"completed","tools":[{"type":"web_search"},{"type":"x_search"}],"output":[{"type":"message","content":[{"type":"output_text","text":"answer"}]}],"usage":{"input_tokens":1,"output_tokens":1,"total_tokens":2}}`},
		{name: "repeated web", body: `{"status":"completed","output":[{"type":"web_search_call"},{"type":"web_search_call"},{"type":"message","content":[{"type":"output_text","text":"answer"}]}],"usage":{"input_tokens":1,"output_tokens":1,"total_tokens":2}}`, web: 2},
		{name: "mixed", body: `{"status":"completed","output":[{"type":"web_search_call"},{"type":"x_search_call"},{"type":"x_search_call"},{"type":"message","content":[{"type":"output_text","text":"answer"}]}],"usage":{"input_tokens":1,"output_tokens":1,"total_tokens":2}}`, web: 1, x: 2},
		{name: "Sub2API X fallback", body: `{"status":"completed","output":[{"type":"custom_tool_call","name":"x_user_search"},{"type":"custom_tool_call","name":"x_keyword_search"},{"type":"custom_tool_call","name":"x_thread_fetch"},{"type":"message","content":[{"type":"output_text","text":"answer"}]}],"usage":{"input_tokens":1,"output_tokens":1,"total_tokens":2}}`, x: 3},
		{name: "authoritative upstream details", body: `{"status":"completed","output":[{"type":"web_search_call"},{"type":"custom_tool_call","name":"x_keyword_search"},{"type":"message","content":[{"type":"output_text","text":"answer"}]}],"usage":{"input_tokens":1,"output_tokens":1,"total_tokens":2,"num_server_side_tools_used":12,"server_side_tool_usage_details":{"web_search_calls":1,"x_search_calls":11}}}`, web: 1, x: 11},
	}
	for _, tt := range tests {
		t.Run(tt.name, func(t *testing.T) {
			recorder := httptest.NewRecorder()
			c, _ := gin.CreateTestContext(recorder)
			c.Request = httptest.NewRequest(http.MethodPost, "/pg/responses", nil)
			c.Set("playground_managed_search", true)
			resp := &http.Response{StatusCode: http.StatusOK, Header: http.Header{"Content-Type": []string{"application/json"}}, Body: io.NopCloser(strings.NewReader(tt.body))}
			info := &relaycommon.RelayInfo{ResponsesUsageInfo: &relaycommon.ResponsesUsageInfo{BuiltInTools: map[string]*relaycommon.BuildInToolInfo{
				dto.BuildInToolXAIWebSearch: {}, dto.BuildInToolXAIXSearch: {},
			}}}

			usage, apiErr := OaiResponsesHandler(c, info, resp)
			require.Nil(t, apiErr)
			require.NotNil(t, usage)
			assert.Empty(t, recorder.Body.String())
			assert.Equal(t, tt.web, info.ResponsesUsageInfo.BuiltInTools[dto.BuildInToolXAIWebSearch].CallCount)
			assert.Equal(t, tt.x, info.ResponsesUsageInfo.BuiltInTools[dto.BuildInToolXAIXSearch].CallCount)
		})
	}
}
