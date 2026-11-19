package geminichat

import (
	"strings"
	"testing"

	"github.com/dev-fan-sophon/boxai/common"
	"github.com/dev-fan-sophon/boxai/constant"
	"github.com/dev-fan-sophon/boxai/dto"
	"github.com/stretchr/testify/assert"
	"github.com/stretchr/testify/require"
	"github.com/tidwall/gjson"
)

func renderGeminiTextParts(t *testing.T, texts []string) map[string]string {
	t.Helper()
	parts := make([]dto.GeminiPart, len(texts))
	for i, text := range texts {
		parts[i] = dto.GeminiPart{Text: text}
	}

	response := ResponseGeminiChat2OpenAI("chatcmpl-test", 1, &dto.GeminiChatResponse{Candidates: []dto.GeminiChatCandidate{{
		Content:      dto.GeminiChatContent{Role: "model", Parts: parts},
		FinishReason: common.GetPointer("STOP"),
	}}})
	require.Len(t, response.Choices, 1)

	event, _ := StreamResponseGeminiChat2OpenAI(&dto.GeminiChatResponse{Candidates: []dto.GeminiChatCandidate{{
		Content: dto.GeminiChatContent{Role: "model", Parts: parts},
	}}})
	require.Len(t, event.Choices, 1)

	state := NewGeminiToChatStreamState("chatcmpl-test", "gemini-test", 1)
	var streamed strings.Builder
	for _, part := range parts {
		chunks := state.ConvertChunk(&dto.GeminiChatResponse{Candidates: []dto.GeminiChatCandidate{{
			Content: dto.GeminiChatContent{Role: "model", Parts: []dto.GeminiPart{part}},
		}}}, "gemini-test", nil)
		for _, chunk := range chunks {
			for _, choice := range chunk.Choices {
				streamed.WriteString(choice.Delta.GetContentString())
			}
		}
	}

	return map[string]string{
		"non-stream":            response.Choices[0].Message.StringContent(),
		"one stream event":      event.Choices[0].Delta.GetContentString(),
		"stream event per part": streamed.String(),
	}
}

