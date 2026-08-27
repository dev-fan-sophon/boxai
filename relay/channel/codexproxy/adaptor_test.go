package codexproxy

import (
	"bytes"
	"encoding/json"
	"io"
	"net/http"
	"net/http/httptest"
	"strings"
	"testing"

	"github.com/dev-fan-sophon/boxai/common"
	"github.com/dev-fan-sophon/boxai/constant"
	"github.com/dev-fan-sophon/boxai/dto"
	relaycommon "github.com/dev-fan-sophon/boxai/relay/common"
	relayconstant "github.com/dev-fan-sophon/boxai/relay/constant"
	"github.com/dev-fan-sophon/boxai/types"

	"github.com/gin-gonic/gin"
	"github.com/stretchr/testify/require"
)

func TestResponsesStringInputIsNormalizedWithoutDroppingQuery(t *testing.T) {
	request := dto.OpenAIResponsesRequest{
		Model: "gpt-5.6-luna",
		Input: json.RawMessage(`"find the latest BoxAI release"`),
	}

	converted, err := (&Adaptor{}).ConvertOpenAIResponsesRequest(nil, nil, request)
	require.NoError(t, err)
	var got dto.OpenAIResponsesRequest
	require.NoError(t, common.Unmarshal(converted.(json.RawMessage), &got))
	require.NotNil(t, got.Stream)
	require.False(t, *got.Stream)
	require.JSONEq(t, `[
		{"role":"user","content":[
			{"type":"input_text","text":"find the latest BoxAI release"}
		]}
	]`, string(got.Input))

	arrayInput := json.RawMessage(`[ {"role":"user","content":"unchanged"} ]`)
	converted, err = (&Adaptor{}).ConvertOpenAIResponsesRequest(nil, nil, dto.OpenAIResponsesRequest{Input: arrayInput})
	require.NoError(t, err)
	require.NoError(t, common.Unmarshal(converted.(json.RawMessage), &got))
	require.JSONEq(t, string(arrayInput), string(got.Input))

	_, err = (&Adaptor{}).ConvertOpenAIResponsesRequest(nil, nil, dto.OpenAIResponsesRequest{Input: json.RawMessage(`{"text":"ambiguous"}`)})
	require.ErrorContains(t, err, "must be a string or an array")
}

func TestNativeRequestsPreserveUnknownFieldsWhilePatchingRequiredFields(t *testing.T) {
	gin.SetMode(gin.TestMode)
	chatBody := `{
		"model":"public-luna",
		"messages":[{"role":"user","content":"hello","codex_message_option":true}],
		"codex_request_option":{"mode":"fast"}
	}`
	c, _ := gin.CreateTestContext(httptest.NewRecorder())
	c.Request = httptest.NewRequest(http.MethodPost, "/v1/chat/completions", strings.NewReader(chatBody))
	c.Request.Header.Set("Content-Type", "application/json")
	t.Cleanup(func() { common.CleanupBodyStorage(c) })

	info := &relaycommon.RelayInfo{ChannelMeta: &relaycommon.ChannelMeta{UpstreamModelName: "gpt-5.6-luna"}}
	converted, err := (&Adaptor{}).ConvertOpenAIRequest(c, info, &dto.GeneralOpenAIRequest{})
	require.NoError(t, err)
	encoded, err := common.Marshal(converted)
	require.NoError(t, err)
	require.JSONEq(t, `{
		"model":"gpt-5.6-luna",
		"messages":[{"role":"user","content":"hello","codex_message_option":true}],
		"codex_request_option":{"mode":"fast"}
	}`, string(encoded))

	responsesBody := `{"model":"public-luna","input":"search query","codex_request_option":{"mode":"fast"}}`
	responsesContext, _ := gin.CreateTestContext(httptest.NewRecorder())
	responsesContext.Request = httptest.NewRequest(http.MethodPost, "/v1/responses", strings.NewReader(responsesBody))
	responsesContext.Request.Header.Set("Content-Type", "application/json")
	t.Cleanup(func() { common.CleanupBodyStorage(responsesContext) })

	converted, err = (&Adaptor{}).ConvertOpenAIResponsesRequest(responsesContext, info, dto.OpenAIResponsesRequest{})
	require.NoError(t, err)
	encoded, err = common.Marshal(converted)
	require.NoError(t, err)
	require.JSONEq(t, `{
		"model":"gpt-5.6-luna",
		"input":[{"role":"user","content":[{"type":"input_text","text":"search query"}]}],
		"stream":false,
		"codex_request_option":{"mode":"fast"}
	}`, string(encoded))

	claudeBody := `{
		"model":"public-luna",
		"max_tokens":16,
		"messages":[{"role":"user","content":"hello","codex_message_option":true}],
		"codex_request_option":{"mode":"fast"}
	}`
	claudeContext, _ := gin.CreateTestContext(httptest.NewRecorder())
	claudeContext.Request = httptest.NewRequest(http.MethodPost, "/v1/messages", strings.NewReader(claudeBody))
	claudeContext.Request.Header.Set("Content-Type", "application/json")
	t.Cleanup(func() { common.CleanupBodyStorage(claudeContext) })

	converted, err = (&Adaptor{}).ConvertClaudeRequest(claudeContext, info, &dto.ClaudeRequest{})
	require.NoError(t, err)
	encoded, err = common.Marshal(converted)
	require.NoError(t, err)
	require.JSONEq(t, `{
		"model":"gpt-5.6-luna",
		"max_tokens":16,
		"messages":[{"role":"user","content":"hello","codex_message_option":true}],
		"codex_request_option":{"mode":"fast"}
	}`, string(encoded))

	geminiBody := `{
		"contents":[{"role":"user","parts":[{"text":"hello","codex_part_option":true}]}],
		"codex_request_option":{"mode":"fast"}
	}`
	geminiContext, _ := gin.CreateTestContext(httptest.NewRecorder())
	geminiContext.Request = httptest.NewRequest(http.MethodPost, "/v1beta/models/public-luna:generateContent", strings.NewReader(geminiBody))
	geminiContext.Request.Header.Set("Content-Type", "application/json")
	t.Cleanup(func() { common.CleanupBodyStorage(geminiContext) })

	converted, err = (&Adaptor{}).ConvertGeminiRequest(geminiContext, info, &dto.GeminiChatRequest{})
	require.NoError(t, err)
	encoded, err = common.Marshal(converted)
	require.NoError(t, err)
	require.JSONEq(t, geminiBody, string(encoded))
}

