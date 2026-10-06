package geminichat

import (
	"testing"

	"github.com/dev-fan-sophon/boxai/common"
	"github.com/dev-fan-sophon/boxai/dto"
	"github.com/stretchr/testify/assert"
	"github.com/stretchr/testify/require"
)

func convertGeminiJSON(t *testing.T, body string) (*dto.GeneralOpenAIRequest, error) {
	t.Helper()
	var request dto.GeminiChatRequest
	require.NoError(t, common.Unmarshal([]byte(body), &request))
	return GeminiGenerateContentRequestToOpenAIChat(&request, nil)
}

func TestGeminiToolCallIDsAvoidCollisions(t *testing.T) {
	request, err := convertGeminiJSON(t, `{"contents":[
		{"role":"model","parts":[{"functionCall":{"name":"lookup"}},{"functionCall":{"id":"call_1","name":"search"}}]},
		{"role":"user","parts":[{"functionResponse":{"id":"call_1","name":"search","response":{"found":true}}},{"functionResponse":{"name":"lookup","response":{"value":7}}}]}
	]}`)
	require.NoError(t, err)
	require.Len(t, request.Messages, 3)
	assert.Equal(t, "call_1", request.Messages[1].ToolCallId)
	assert.Equal(t, "call_2", request.Messages[2].ToolCallId)
	for _, id := range []string{`"call_1"`, `42`, `""`} {
		_, err := convertGeminiJSON(t, `{"contents":[{"role":"model","parts":[{"functionCall":{"id":"call_1","name":"lookup"}},{"functionCall":{"id":`+id+`,"name":"search"}}]}]}`)
		require.ErrorContains(t, err, "unique non-empty string")
	}
}

func TestGeminiToOpenAIChatRejectsInvalidOrEmptyContent(t *testing.T) {
	tests := []struct {
		name    string
		body    string
		wantErr string
	}{
		{
			name:    "part without data member",
			body:    `{"contents":[{"role":"user","parts":[{"text":"hi"},{"thoughtSignature":"sig"}]}]}`,
			wantErr: "contents[0].parts[1] must set exactly one Gemini data field",
		},
		{
			name:    "part with two data members",
			body:    `{"contents":[{"role":"user","parts":[{"text":"hi","inlineData":{"mimeType":"image/png","data":"AAAA"}}]}]}`,
			wantErr: "contents[0].parts[0] must set exactly one Gemini data field",
		},
		{
			name:    "only empty text parts",
			body:    `{"contents":[{"role":"user","parts":[{"text":""}]},{"role":"model","parts":[{"text":"","thoughtSignature":"sig"}]}]}`,
			wantErr: "contents contain no content that can be converted",
		},
		{
			name:    "system-only request with empty contents text",
			body:    `{"systemInstruction":{"parts":[{"text":"be brief"}]},"contents":[{"role":"user","parts":[{"text":""}]}]}`,
			wantErr: "contents contain no content that can be converted",
		},
		{
			name:    "non-text system instruction part",
			body:    `{"systemInstruction":{"parts":[{"inlineData":{"mimeType":"image/png","data":"AAAA"}}]},"contents":[{"role":"user","parts":[{"text":"hi"}]}]}`,
			wantErr: "systemInstruction.parts[0]: only text parts",
		},
		{
			name:    "inline data without data",
			body:    `{"contents":[{"role":"user","parts":[{"inlineData":{"mimeType":"image/png","data":""}}]}]}`,
			wantErr: "contents[0].parts[0]: inlineData requires non-empty mimeType and data",
		},
		{
			name:    "unsupported audio format",
			body:    `{"contents":[{"role":"user","parts":[{"inlineData":{"mimeType":"audio/ogg","data":"AAAA"}}]}]}`,
			wantErr: "input_audio supports only wav and mp3",
		},
		{
			name:    "unsupported inline document type",
			body:    `{"contents":[{"role":"user","parts":[{"inlineData":{"mimeType":"application/zip","data":"AAAA"}}]}]}`,
			wantErr: `inlineData "application/zip" cannot be represented`,
		},
		{
			name:    "gemini files api reference",
			body:    `{"contents":[{"role":"user","parts":[{"fileData":{"mimeType":"image/png","fileUri":"https://generativelanguage.googleapis.com/v1beta/files/abc"}}]}]}`,
			wantErr: "only public http(s) image URLs are supported",
		},
		{
			name:    "non-image file reference",
			body:    `{"contents":[{"role":"user","parts":[{"fileData":{"mimeType":"video/mp4","fileUri":"https://www.youtube.com/watch?v=x"}}]}]}`,
			wantErr: "only public http(s) image URLs are supported",
		},
		{
			name:    "cloud storage file reference",
			body:    `{"contents":[{"role":"user","parts":[{"fileData":{"mimeType":"image/png","fileUri":"gs://bucket/a.png"}}]}]}`,
			wantErr: "only public http(s) image URLs are supported",
		},
		{
			name:    "video metadata",
			body:    `{"contents":[{"role":"user","parts":[{"inlineData":{"mimeType":"video/mp4","data":"AAAA"},"videoMetadata":{"startOffset":"1s"}}]}]}`,
			wantErr: "videoMetadata cannot be represented",
		},
		{
			name:    "audio in model turn",
			body:    `{"contents":[{"role":"user","parts":[{"text":"hi"}]},{"role":"model","parts":[{"inlineData":{"mimeType":"audio/wav","data":"AAAA"}}]}]}`,
			wantErr: "assistant messages carry only text and images",
		},
		{
			name:    "code execution parts",
			body:    `{"contents":[{"role":"user","parts":[{"text":"hi"}]},{"role":"model","parts":[{"executableCode":{"language":"PYTHON","code":"print(1)"}}]}]}`,
			wantErr: "code execution parts cannot be represented",
		},
		{
			name:    "function call in user turn",
			body:    `{"contents":[{"role":"user","parts":[{"functionCall":{"name":"lookup","args":{}}}]}]}`,
			wantErr: "functionCall is only valid in model turns",
		},
		{
			name:    "function response without matching call",
			body:    `{"contents":[{"role":"model","parts":[{"functionCall":{"name":"lookup","args":{}}}]},{"role":"user","parts":[{"functionResponse":{"name":"other","response":{}}}]}]}`,
			wantErr: `functionResponse "other" has no preceding matching functionCall`,
		},
		{
			name:    "multimodal function response",
			body:    `{"contents":[{"role":"model","parts":[{"functionCall":{"name":"lookup","args":{}}}]},{"role":"user","parts":[{"functionResponse":{"name":"lookup","response":{},"parts":[{"inlineData":{"mimeType":"image/png","data":"AAAA"}}]}}]}]}`,
			wantErr: "multimodal functionResponse.parts cannot be represented",
		},
		{
			name:    "invalid function declarations",
			body:    `{"contents":[{"role":"user","parts":[{"text":"hi"}]}],"tools":[{"functionDeclarations":"bad"}]}`,
			wantErr: "invalid gemini functionDeclarations",
		},
	}

	for _, tt := range tests {
		t.Run(tt.name, func(t *testing.T) {
			_, err := convertGeminiJSON(t, tt.body)
			require.Error(t, err)
			assert.Contains(t, err.Error(), tt.wantErr)
		})
	}
}

