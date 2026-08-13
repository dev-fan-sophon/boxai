package relayconvert

import (
	"testing"

	"github.com/dev-fan-sophon/boxai/dto"
	relaycommon "github.com/dev-fan-sophon/boxai/relay/common"
	"github.com/dev-fan-sophon/boxai/types"
	"github.com/stretchr/testify/assert"
	"github.com/stretchr/testify/require"
)

func TestGeminiToOpenAIStatefulStreamTerminal(t *testing.T) {
	tests := []struct {
		name             string
		finishReason     string
		toolCall         bool
		finishOnFinalize bool
		wantFinishReason string
		wantEmptyDelta   bool
	}{
		{name: "stop", finishReason: "STOP", wantFinishReason: "stop", wantEmptyDelta: true},
		{name: "tool call", finishReason: "STOP", toolCall: true, wantFinishReason: "tool_calls", wantEmptyDelta: true},
		{name: "max tokens", finishReason: "MAX_TOKENS", wantFinishReason: "length"},
		{name: "truncated stream", finishOnFinalize: true, wantFinishReason: "stop", wantEmptyDelta: true},
	}

	for _, tt := range tests {
		t.Run(tt.name, func(t *testing.T) {
			state, err := NewResponseStreamState(types.RelayFormatGemini, types.RelayFormatOpenAI, ResponseStreamOptions{
				ID:      "chatcmpl-fixed",
				Model:   "configured-model",
				Created: 1700000000,
			})
			require.NoError(t, err)

			results, err := ConvertStreamResponseChunk(nil, &relaycommon.RelayInfo{
				ChannelMeta: &relaycommon.ChannelMeta{UpstreamModelName: "upstream-model"},
			}, state, geminiStreamTestChunk("hello", tt.finishReason, tt.toolCall))
			require.NoError(t, err)

			finishes := geminiStreamFinishedChunks(t, results)
			if tt.finishOnFinalize {
				assert.Empty(t, finishes)
			} else {
				require.Len(t, finishes, 1)
			}

			finalResults, err := FinalizeStreamResponse(nil, nil, state)
			require.NoError(t, err)
			if tt.finishOnFinalize {
				finishes = append(finishes, geminiStreamFinishedChunks(t, finalResults)...)
			} else {
				assert.Empty(t, finalResults)
			}
			require.Len(t, finishes, 1)

			finish := finishes[0]
			require.Len(t, finish.Choices, 1)
			require.NotNil(t, finish.Choices[0].FinishReason)
			assert.Equal(t, tt.wantFinishReason, *finish.Choices[0].FinishReason)
			assert.Equal(t, "chatcmpl-fixed", finish.Id)
			assert.Equal(t, int64(1700000000), finish.Created)
			assert.Equal(t, "upstream-model", finish.Model)
			require.NotNil(t, finish.Usage)
			assert.Equal(t, 4, finish.Usage.PromptTokens)
			assert.Equal(t, 2, finish.Usage.CompletionTokens)
			assert.Equal(t, 6, finish.Usage.TotalTokens)
			if tt.wantEmptyDelta {
				assert.Nil(t, finish.Choices[0].Delta.Content)
				assert.Empty(t, finish.Choices[0].Delta.ToolCalls)
			}
			assert.Equal(t, 6, state.Usage().TotalTokens)

			repeatedFinal, err := FinalizeStreamResponse(nil, nil, state)
			require.NoError(t, err)
			assert.Empty(t, repeatedFinal)
		})
	}
}

func TestGeminiToOpenAIStatefulStreamUsesConfiguredModelWithoutRelayInfo(t *testing.T) {
	state, err := NewResponseStreamState(types.RelayFormatGemini, types.RelayFormatOpenAI, ResponseStreamOptions{
		ID:    "chatcmpl-fixed",
		Model: "configured-model",
	})
	require.NoError(t, err)

	results, err := ConvertStreamResponseChunk(nil, nil, state, geminiStreamTestChunk("hello", "STOP", false))
	require.NoError(t, err)
	require.NotEmpty(t, results)
	for _, result := range results {
		chunk, ok := result.Value.(*dto.ChatCompletionsStreamResponse)
		require.True(t, ok)
		assert.Equal(t, "configured-model", chunk.Model)
	}
}

func TestGeminiToOpenAIStatelessStreamCompatibility(t *testing.T) {
	result, err := ConvertStreamResponse(nil, &relaycommon.RelayInfo{
		ChannelMeta: &relaycommon.ChannelMeta{UpstreamModelName: "gemini-test"},
	}, types.RelayFormatOpenAI, geminiStreamTestChunk("hello", "STOP", false))
	require.NoError(t, err)

	chunk, ok := result.Value.(*dto.ChatCompletionsStreamResponse)
	require.True(t, ok)
	require.Len(t, chunk.Choices, 1)
	assert.Equal(t, "hello", chunk.Choices[0].Delta.GetContentString())
	assert.Equal(t, "gemini-test", chunk.Model)
}

func geminiStreamTestChunk(text string, finishReason string, toolCall bool) *dto.GeminiChatResponse {
	parts := []dto.GeminiPart{{Text: text}}
	if toolCall {
		parts = []dto.GeminiPart{{FunctionCall: &dto.FunctionCall{
			FunctionName: "lookup",
			Arguments:    map[string]any{"q": "x"},
		}}}
	}
	candidate := dto.GeminiChatCandidate{
		Content: dto.GeminiChatContent{Role: "model", Parts: parts},
	}
	if finishReason != "" {
		candidate.FinishReason = &finishReason
	}
	return &dto.GeminiChatResponse{
		Candidates:       []dto.GeminiChatCandidate{candidate},
		HasUsageMetadata: true,
		UsageMetadata: dto.GeminiUsageMetadata{
			PromptTokenCount:     4,
			CandidatesTokenCount: 2,
			TotalTokenCount:      6,
		},
	}
}

func geminiStreamFinishedChunks(t *testing.T, results []ResponseResult) []*dto.ChatCompletionsStreamResponse {
	t.Helper()
	finished := make([]*dto.ChatCompletionsStreamResponse, 0, 1)
	for _, result := range results {
		chunk, ok := result.Value.(*dto.ChatCompletionsStreamResponse)
		require.True(t, ok, "unexpected stream result type %T", result.Value)
		if chunk.IsFinished() {
			finished = append(finished, chunk)
		}
	}
	return finished
}
