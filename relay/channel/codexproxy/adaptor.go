package codexproxy

import (
	"bytes"
	"encoding/json"
	"errors"
	"fmt"
	"io"
	"net/http"
	"strings"

	"github.com/dev-fan-sophon/boxai/common"
	"github.com/dev-fan-sophon/boxai/dto"
	"github.com/dev-fan-sophon/boxai/relay/channel"
	"github.com/dev-fan-sophon/boxai/relay/channel/claude"
	"github.com/dev-fan-sophon/boxai/relay/channel/gemini"
	"github.com/dev-fan-sophon/boxai/relay/channel/openai"
	relaycommon "github.com/dev-fan-sophon/boxai/relay/common"
	relayconstant "github.com/dev-fan-sophon/boxai/relay/constant"
	"github.com/dev-fan-sophon/boxai/types"

	"github.com/gin-gonic/gin"
	"github.com/tidwall/gjson"
	"github.com/tidwall/sjson"
)

type Adaptor struct{}

func (a *Adaptor) Init(*relaycommon.RelayInfo) {}

func (a *Adaptor) ConvertOpenAIRequest(c *gin.Context, info *relaycommon.RelayInfo, request *dto.GeneralOpenAIRequest) (any, error) {
	if request == nil {
		return nil, errors.New("Codex Proxy: request is nil")
	}
	body, err := nativeJSONRequest(c, info, request, true)
	if err != nil {
		return nil, err
	}
	if info != nil && info.ChannelSetting.SystemPrompt != "" {
		body, err = setJSONField(body, "messages", request.Messages)
	}
	return json.RawMessage(body), err
}

func (a *Adaptor) ConvertClaudeRequest(c *gin.Context, info *relaycommon.RelayInfo, request *dto.ClaudeRequest) (any, error) {
	if request == nil {
		return nil, errors.New("Codex Proxy: request is nil")
	}
	body, err := nativeJSONRequest(c, info, request, true)
	if err != nil {
		return nil, err
	}
	if info != nil && info.ChannelSetting.SystemPrompt != "" {
		body, err = setJSONField(body, "system", request.System)
	}
	return json.RawMessage(body), err
}

func (a *Adaptor) ConvertGeminiRequest(c *gin.Context, info *relaycommon.RelayInfo, request *dto.GeminiChatRequest) (any, error) {
	if request == nil {
		return nil, errors.New("Codex Proxy: request is nil")
	}
	body, err := nativeJSONRequest(c, info, request, false)
	if err != nil {
		return nil, err
	}
	if info != nil && info.ChannelSetting.SystemPrompt != "" {
		body, err = setJSONField(body, "systemInstruction", request.SystemInstructions)
	}
	return json.RawMessage(body), err
}

func (a *Adaptor) ConvertEmbeddingRequest(c *gin.Context, info *relaycommon.RelayInfo, request dto.EmbeddingRequest) (any, error) {
	body, err := nativeJSONRequest(c, info, request, true)
	return json.RawMessage(body), err
}

func (a *Adaptor) ConvertRerankRequest(_ *gin.Context, _ int, _ dto.RerankRequest) (any, error) {
	return nil, errors.New("Codex Proxy: rerank endpoint is not supported")
}

func (a *Adaptor) ConvertAudioRequest(_ *gin.Context, _ *relaycommon.RelayInfo, _ dto.AudioRequest) (io.Reader, error) {
	return nil, errors.New("Codex Proxy: audio endpoints are not supported")
}

func imageViaResponses(info *relaycommon.RelayInfo) bool {
	return info != nil &&
		(info.RelayMode == relayconstant.RelayModeImagesGenerations || info.RelayMode == relayconstant.RelayModeImagesEdits) &&
		openai.ImageGenerationViaResponsesEnabled(info)
}

func (a *Adaptor) ConvertImageRequest(c *gin.Context, info *relaycommon.RelayInfo, request dto.ImageRequest) (any, error) {
	if !imageViaResponses(info) {
		return nil, errors.New("Codex Proxy: image generation requires image_generation_via_responses_model for usage-based billing")
	}
	if info.RelayMode == relayconstant.RelayModeImagesEdits {
		return openai.ConvertImageEditViaResponses(c, info, request)
	}
	return openai.ConvertImageGenerationViaResponses(info, request)
}