func TestGeminiToChatJoinsTextPartsVerbatim(t *testing.T) {
	for _, tt := range []struct {
		name  string
		texts []string
		want  string
		json  bool
	}{
		{name: "split word", texts: []string{"hel", "lo"}, want: "hello"},
		{name: "empty part", texts: []string{"a", "", "b"}, want: "ab"},
		{name: "newline only", texts: []string{"\n"}, want: "\n"},
		{name: "newline part", texts: []string{"a", "\n", "b"}, want: "a\nb"},
		{name: "trailing newline", texts: []string{"a\n", "b"}, want: "a\nb"},
		{name: "consecutive newline parts", texts: []string{"a", "\n", "\n", "b"}, want: "a\n\nb"},
		{name: "crlf part", texts: []string{"a", "\r\n", "b"}, want: "a\r\nb"},
		{name: "spaces backslashes and unicode", texts: []string{"  路径 C:\\", "temp\\n ", "😀\t"}, want: "  路径 C:\\temp\\n 😀\t"},
		{name: "json split in key", texts: []string{`{"reply`, `":"你好","reactions":[]}`}, want: `{"reply":"你好","reactions":[]}`, json: true},
		{name: "json split in chinese value", texts: []string{`{"reply":"你`, `好","reactions":[]}`}, want: `{"reply":"你好","reactions":[]}`, json: true},
		{name: "json split in number", texts: []string{`{"count":12`, `345}`}, want: `{"count":12345}`, json: true},
		{name: "json split in escape", texts: []string{`{"quote":"say \`, `"hi\"\u4f`, `60"}`}, want: `{"quote":"say \"hi\"\u4f60"}`, json: true},
		{name: "json split at whitespace boundary", texts: []string{`{"a":1,`, `"b":[1,2]}`}, want: `{"a":1,"b":[1,2]}`, json: true},
	} {
		t.Run(tt.name, func(t *testing.T) {
			for form, got := range renderGeminiTextParts(t, tt.texts) {
				assert.Equal(t, tt.want, got, form)
				if tt.json {
					assert.True(t, gjson.Valid(got), form)
				}
			}
		})
	}
}

func TestGeminiToChatRestoresJSONSplitAtEveryCharacterBoundary(t *testing.T) {
	const original = `{"reply":"你好，\"世界\"\n","reactions":[],"count":-12.5e3}`
	require.True(t, gjson.Valid(original))
	for offset := range original {
		if offset == 0 {
			continue
		}
		for form, got := range renderGeminiTextParts(t, []string{original[:offset], original[offset:]}) {
			assert.Equal(t, original, got, "split at byte %d, %s", offset, form)
		}
	}
}

func TestGeminiToChatSeparatesOnlyStructuredBlocks(t *testing.T) {
	image := dto.GeminiPart{InlineData: &dto.GeminiInlineData{MimeType: "image/png", Data: "iVBO"}}
	code := dto.GeminiPart{ExecutableCode: &dto.GeminiPartExecutableCode{Language: "python", Code: "print(1)"}}
	output := dto.GeminiPart{CodeExecutionResult: &dto.GeminiPartCodeExecutionResult{Outcome: "OUTCOME_OK", Output: "1"}}
	call := dto.GeminiPart{FunctionCall: &dto.FunctionCall{ID: []byte(`"call_weather"`), FunctionName: "get_weather", Arguments: map[string]any{"city": "Paris"}}}
	for _, tt := range []struct {
		name       string
		parts      []dto.GeminiPart
		want       string
		wantStream string
		toolCalls  int
	}{
		{
			name:       "text around image",
			parts:      []dto.GeminiPart{{Text: "See"}, {Text: " this:"}, image, {Text: "Done"}, {Text: "."}},
			want:       "See this:\n![image](data:image/png;base64,iVBO)\nDone.",
			wantStream: "See this:\n![image](data:image/png;base64,iVBO)\nDone.",
		},
		{
			name:       "empty text beside image",
			parts:      []dto.GeminiPart{{Text: ""}, image, {Text: ""}, {Text: "ok"}},
			want:       "![image](data:image/png;base64,iVBO)\nok",
			wantStream: "![image](data:image/png;base64,iVBO)\nok",
		},
		{
			name:       "code execution",
			parts:      []dto.GeminiPart{{Text: "Run"}, {Text: "ning:"}, code, output, {Text: "Result"}, {Text: " is 1."}},
			want:       "Running:\n```python\nprint(1)\n```\n```output\n1\n```\nResult is 1.",
			wantStream: "Running:\n```python\nprint(1)\n```\n\n```output\n1\n```\n\nResult is 1.",
		},
		{
			name:       "text around tool call",
			parts:      []dto.GeminiPart{{Text: "Checking"}, call, {Text: " weather."}},
			want:       "Checking weather.",
			wantStream: "Checking weather.",
			toolCalls:  1,
		},
	} {
		t.Run(tt.name, func(t *testing.T) {
			response := ResponseGeminiChat2OpenAI("chatcmpl-test", 1, &dto.GeminiChatResponse{Candidates: []dto.GeminiChatCandidate{{
				Content:      dto.GeminiChatContent{Role: "model", Parts: tt.parts},
				FinishReason: common.GetPointer("STOP"),
			}}})
			require.Len(t, response.Choices, 1)
			choice := response.Choices[0]
			assert.Equal(t, tt.want, choice.Message.StringContent())
			assert.Len(t, choice.Message.ParseToolCalls(), tt.toolCalls)
			wantFinish := constant.FinishReasonStop
			if tt.toolCalls > 0 {
				wantFinish = constant.FinishReasonToolCalls
			}
			assert.Equal(t, wantFinish, choice.FinishReason)

			event, _ := StreamResponseGeminiChat2OpenAI(&dto.GeminiChatResponse{Candidates: []dto.GeminiChatCandidate{{
				Content: dto.GeminiChatContent{Role: "model", Parts: tt.parts},
			}}})
			require.Len(t, event.Choices, 1)
			assert.Equal(t, tt.wantStream, event.Choices[0].Delta.GetContentString())
			assert.Len(t, event.Choices[0].Delta.ToolCalls, tt.toolCalls)
		})
	}
}