func TestGeminiToOpenAIChatMapsMediaBySemanticType(t *testing.T) {
	body := `{"contents":[
		{"role":"user","parts":[
			{"text":"compare"},
			{"inlineData":{"mimeType":"image/png","data":"SU1H"}},
			{"inlineData":{"mimeType":"audio/wav","data":"V0FW"}},
			{"inlineData":{"mimeType":"audio/mpeg","data":"TVAz"}},
			{"inlineData":{"mimeType":"application/pdf","data":"UERG"}},
			{"inlineData":{"mimeType":"video/mp4","data":"TVA0"}},
			{"fileData":{"mimeType":"image/jpeg","fileUri":"https://example.com/a.jpg"}},
			{"text":"","thoughtSignature":"sig"}
		]},
		{"role":"model","parts":[
			{"text":"thinking","thought":true},
			{"text":"edited"},
			{"inlineData":{"mimeType":"image/png","data":"T1VU"},"thoughtSignature":"sig"}
		]}
	]}`

	request, err := convertGeminiJSON(t, body)
	require.NoError(t, err)
	require.Len(t, request.Messages, 2)

	user := request.Messages[0]
	assert.Equal(t, "user", user.Role)
	userContent := user.ParseContent()
	require.Len(t, userContent, 7)
	assert.Equal(t, dto.MediaContent{Type: dto.ContentTypeText, Text: "compare"}, userContent[0])
	assert.Equal(t, dto.ContentTypeImageURL, userContent[1].Type)
	assert.Equal(t, "data:image/png;base64,SU1H", userContent[1].GetImageMedia().Url)
	assert.Equal(t, dto.ContentTypeInputAudio, userContent[2].Type)
	assert.Equal(t, &dto.MessageInputAudio{Data: "V0FW", Format: "wav"}, userContent[2].GetInputAudio())
	assert.Equal(t, &dto.MessageInputAudio{Data: "TVAz", Format: "mp3"}, userContent[3].GetInputAudio())
	assert.Equal(t, dto.ContentTypeFile, userContent[4].Type)
	assert.Equal(t, &dto.MessageFile{FileName: "document.pdf", FileData: "data:application/pdf;base64,UERG"}, userContent[4].GetFile())
	assert.Equal(t, dto.ContentTypeVideoUrl, userContent[5].Type)
	assert.Equal(t, "data:video/mp4;base64,TVA0", userContent[5].GetVideoUrl().Url)
	assert.Equal(t, dto.ContentTypeImageURL, userContent[6].Type)
	assert.Equal(t, "https://example.com/a.jpg", userContent[6].GetImageMedia().Url)

	assistant := request.Messages[1]
	assert.Equal(t, "assistant", assistant.Role)
	require.NotNil(t, assistant.ReasoningContent)
	assert.Equal(t, "thinking", *assistant.ReasoningContent)
	assistantContent := assistant.ParseContent()
	require.Len(t, assistantContent, 2)
	assert.Equal(t, "edited", assistantContent[0].Text)
	assert.Equal(t, "data:image/png;base64,T1VU", assistantContent[1].GetImageMedia().Url)

	encoded, err := common.Marshal(request)
	require.NoError(t, err)
	assert.NotContains(t, string(encoded), `"text":""`)
}