func (a *Adaptor) ConvertOpenAIResponsesRequest(c *gin.Context, info *relaycommon.RelayInfo, request dto.OpenAIResponsesRequest) (any, error) {
	if err := applySystemPrompt(info, &request); err != nil {
		return nil, err
	}
	body, err := nativeJSONRequest(c, info, request, true)
	if err != nil {
		return nil, err
	}

	// Codex Proxy distinguishes an omitted stream field from explicit false.
	// The public Responses contract remains authoritative: omitted is false.
	isStream := request.Stream != nil && *request.Stream
	if info != nil {
		isStream = info.IsStream
	}
	body, err = sjson.SetBytes(body, "stream", isStream)
	if err != nil {
		return nil, fmt.Errorf("Codex Proxy: set Responses stream mode: %w", err)
	}
	input := request.Input
	if rawInput := gjson.GetBytes(body, "input"); rawInput.Exists() {
		input = json.RawMessage(rawInput.Raw)
	}
	input, err = normalizeResponsesInput(input)
	if err != nil {
		return nil, err
	}
	if len(input) > 0 {
		body, err = sjson.SetRawBytes(body, "input", input)
		if err != nil {
			return nil, fmt.Errorf("Codex Proxy: set normalized Responses input: %w", err)
		}
	}
	if info != nil && info.ChannelSetting.SystemPrompt != "" && len(request.Instructions) > 0 {
		body, err = sjson.SetRawBytes(body, "instructions", request.Instructions)
		if err != nil {
			return nil, fmt.Errorf("Codex Proxy: set Responses instructions: %w", err)
		}
	}
	if info != nil && request.Reasoning != nil && request.Reasoning.Effort != "" {
		info.SetReasoningEffort(request.Reasoning.Effort)
	}
	return json.RawMessage(body), nil
}

func nativeJSONRequest(c *gin.Context, info *relaycommon.RelayInfo, fallback any, patchModel bool) ([]byte, error) {
	var body []byte
	if c != nil && c.Request != nil {
		storage, err := common.GetBodyStorage(c)
		if err != nil {
			return nil, fmt.Errorf("Codex Proxy: read native request body: %w", err)
		}
		body, err = storage.Bytes()
		if err != nil {
			return nil, fmt.Errorf("Codex Proxy: read native request body: %w", err)
		}
	}
	if len(bytes.TrimSpace(body)) == 0 {
		var err error
		body, err = common.Marshal(fallback)
		if err != nil {
			return nil, fmt.Errorf("Codex Proxy: encode request body: %w", err)
		}
	}
	if !json.Valid(body) {
		return nil, errors.New("Codex Proxy: request body must be valid JSON")
	}
	if patchModel && info != nil && strings.TrimSpace(info.UpstreamModelName) != "" {
		var err error
		body, err = sjson.SetBytes(body, "model", info.UpstreamModelName)
		if err != nil {
			return nil, fmt.Errorf("Codex Proxy: set upstream model: %w", err)
		}
	}
	return body, nil
}

func setJSONField(body []byte, path string, value any) ([]byte, error) {
	encoded, err := common.Marshal(value)
	if err != nil {
		return nil, fmt.Errorf("Codex Proxy: encode %s: %w", path, err)
	}
	patched, err := sjson.SetRawBytes(body, path, encoded)
	if err != nil {
		return nil, fmt.Errorf("Codex Proxy: set %s: %w", path, err)
	}
	return patched, nil
}

func normalizeResponsesInput(input json.RawMessage) (json.RawMessage, error) {
	trimmed := strings.TrimSpace(string(input))
	if trimmed == "" || strings.HasPrefix(trimmed, "[") {
		return input, nil
	}
	if !strings.HasPrefix(trimmed, `"`) {
		return nil, errors.New("Codex Proxy: Responses input must be a string or an array")
	}
	var text string
	if err := common.Unmarshal(input, &text); err != nil {
		return nil, fmt.Errorf("Codex Proxy: decode Responses string input: %w", err)
	}
	normalized, err := common.Marshal([]map[string]any{{
		"role": "user",
		"content": []map[string]string{{
			"type": "input_text",
			"text": text,
		}},
	}})
	if err != nil {
		return nil, fmt.Errorf("Codex Proxy: normalize Responses string input: %w", err)
	}
	return normalized, nil
}

func applySystemPrompt(info *relaycommon.RelayInfo, request *dto.OpenAIResponsesRequest) error {
	if info == nil || request == nil || info.ChannelSetting.SystemPrompt == "" {
		return nil
	}
	systemPrompt := info.ChannelSetting.SystemPrompt
	if len(request.Instructions) == 0 {
		instructions, err := common.Marshal(systemPrompt)
		if err != nil {
			return err
		}
		request.Instructions = instructions
		return nil
	}
	if !info.ChannelSetting.SystemPromptOverride {
		return nil
	}
	var existing string
	if err := common.Unmarshal(request.Instructions, &existing); err != nil {
		existing = ""
	}
	if existing = strings.TrimSpace(existing); existing != "" {
		systemPrompt += "\n" + existing
	}
	instructions, err := common.Marshal(systemPrompt)
	if err != nil {
		return err
	}
	request.Instructions = instructions
	return nil
}

