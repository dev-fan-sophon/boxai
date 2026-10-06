package helper

import (
	"bytes"
	"net/http"
	"net/http/httptest"
	"testing"

	"github.com/gin-gonic/gin"
	"github.com/stretchr/testify/assert"
	"github.com/stretchr/testify/require"
)

// Native Gemini requests whose parts have no (or several) members of the Part
// `data` oneof must fail locally instead of reaching an upstream that answers
// "required oneof field 'data' must have one initialized field".
func TestGetAndValidateGeminiRequestRejectsInvalidParts(t *testing.T) {
	gin.SetMode(gin.TestMode)

	tests := []struct {
		name    string
		body    string
		wantErr string
	}{
		{
			name:    "empty part object",
			body:    `{"contents":[{"role":"user","parts":[{}]}]}`,
			wantErr: "contents[0].parts[0] must set exactly one of",
		},
		{
			name:    "part with only thought signature",
			body:    `{"contents":[{"role":"user","parts":[{"text":"hi"}]},{"role":"model","parts":[{"thoughtSignature":"sig"}]}]}`,
			wantErr: "contents[1].parts[0] must set exactly one of",
		},
		{
			name:    "null part",
			body:    `{"contents":[{"role":"user","parts":[null,{"text":"hi"}]}]}`,
			wantErr: "contents[0].parts[0] must set exactly one of",
		},
		{
			name:    "multiple data members",
			body:    `{"contents":[{"role":"user","parts":[{"text":"hi","inlineData":{"mimeType":"image/png","data":"AAAA"}}]}]}`,
			wantErr: "contents[0].parts[0] sets more than one of",
		},
		{
			name:    "empty parts list",
			body:    `{"contents":[{"role":"user","parts":[]}]}`,
			wantErr: "contents[0].parts must not be empty",
		},
		{
			name:    "inline data without data",
			body:    `{"contents":[{"role":"user","parts":[{"inlineData":{"mimeType":"image/png","data":""}}]}]}`,
			wantErr: "contents[0].parts[0].inlineData requires non-empty mimeType and data",
		},
		{
			name:    "inline data without mime type",
			body:    `{"contents":[{"role":"user","parts":[{"inlineData":{"data":"AAAA"}}]}]}`,
			wantErr: "contents[0].parts[0].inlineData requires non-empty mimeType and data",
		},
		{
			name:    "file data without uri",
			body:    `{"contents":[{"role":"user","parts":[{"fileData":{"mimeType":"image/png"}}]}]}`,
			wantErr: "contents[0].parts[0].fileData.fileUri is required",
		},
		{
			name:    "function call without name",
			body:    `{"contents":[{"role":"model","parts":[{"functionCall":{"args":{}}}]}]}`,
			wantErr: "contents[0].parts[0].functionCall.name is required",
		},
		{
			name:    "function response without name",
			body:    `{"contents":[{"role":"user","parts":[{"functionResponse":{"response":{}}}]}]}`,
			wantErr: "contents[0].parts[0].functionResponse.name is required",
		},
		{
			name:    "system instruction empty part",
			body:    `{"systemInstruction":{"parts":[{}]},"contents":[{"role":"user","parts":[{"text":"hi"}]}]}`,
			wantErr: "systemInstruction.parts[0] must set exactly one of",
		},
		{
			name:    "snake case system instruction empty part",
			body:    `{"system_instruction":{"parts":[{}]},"contents":[{"role":"user","parts":[{"text":"hi"}]}]}`,
			wantErr: "systemInstruction.parts[0] must set exactly one of",
		},
		{
			name:    "batch request empty part",
			body:    `{"requests":[{"contents":[{"role":"user","parts":[{}]}]}]}`,
			wantErr: "requests[0].contents[0].parts[0] must set exactly one of",
		},
	}

	for _, tt := range tests {
		t.Run(tt.name, func(t *testing.T) {
			c, _ := gin.CreateTestContext(httptest.NewRecorder())
			c.Request = httptest.NewRequest(http.MethodPost, "/v1beta/models/gemini-2.5-pro:generateContent", bytes.NewBufferString(tt.body))
			c.Request.Header.Set("Content-Type", "application/json")

			_, err := GetAndValidateGeminiRequest(c)
			require.Error(t, err)
			assert.Contains(t, err.Error(), tt.wantErr)
		})
	}
}

// Validation must not reject valid native Gemini content just because the
// OpenAI chat format cannot represent it.
func TestGetAndValidateGeminiRequestAcceptsNativeContent(t *testing.T) {
	gin.SetMode(gin.TestMode)

	body := `{
		"systemInstruction":{"parts":[{"text":""}]},
		"contents":[
			{"role":"user","parts":[
				{"text":"describe"},
				{"inlineData":{"mimeType":"audio/ogg","data":"AAAA"}},
				{"fileData":{"mimeType":"video/mp4","fileUri":"https://generativelanguage.googleapis.com/v1beta/files/abc"},"videoMetadata":{"startOffset":"1s"}}
			]},
			{"role":"model","parts":[
				{"executableCode":{"language":"PYTHON","code":"print(1)"}},
				{"codeExecutionResult":{"outcome":"OUTCOME_OK","output":"1"}},
				{"functionCall":{"name":"lookup","args":{"q":"x"}},"thoughtSignature":"sig"},
				{"text":"","thoughtSignature":"sig2"}
			]},
			{"role":"user","parts":[{"functionResponse":{"name":"lookup","response":{"ok":true}}}]}
		],
		"generationConfig":{"temperature":0,"topP":0,"maxOutputTokens":0}
	}`
	c, _ := gin.CreateTestContext(httptest.NewRecorder())
	c.Request = httptest.NewRequest(http.MethodPost, "/v1beta/models/gemini-2.5-pro:generateContent", bytes.NewBufferString(body))
	c.Request.Header.Set("Content-Type", "application/json")

	request, err := GetAndValidateGeminiRequest(c)
	require.NoError(t, err)
	require.Len(t, request.Contents, 3)
	require.NotNil(t, request.GenerationConfig.TopP)
	assert.Zero(t, *request.GenerationConfig.TopP)
}