func TestGeminiToOpenAIChatAssociatesToolTurns(t *testing.T) {
	body := `{"contents":[
		{"role":"user","parts":[{"text":"weather in Paris and London?"}]},
		{"role":"model","parts":[
			{"text":"Checking both."},
			{"functionCall":{"name":"weather","args":{"city":"Paris"}},"thoughtSignature":"sig"},
			{"functionCall":{"name":"time","args":{"city":"London"}}}
		]},
		{"role":"user","parts":[
			{"functionResponse":{"name":"time","response":{"time":"10:00"}}},
			{"functionResponse":{"name":"weather","response":{"temp":15}}},
			{"text":"thanks, and Rome?"}
		]},
		{"role":"model","parts":[{"functionCall":{"name":"weather","args":{"city":"Rome"},"id":"fc-rome"}}]},
		{"role":"function","parts":[{"functionResponse":{"name":"weather","id":"fc-rome","response":{"temp":20}}}]}
	]}`

	request, err := convertGeminiJSON(t, body)
	require.NoError(t, err)
	require.Len(t, request.Messages, 7)

	assistant := request.Messages[1]
	assert.Equal(t, "assistant", assistant.Role)
	assert.Equal(t, "Checking both.", assistant.StringContent())
	toolCalls := assistant.ParseToolCalls()
	require.Len(t, toolCalls, 2)
	assert.Equal(t, "call_1", toolCalls[0].ID)
	assert.Equal(t, "weather", toolCalls[0].Function.Name)
	assert.JSONEq(t, `{"city":"Paris"}`, toolCalls[0].Function.Arguments)
	assert.Equal(t, "call_2", toolCalls[1].ID)
	assert.Equal(t, "time", toolCalls[1].Function.Name)

	assert.Equal(t, dto.Message{Role: "tool", ToolCallId: "call_2", Content: `{"time":"10:00"}`}, request.Messages[2])
	assert.Equal(t, dto.Message{Role: "tool", ToolCallId: "call_1", Content: `{"temp":15}`}, request.Messages[3])
	assert.Equal(t, "user", request.Messages[4].Role)
	assert.Equal(t, "thanks, and Rome?", request.Messages[4].StringContent())

	secondCalls := request.Messages[5].ParseToolCalls()
	require.Len(t, secondCalls, 1)
	assert.Equal(t, "fc-rome", secondCalls[0].ID)
	assert.Equal(t, dto.Message{Role: "tool", ToolCallId: "fc-rome", Content: `{"temp":20}`}, request.Messages[6])
}

func TestGeminiToOpenAIChatSystemInstruction(t *testing.T) {
	t.Run("empty system text produces no system message", func(t *testing.T) {
		request, err := convertGeminiJSON(t, `{"systemInstruction":{"parts":[{"text":""}]},"contents":[{"role":"user","parts":[{"text":"hi"}]}]}`)
		require.NoError(t, err)
		require.Len(t, request.Messages, 1)
		assert.Equal(t, "user", request.Messages[0].Role)
	})

	t.Run("system parts without parts list produce no system message", func(t *testing.T) {
		request, err := convertGeminiJSON(t, `{"system_instruction":{"parts":[]},"contents":[{"role":"user","parts":[{"text":"hi"}]}]}`)
		require.NoError(t, err)
		require.Len(t, request.Messages, 1)
	})

	t.Run("text parts are joined", func(t *testing.T) {
		request, err := convertGeminiJSON(t, `{"systemInstruction":{"parts":[{"text":"a"},{"text":""},{"text":"b"}]},"contents":[{"role":"user","parts":[{"text":"hi"}]}]}`)
		require.NoError(t, err)
		require.Len(t, request.Messages, 2)
		assert.Equal(t, dto.Message{Role: "system", Content: "a\nb"}, request.Messages[0])
	})
}

