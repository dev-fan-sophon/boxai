package relayconvert

import (
	"testing"

	"github.com/dev-fan-sophon/boxai/common"
	"github.com/dev-fan-sophon/boxai/dto"
	claudemessages "github.com/dev-fan-sophon/boxai/service/relayconvert/internal/claude_messages"
	oairesponses "github.com/dev-fan-sophon/boxai/service/relayconvert/internal/oai_responses"
	"github.com/stretchr/testify/assert"
	"github.com/stretchr/testify/require"
)

func TestToolResultImagesAcrossRequestFormats(t *testing.T) {
	const imageURL = "data:image/png;base64,aGVsbG8="
	input := []byte(`[
	{"type":"function_call","call_id":"a","name":"first","arguments":"{}"},
	{"type":"function_call","call_id":"b","name":"second","arguments":"{}"},
	{"type":"function_call_output","call_id":"a","output":[{"type":"input_text","text":"before"},{"type":"input_image","image_url":"` + imageURL + `"},{"type":"input_text","text":"after"}]},
	{"type":"function_call_output","call_id":"b","output":[{"type":"input_image","image_url":"https://example.com/b.png"}]},
	{"role":"user","content":"continue"}]
	`)
	request := &dto.OpenAIResponsesRequest{Model: "test", Input: input}
	claude, err := oairesponses.OpenAIResponsesRequestToClaudeMessages(nil, request)
	require.NoError(t, err)
	require.Len(t, claude.Messages, 4)
	results, err := claude.Messages[2].ParseContent()
	require.NoError(t, err)
	require.Len(t, results, 2)
	assert.Equal(t, "a", results[0].ToolUseId)
	assert.Equal(t, "b", results[1].ToolUseId)
	parts := results[0].ParseMediaContent()
	require.Len(t, parts, 3)
	assert.Equal(t, "before", parts[0].GetText())
	assert.Equal(t, "image", parts[1].Type)
	assert.Equal(t, &dto.ClaudeMessageSource{Type: "base64", MediaType: "image/png", Data: "aGVsbG8="}, parts[1].Source)
	assert.Equal(t, "after", parts[2].GetText())
	assert.Equal(t, &dto.ClaudeMessageSource{Type: "url", Url: "https://example.com/b.png"}, results[1].ParseMediaContent()[0].Source)

	for _, source := range []string{"responses", "claude"} {
		t.Run(source, func(t *testing.T) {
			var chat *dto.GeneralOpenAIRequest
			if source == "responses" {
				chat, err = oairesponses.ResponsesRequestToChatCompletionsRequest(request)
			} else {
				// Exercise the JSON-decoded path, not only in-memory DTO slices.
				raw, marshalErr := common.Marshal(claude)
				require.NoError(t, marshalErr)
				var decoded dto.ClaudeRequest
				require.NoError(t, common.Unmarshal(raw, &decoded))
				chat, err = claudemessages.ClaudeMessagesRequestToOpenAIChat(decoded, nil)
			}
			require.NoError(t, err)
			messages := chat.Messages
			if source == "claude" {
				messages = messages[1:] // Existing Claude leading-user normalization.
			}
			require.Len(t, messages, 5)
			assert.Len(t, messages[0].ParseToolCalls(), 2)
			assert.Equal(t, "tool", messages[1].Role)
			assert.Equal(t, "a", messages[1].ToolCallId)
			assert.Equal(t, "beforeafter", messages[1].Content)
			assert.Equal(t, "tool", messages[2].Role)
			assert.Equal(t, "b", messages[2].ToolCallId)
			assert.Equal(t, "", messages[2].Content)
			assert.Equal(t, "user", messages[3].Role)
			media := messages[3].ParseContent()
			require.Len(t, media, 6)
			assert.Contains(t, media[0].Text, "a")
			assert.Equal(t, "before", media[1].Text)
			assert.Equal(t, imageURL, media[2].GetImageMedia().Url)
			assert.Equal(t, "after", media[3].Text)
			assert.Contains(t, media[4].Text, "b")
			assert.Equal(t, "https://example.com/b.png", media[5].GetImageMedia().Url)
			lastParts := messages[4].ParseContent()
			require.Len(t, lastParts, 1)
			assert.Equal(t, "continue", lastParts[0].Text)
		})
	}
}

func TestToolResultUnsupportedMediaFails(t *testing.T) {
	for _, block := range []string{
		`{"type":"input_audio","input_audio":{"data":"YQ==","format":"wav"}}`,
		`{"type":"input_file","file_id":"file-1"}`,
		`{"type":"input_video","video_url":"https://example.com/video"}`,
		`{"type":"input_image","file_id":"file-1"}`,
		`{"type":"input_image","image_url":"data:application/pdf;base64,YQ=="}`,
		`{"type":"input_image"}`,
		`{"type":"unknown"}`,
	} {
		request := &dto.OpenAIResponsesRequest{Model: "test", Input: []byte(`[{"type":"function_call_output","call_id":"a","output":[` + block + `]}]`)}
		_, err := oairesponses.ResponsesRequestToChatCompletionsRequest(request)
		require.Error(t, err)
		_, err = oairesponses.OpenAIResponsesRequestToClaudeMessages(nil, request)
		require.Error(t, err)
	}
	for _, content := range []any{
		[]dto.ClaudeMediaMessage{{Type: "document"}},
		[]dto.ClaudeMediaMessage{{Type: "image"}},
		map[string]any{"unexpected": "object"},
	} {
		_, err := claudemessages.ClaudeMessagesRequestToOpenAIChat(dto.ClaudeRequest{
			Messages: []dto.ClaudeMessage{{Role: "user", Content: []dto.ClaudeMediaMessage{{Type: "tool_result", ToolUseId: "a", Content: content}}}},
		}, nil)
		require.Error(t, err)
	}
}

func TestToolResultTextAndTrailingImage(t *testing.T) {
	for _, output := range []string{`"plain"`, `[{"type":"input_text","text":"plain"}]`, `[]`, `null`} {
		chat, err := oairesponses.ResponsesRequestToChatCompletionsRequest(&dto.OpenAIResponsesRequest{
			Model: "test", Input: []byte(`[{"type":"function_call_output","call_id":"a","output":` + output + `}]`),
		})
		require.NoError(t, err)
		require.Len(t, chat.Messages, 1)
		assert.Equal(t, "a", chat.Messages[0].ToolCallId)
		expected := "plain"
		if output == `[]` || output == `null` {
			expected = ""
		}
		assert.Equal(t, expected, chat.Messages[0].Content)
	}
	chat, err := oairesponses.ResponsesRequestToChatCompletionsRequest(&dto.OpenAIResponsesRequest{
		Model: "test", Input: []byte(`[{"type":"function_call_output","call_id":"a","output":[{"type":"input_image","image_url":"https://example.com/a.png"}]}]`),
	})
	require.NoError(t, err)
	require.Len(t, chat.Messages, 2)
	assert.Equal(t, "", chat.Messages[0].Content)
	assert.Equal(t, "user", chat.Messages[1].Role)
	parts := chat.Messages[1].ParseContent()
	require.Len(t, parts, 2)
	assert.Equal(t, "https://example.com/a.png", parts[1].GetImageMedia().Url)
}