func (a *Adaptor) GetRequestURL(info *relaycommon.RelayInfo) (string, error) {
	if info == nil || info.ChannelMeta == nil {
		return "", errors.New("Codex Proxy: missing channel metadata")
	}
	var path string
	switch {
	case imageViaResponses(info):
		path = "/v1/responses"
	case info.RelayMode == relayconstant.RelayModeResponses:
		path = "/v1/responses"
	case info.RelayMode == relayconstant.RelayModeChatCompletions:
		path = "/v1/chat/completions"
	case info.RelayMode == relayconstant.RelayModeEmbeddings:
		path = "/v1/embeddings"
	case info.RelayFormat == types.RelayFormatClaude:
		path = "/v1/messages"
	case info.RelayMode == relayconstant.RelayModeGemini || info.RelayFormat == types.RelayFormatGemini:
		action := "generateContent"
		if info.IsStream {
			action = "streamGenerateContent?alt=sse"
		}
		path = fmt.Sprintf("/v1beta/models/%s:%s", info.UpstreamModelName, action)
	default:
		return "", fmt.Errorf("Codex Proxy: endpoint is not supported for relay mode %d", info.RelayMode)
	}
	return relaycommon.GetFullRequestURL(strings.TrimRight(info.ChannelBaseUrl, "/"), path, info.ChannelType), nil
}

var forwardedProtocolHeaders = []string{
	"Anthropic-Beta",
	"Anthropic-Version",
	"OpenAI-Subagent",
	"User-Agent",
	"Version",
	"X-Claude-Code-Session-Id",
	"X-Codex-Beta-Features",
	"X-Codex-Default-Tools",
	"X-Codex-No-Default-Tools",
	"X-Codex-Parent-Thread-Id",
	"X-Codex-Turn-Metadata",
	"X-Codex-Turn-State",
	"X-Codex-Window-Id",
	"X-Conversation-Id",
	"X-ResponsesAPI-Include-Timing-Metrics",
	"X-Session-Id",
}

func (a *Adaptor) SetupRequestHeader(c *gin.Context, header *http.Header, info *relaycommon.RelayInfo) error {
	channel.SetupApiRequestHeader(info, c, header)
	for _, name := range forwardedProtocolHeaders {
		if value := c.GetHeader(name); value != "" {
			header.Set(name, value)
		}
	}
	header.Set("Authorization", "Bearer "+strings.TrimSpace(info.ApiKey))
	header.Set("Content-Type", "application/json")
	if info.IsStream {
		header.Set("Accept", "text/event-stream")
	} else if header.Get("Accept") == "" {
		header.Set("Accept", "application/json")
	}
	return nil
}

func (a *Adaptor) DoRequest(c *gin.Context, info *relaycommon.RelayInfo, requestBody io.Reader) (any, error) {
	return channel.DoApiRequest(a, c, info, requestBody)
}

func (a *Adaptor) DoResponse(c *gin.Context, resp *http.Response, info *relaycommon.RelayInfo) (usage any, err *types.NewAPIError) {
	if imageViaResponses(info) {
		if responseIsEventStream(resp) {
			return openai.OpenaiResponsesStreamImageHandler(c, info, resp)
		}
		return openai.OpenaiResponsesImageHandler(c, info, resp)
	}
	if info.RelayMode == relayconstant.RelayModeResponses {
		if info.IsStream {
			return openai.OaiResponsesStreamHandler(c, info, resp)
		}
		if responseIsEventStream(resp) {
			return responsesSSEToJSONHandler(c, info, resp)
		}
		return openai.OaiResponsesHandler(c, info, resp)
	}
	if info.RelayFormat == types.RelayFormatClaude {
		info.FinalRequestRelayFormat = types.RelayFormatClaude
		if info.IsStream {
			return claude.ClaudeStreamHandler(c, resp, info)
		}
		return claude.ClaudeHandler(c, resp, info)
	}
	if info.RelayMode == relayconstant.RelayModeGemini || info.RelayFormat == types.RelayFormatGemini {
		info.FinalRequestRelayFormat = types.RelayFormatGemini
		if info.IsStream {
			return gemini.GeminiTextGenerationStreamHandler(c, info, resp)
		}
		return gemini.GeminiTextGenerationHandler(c, info, resp)
	}
	if info.IsStream {
		return openai.OaiStreamHandler(c, info, resp)
	}
	return openai.OpenaiHandler(c, info, resp)
}

func (a *Adaptor) GetModelList() []string {
	return ModelList
}

func (a *Adaptor) GetChannelName() string {
	return ChannelName
}