func TestGeminiToOpenAIChatGenerationConfigZeroValues(t *testing.T) {
	t.Run("explicit zeros are preserved", func(t *testing.T) {
		request, err := convertGeminiJSON(t, `{"contents":[{"role":"user","parts":[{"text":"hi"}]}],"generationConfig":{"temperature":0,"topP":0,"topK":0,"maxOutputTokens":0,"candidateCount":0}}`)
		require.NoError(t, err)
		require.NotNil(t, request.Temperature)
		require.NotNil(t, request.TopP)
		require.NotNil(t, request.TopK)
		require.NotNil(t, request.MaxTokens)
		require.NotNil(t, request.N)
		assert.Zero(t, *request.Temperature)
		assert.Zero(t, *request.TopP)
		assert.Zero(t, *request.TopK)
		assert.Zero(t, *request.MaxTokens)
		assert.Zero(t, *request.N)

		encoded, err := common.Marshal(request)
		require.NoError(t, err)
		for _, field := range []string{`"temperature":0`, `"top_p":0`, `"top_k":0`, `"max_tokens":0`, `"n":0`} {
			assert.Contains(t, string(encoded), field)
		}
	})

	t.Run("absent settings stay absent", func(t *testing.T) {
		request, err := convertGeminiJSON(t, `{"contents":[{"role":"user","parts":[{"text":"hi"}]}]}`)
		require.NoError(t, err)
		assert.Nil(t, request.Temperature)
		assert.Nil(t, request.TopP)
		assert.Nil(t, request.TopK)
		assert.Nil(t, request.MaxTokens)
		assert.Nil(t, request.N)
	})

	t.Run("non-zero values map", func(t *testing.T) {
		request, err := convertGeminiJSON(t, `{"contents":[{"role":"user","parts":[{"text":"hi"}]}],"generationConfig":{"topP":0.9,"topK":40,"max_output_tokens":256,"candidateCount":2}}`)
		require.NoError(t, err)
		assert.Equal(t, 0.9, *request.TopP)
		assert.Equal(t, 40, *request.TopK)
		assert.Equal(t, uint(256), *request.MaxTokens)
		assert.Equal(t, 2, *request.N)
	})
}

func TestGeminiToOpenAIChatToolsAndToolConfig(t *testing.T) {
	tests := []struct {
		name       string
		toolConfig string
		want       any
	}{
		{name: "none", toolConfig: `{"functionCallingConfig":{"mode":"NONE"}}`, want: "none"},
		{name: "auto", toolConfig: `{"functionCallingConfig":{"mode":"AUTO"}}`, want: "auto"},
		{name: "any", toolConfig: `{"functionCallingConfig":{"mode":"ANY"}}`, want: "required"},
		{
			name:       "any with single allowed function",
			toolConfig: `{"functionCallingConfig":{"mode":"ANY","allowedFunctionNames":["lookup"]}}`,
			want:       map[string]any{"type": "function", "function": map[string]any{"name": "lookup"}},
		},
	}

	for _, tt := range tests {
		t.Run(tt.name, func(t *testing.T) {
			request, err := convertGeminiJSON(t, `{"contents":[{"role":"user","parts":[{"text":"hi"}]}],
				"tools":[{"functionDeclarations":[
					{"name":"lookup","description":"find","parameters":{"type":"object"}},
					{"name":"search","parametersJsonSchema":{"type":"object","properties":{"q":{"type":"string"}}}}
				]},{"googleSearch":{}}],
				"toolConfig":`+tt.toolConfig+`}`)
			require.NoError(t, err)
			require.Len(t, request.Tools, 2)
			assert.Equal(t, "lookup", request.Tools[0].Function.Name)
			assert.Equal(t, map[string]any{"type": "object"}, request.Tools[0].Function.Parameters)
			assert.Equal(t, map[string]any{"type": "object", "properties": map[string]any{"q": map[string]any{"type": "string"}}}, request.Tools[1].Function.Parameters)
			assert.Equal(t, tt.want, request.ToolChoice)
		})
	}
}