func TestCodexProxyBuffersForcedResponsesSSEForNonStreamingCaller(t *testing.T) {
	gin.SetMode(gin.TestMode)
	recorder := httptest.NewRecorder()
	c, _ := gin.CreateTestContext(recorder)
	c.Request = httptest.NewRequest(http.MethodPost, "/v1/responses", nil)
	upstreamBody := strings.Join([]string{
		`event: codex.response.metadata`,
		`data: {"type":"codex.response.metadata","response_id":"resp_123"}`,
		``,
		`event: response.output_item.done`,
		`data: {"type":"response.output_item.done","output_index":0,"item":{"id":"msg_123","type":"message","status":"completed","role":"assistant","content":[{"type":"output_text","text":"OK","annotations":[]}]}}`,
		``,
		`event: response.completed`,
		`data: {"type":"response.completed","response":{"id":"resp_123","object":"response","status":"completed","model":"gpt-5.6-luna","output":[],"usage":{"input_tokens":7,"output_tokens":2,"total_tokens":9},"codex_response_option":{"mode":"fast"}}}`,
		``,
	}, "\n")
	resp := &http.Response{
		StatusCode: http.StatusOK,
		Header: http.Header{
			"Content-Type":      []string{"text/event-stream; charset=utf-8"},
			"Transfer-Encoding": []string{"chunked"},
		},
		Body: io.NopCloser(strings.NewReader(upstreamBody)),
	}
	info := &relaycommon.RelayInfo{
		RelayMode: relayconstant.RelayModeResponses,
		IsStream:  false,
		ChannelMeta: &relaycommon.ChannelMeta{
			ChannelType:       constant.ChannelTypeCodexProxy,
			UpstreamModelName: "gpt-5.6-luna",
		},
	}

	usage, apiErr := (&Adaptor{}).DoResponse(c, resp, info)
	require.Nil(t, apiErr)
	require.Equal(t, &dto.Usage{PromptTokens: 7, CompletionTokens: 2, TotalTokens: 9}, usage)
	require.Equal(t, "application/json", recorder.Header().Get("Content-Type"))
	require.Empty(t, recorder.Header().Get("Transfer-Encoding"))
	require.NotContains(t, recorder.Body.String(), "codex.response.metadata")
	require.JSONEq(t, `{
		"id":"resp_123",
		"object":"response",
		"status":"completed",
		"model":"gpt-5.6-luna",
		"output":[{"id":"msg_123","type":"message","status":"completed","role":"assistant","content":[{"type":"output_text","text":"OK","annotations":[]}]}],
		"usage":{"input_tokens":7,"output_tokens":2,"total_tokens":9},
		"codex_response_option":{"mode":"fast"}
	}`, recorder.Body.String())
}

