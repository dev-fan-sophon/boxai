package oairesponses

import (
	"testing"

	"github.com/dev-fan-sophon/boxai/dto"
	relaycommon "github.com/dev-fan-sophon/boxai/relay/common"
	"github.com/stretchr/testify/assert"
	"github.com/stretchr/testify/require"
)

// Claude and Gemini continue a final assistant turn as a prefill, which newer
// models reject, so trailing assistant history after a user turn is dropped.
func TestResponsesTrailingAssistantTextOmittedForClaudeAndGemini(t *testing.T) {
	tests := []struct {
		name       string
		input      string
		wantClaude []string
		wantGemini []string
	}{
		{
			name:       "assistant answer after user is dropped",
			input:      `[{"role":"user","content":"hi"},{"role":"assistant","content":"hello"},{"role":"assistant","content":"again"}]`,
			wantClaude: []string{"user"},
			wantGemini: []string{"user"},
		},
		{
			name:       "assistant answer after tool result is dropped",
			input:      `[{"role":"user","content":"hi"},{"type":"function_call","call_id":"a","name":"f","arguments":"{}"},{"type":"function_call_output","call_id":"a","output":"ok"},{"role":"assistant","content":"done"}]`,
			wantClaude: []string{"user", "assistant", "user"},
			wantGemini: []string{"user", "model", "user"},
		},
		{
			name:       "pending tool call is kept",
			input:      `[{"role":"user","content":"hi"},{"type":"function_call","call_id":"a","name":"f","arguments":"{}"}]`,
			wantClaude: []string{"user", "assistant"},
			wantGemini: []string{"user", "model"},
		},
		{
			// Claude additionally gets its leading-user normalization.
			name:       "assistant-only input is kept",
			input:      `[{"role":"assistant","content":"hello"}]`,
			wantClaude: []string{"user", "assistant"},
			wantGemini: []string{"model"},
		},
	}
	for _, tt := range tests {
		t.Run(tt.name, func(t *testing.T) {
			request := &dto.OpenAIResponsesRequest{Model: "test", Input: []byte(tt.input)}

			claude, err := OpenAIResponsesRequestToClaudeMessages(nil, request)
			require.NoError(t, err)
			claudeRoles := make([]string, 0, len(claude.Messages))
			for _, message := range claude.Messages {
				claudeRoles = append(claudeRoles, message.Role)
			}
			assert.Equal(t, tt.wantClaude, claudeRoles)

			info := &relaycommon.RelayInfo{ChannelMeta: &relaycommon.ChannelMeta{UpstreamModelName: "gemini-3-pro"}}
			gemini, err := OpenAIResponsesRequestToGeminiChat(nil, request, info)
			require.NoError(t, err)
			geminiRoles := make([]string, 0, len(gemini.Contents))
			for _, content := range gemini.Contents {
				geminiRoles = append(geminiRoles, content.Role)
			}
			assert.Equal(t, tt.wantGemini, geminiRoles)
		})
	}
}
