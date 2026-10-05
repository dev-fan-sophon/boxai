package service

import (
	"testing"

	"github.com/dev-fan-sophon/boxai/common"
	"github.com/dev-fan-sophon/boxai/dto"
	"github.com/stretchr/testify/require"
)

func TestTrialRequestOutputAndFeatureLimits(t *testing.T) {
	for _, tc := range []struct {
		name    string
		body    string
		format  string
		allowed bool
	}{
		{"openai boundary", `{"max_tokens":128}`, "openai", true},
		{"missing bound", `{}`, "openai", false},
		{"zero bound", `{"max_tokens":0}`, "openai", false},
		{"over boundary", `{"max_tokens":129}`, "openai", false},
		{"legacy override", `{"max_tokens":129,"max_completion_tokens":100}`, "openai", false},
		{"multiple outputs", `{"max_tokens":100,"n":2}`, "openai", false},
		{"passthrough", `{"max_tokens":100,"extra_body":{"max_tokens":10000}}`, "openai", false},
		{"responses boundary", `{"max_output_tokens":128}`, "responses", true},
		{"responses chain", `{"max_output_tokens":128,"previous_response_id":"previous"}`, "responses", false},
		{"claude boundary", `{"max_tokens":128}`, "claude", true},
		{"claude legacy override", `{"max_tokens":100,"max_tokens_to_sample":129}`, "claude", false},
		{"gemini boundary", `{"generationConfig":{"maxOutputTokens":128}}`, "gemini", true},
		{"gemini candidates", `{"generationConfig":{"maxOutputTokens":128,"candidateCount":2}}`, "gemini", false},
		{"gemini media", `{"generationConfig":{"maxOutputTokens":128,"responseModalities":["IMAGE"]}}`, "gemini", false},
	} {
		t.Run(tc.name, func(t *testing.T) {
			var request dto.Request
			switch tc.format {
			case "openai":
				request = &dto.GeneralOpenAIRequest{}
			case "responses":
				request = &dto.OpenAIResponsesRequest{}
			case "claude":
				request = &dto.ClaudeRequest{}
			case "gemini":
				request = &dto.GeminiChatRequest{}
			}
			require.NoError(t, common.UnmarshalJsonStr(tc.body, request))
			err := validateTrialRequest(request, 128)
			if tc.allowed {
				require.NoError(t, err)
			} else {
				require.Error(t, err)
			}
		})
	}
}