func TestCodexProxyRoutesNativeProtocols(t *testing.T) {
	tests := []struct {
		name       string
		mode       int
		format     types.RelayFormat
		stream     bool
		model      string
		setting    dto.ChannelSettings
		wantSuffix string
	}{
		{name: "chat", mode: relayconstant.RelayModeChatCompletions, wantSuffix: "/v1/chat/completions"},
		{name: "responses", mode: relayconstant.RelayModeResponses, wantSuffix: "/v1/responses"},
		{name: "embeddings", mode: relayconstant.RelayModeEmbeddings, wantSuffix: "/v1/embeddings"},
		{name: "claude", format: types.RelayFormatClaude, wantSuffix: "/v1/messages"},
		{name: "gemini", mode: relayconstant.RelayModeGemini, model: "gpt-5.6-luna", wantSuffix: "/v1beta/models/gpt-5.6-luna:generateContent"},
		{name: "gemini stream", mode: relayconstant.RelayModeGemini, stream: true, model: "gpt-5.6-luna", wantSuffix: "/v1beta/models/gpt-5.6-luna:streamGenerateContent?alt=sse"},
		{name: "image generation via Responses", mode: relayconstant.RelayModeImagesGenerations, setting: dto.ChannelSettings{ImageGenerationViaResponsesModel: "gpt-5.6-sol"}, wantSuffix: "/v1/responses"},
		{name: "image edit via Responses", mode: relayconstant.RelayModeImagesEdits, setting: dto.ChannelSettings{ImageGenerationViaResponsesModel: "gpt-5.6-sol"}, wantSuffix: "/v1/responses"},
	}

	for _, tt := range tests {
		t.Run(tt.name, func(t *testing.T) {
			info := &relaycommon.RelayInfo{
				RelayMode:   tt.mode,
				RelayFormat: tt.format,
				IsStream:    tt.stream,
				ChannelMeta: &relaycommon.ChannelMeta{
					ChannelType:       constant.ChannelTypeCodexProxy,
					ChannelBaseUrl:    "https://proxy.example/",
					UpstreamModelName: tt.model,
					ChannelSetting:    tt.setting,
				},
			}
			url, err := (&Adaptor{}).GetRequestURL(info)
			require.NoError(t, err)
			require.Equal(t, "https://proxy.example"+tt.wantSuffix, url)
		})
	}
}

func TestCodexProxyRequestUsesChannelCredentialAndCuratedHeaders(t *testing.T) {
	gin.SetMode(gin.TestMode)
	captured := make(chan *http.Request, 1)
	upstream := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		captured <- r.Clone(r.Context())
		w.Header().Set("Content-Type", "application/json")
		_, _ = io.WriteString(w, `{"id":"chatcmpl_test","object":"chat.completion","choices":[],"usage":{"prompt_tokens":2,"completion_tokens":3,"total_tokens":5}}`)
	}))
	t.Cleanup(upstream.Close)

	c, _ := gin.CreateTestContext(httptest.NewRecorder())
	c.Request = httptest.NewRequest(http.MethodPost, "/v1/chat/completions", nil)
	c.Request.Header.Set("Authorization", "Bearer gateway-user-token")
	c.Request.Header.Set("X-Api-Key", "gateway-user-api-key")
	c.Request.Header.Set("X-Goog-Api-Key", "gateway-user-google-key")
	c.Request.Header.Set("X-Codex-Turn-Metadata", "turn-42")
	c.Request.Header.Set("Content-Type", "application/json")

	info := &relaycommon.RelayInfo{
		RelayMode: relayconstant.RelayModeChatCompletions,
		ChannelMeta: &relaycommon.ChannelMeta{
			ChannelType:    constant.ChannelTypeCodexProxy,
			ChannelBaseUrl: upstream.URL,
			ApiKey:         "channel-secret",
		},
	}
	response, err := (&Adaptor{}).DoRequest(c, info, bytes.NewBufferString(`{"model":"gpt-5.6-luna","messages":[]}`))
	require.NoError(t, err)
	t.Cleanup(func() { require.NoError(t, response.(*http.Response).Body.Close()) })

	got := <-captured
	require.Equal(t, "/v1/chat/completions", got.URL.Path)
	require.Equal(t, "Bearer channel-secret", got.Header.Get("Authorization"))
	require.Empty(t, got.Header.Get("X-Api-Key"))
	require.Empty(t, got.Header.Get("X-Goog-Api-Key"))
	require.Equal(t, "turn-42", got.Header.Get("X-Codex-Turn-Metadata"))
}

func TestCodexProxyResponsesStreamPreservesMetadataAndUsage(t *testing.T) {
	gin.SetMode(gin.TestMode)
	oldStreamingTimeout := constant.StreamingTimeout
	constant.StreamingTimeout = 30
	t.Cleanup(func() { constant.StreamingTimeout = oldStreamingTimeout })
	recorder := httptest.NewRecorder()
	c, _ := gin.CreateTestContext(recorder)
	c.Request = httptest.NewRequest(http.MethodPost, "/v1/responses", nil)
	upstreamBody := strings.Join([]string{
		`event: codex.response.metadata`,
		`data: {"type":"codex.response.metadata","response_id":"resp_123"}`,
		``,
		`event: response.completed`,
		`data: {"type":"response.completed","response":{"status":"completed","usage":{"input_tokens":7,"output_tokens":11,"total_tokens":18}}}`,
		``,
	}, "\n")
	resp := &http.Response{
		StatusCode: http.StatusOK,
		Header:     http.Header{"Content-Type": []string{"text/event-stream"}},
		Body:       io.NopCloser(strings.NewReader(upstreamBody)),
	}
	info := &relaycommon.RelayInfo{
		RelayMode: relayconstant.RelayModeResponses,
		IsStream:  true,
		ChannelMeta: &relaycommon.ChannelMeta{
			ChannelType:       constant.ChannelTypeCodexProxy,
			UpstreamModelName: "gpt-5.6-luna",
		},
	}

	usage, apiErr := (&Adaptor{}).DoResponse(c, resp, info)
	require.Nil(t, apiErr)
	require.Equal(t, 7, usage.(*dto.Usage).PromptTokens)
	require.Equal(t, 11, usage.(*dto.Usage).CompletionTokens)
	require.Equal(t, 18, usage.(*dto.Usage).TotalTokens)
	require.Contains(t, recorder.Body.String(), "event: codex.response.metadata")
	require.Contains(t, recorder.Body.String(), `"response_id":"resp_123"`)
}

func TestCodexProxyImagesRequireUsageBearingResponsesHost(t *testing.T) {
	gin.SetMode(gin.TestMode)
	c, _ := gin.CreateTestContext(httptest.NewRecorder())
	c.Request = httptest.NewRequest(http.MethodPost, "/v1/images/generations", nil)
	info := &relaycommon.RelayInfo{
		RelayMode: relayconstant.RelayModeImagesGenerations,
		ChannelMeta: &relaycommon.ChannelMeta{
			ChannelType: constant.ChannelTypeCodexProxy,
		},
	}
	_, err := (&Adaptor{}).ConvertImageRequest(c, info, dto.ImageRequest{Prompt: "draw a moon"})
	require.ErrorContains(t, err, "requires image_generation_via_responses_model")

	info.ChannelSetting.ImageGenerationViaResponsesModel = "gpt-5.6-sol"
	converted, err := (&Adaptor{}).ConvertImageRequest(c, info, dto.ImageRequest{Prompt: "draw a moon"})
	require.NoError(t, err)
	responsesRequest := converted.(dto.OpenAIResponsesRequest)
	require.Equal(t, "gpt-5.6-sol", responsesRequest.Model)
	var tools []map[string]any
	require.NoError(t, common.Unmarshal(responsesRequest.Tools, &tools))
	require.Equal(t, "image_generation", tools[0]["type"])
}

func TestExpandModelListPublishesOnlySupportedUpstreamModels(t *testing.T) {
	require.Equal(t, []string{
		"gpt-5.6-luna",
		"gpt-image-2",
		"text-embedding-3-small",
	}, ExpandModelList([]string{
		"gpt-5.6-luna",
		"gpt-image-2",
		"text-embedding-3-small",
		"explicit-openai-compact",
		"gpt-5.6-luna",
		"codex-auto-review",
		"gpt-audio",
		"grok-imagine-video",
		"gpt-4o-realtime-preview",
	}))
}
