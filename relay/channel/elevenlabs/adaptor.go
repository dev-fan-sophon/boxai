package elevenlabs

import (
	"bytes"
	"errors"
	"fmt"
	"io"
	"net/http"
	"net/url"
	"strings"
	"unicode/utf8"

	"github.com/dev-fan-sophon/boxai/common"
	"github.com/dev-fan-sophon/boxai/dto"
	"github.com/dev-fan-sophon/boxai/relay/channel"
	relaycommon "github.com/dev-fan-sophon/boxai/relay/common"
	relayconstant "github.com/dev-fan-sophon/boxai/relay/constant"
	"github.com/dev-fan-sophon/boxai/service"
	"github.com/dev-fan-sophon/boxai/types"

	"github.com/gin-gonic/gin"
)

const contextAudioTokensKey = "elevenlabs_audio_tokens"
const contextTextCharsKey = "elevenlabs_text_chars"

type Adaptor struct {
	responseFormat string
	voiceID        string
}

func (a *Adaptor) Init(_ *relaycommon.RelayInfo) {}

func (a *Adaptor) GetRequestURL(info *relaycommon.RelayInfo) (string, error) {
	baseURL := strings.TrimRight(info.ChannelBaseUrl, "/")
	if baseURL == "" {
		baseURL = "https://api.elevenlabs.io"
	}
	switch info.RelayMode {
	case relayconstant.RelayModeAudioSpeech:
		if strings.TrimSpace(a.voiceID) == "" {
			return "", errors.New("voice is required and must be an ElevenLabs voice_id")
		}
		requestURL := fmt.Sprintf("%s/v1/text-to-speech/%s", baseURL, url.PathEscape(a.voiceID))
		if outputFormat := OutputFormatQueryValue(a.responseFormat); outputFormat != "" {
			requestURL += "?output_format=" + url.QueryEscape(outputFormat)
		}
		return requestURL, nil
	case relayconstant.RelayModeAudioTranscription:
		return baseURL + "/v1/speech-to-text", nil
	default:
		return "", fmt.Errorf("ElevenLabs does not support relay mode %d", info.RelayMode)
	}
}

func (a *Adaptor) SetupRequestHeader(c *gin.Context, header *http.Header, info *relaycommon.RelayInfo) error {
	if info.RelayMode != relayconstant.RelayModeAudioTranscription {
		header.Set("Content-Type", c.Request.Header.Get("Content-Type"))
	}
	if accept := c.Request.Header.Get("Accept"); accept != "" {
		header.Set("Accept", accept)
	}
	header.Del("Authorization")
	header.Del("X-Api-Key")
	header.Del("xi-api-key")
	header.Set("xi-api-key", info.ApiKey)
	return nil
}

func (a *Adaptor) ConvertOpenAIRequest(_ *gin.Context, _ *relaycommon.RelayInfo, _ *dto.GeneralOpenAIRequest) (any, error) {
	return nil, errors.New("ElevenLabs only supports audio relay in OpenAI-compatible mode")
}

func (a *Adaptor) ConvertRerankRequest(_ *gin.Context, _ int, _ dto.RerankRequest) (any, error) {
	return nil, errors.New("ElevenLabs does not support rerank relay")
}

func (a *Adaptor) ConvertEmbeddingRequest(_ *gin.Context, _ *relaycommon.RelayInfo, _ dto.EmbeddingRequest) (any, error) {
	return nil, errors.New("ElevenLabs does not support embedding relay")
}

func (a *Adaptor) ConvertAudioRequest(c *gin.Context, info *relaycommon.RelayInfo, request dto.AudioRequest) (io.Reader, error) {
	switch info.RelayMode {
	case relayconstant.RelayModeAudioSpeech:
		return a.convertSpeechRequest(c, info, request)
	case relayconstant.RelayModeAudioTranscription:
		return a.convertTranscriptionRequest(c, info, request)
	default:
		return nil, fmt.Errorf("ElevenLabs audio bridge does not support relay mode %d", info.RelayMode)
	}
}

func (a *Adaptor) ConvertImageRequest(_ *gin.Context, _ *relaycommon.RelayInfo, _ dto.ImageRequest) (any, error) {
	return nil, errors.New("ElevenLabs does not support image relay")
}

func (a *Adaptor) ConvertOpenAIResponsesRequest(_ *gin.Context, _ *relaycommon.RelayInfo, _ dto.OpenAIResponsesRequest) (any, error) {
	return nil, errors.New("ElevenLabs does not support responses relay")
}

func (a *Adaptor) ConvertClaudeRequest(_ *gin.Context, _ *relaycommon.RelayInfo, _ *dto.ClaudeRequest) (any, error) {
	return nil, errors.New("ElevenLabs does not support Claude relay")
}

func (a *Adaptor) ConvertGeminiRequest(_ *gin.Context, _ *relaycommon.RelayInfo, _ *dto.GeminiChatRequest) (any, error) {
	return nil, errors.New("ElevenLabs does not support Gemini relay")
}

func (a *Adaptor) DoRequest(c *gin.Context, info *relaycommon.RelayInfo, requestBody io.Reader) (any, error) {
	if info.RelayMode == relayconstant.RelayModeAudioTranscription {
		return channel.DoFormRequest(a, c, info, requestBody)
	}
	return channel.DoApiRequest(a, c, info, requestBody)
}

func (a *Adaptor) DoResponse(c *gin.Context, resp *http.Response, info *relaycommon.RelayInfo) (any, *types.NewAPIError) {
	switch info.RelayMode {
	case relayconstant.RelayModeAudioSpeech:
		return a.handleSpeechResponse(c, resp), nil
	case relayconstant.RelayModeAudioTranscription:
		apiErr, usage := a.handleTranscriptionResponse(c, resp)
		return usage, apiErr
	default:
		return nil, types.NewError(fmt.Errorf("unsupported ElevenLabs relay mode %d", info.RelayMode), types.ErrorCodeBadResponseStatusCode)
	}
}

func (a *Adaptor) GetModelList() []string { return DefaultModelList }

func (a *Adaptor) GetChannelName() string { return "ElevenLabs" }

func (a *Adaptor) convertSpeechRequest(c *gin.Context, info *relaycommon.RelayInfo, request dto.AudioRequest) (io.Reader, error) {
	if strings.TrimSpace(request.Input) == "" {
		return nil, errors.New("input is required")
	}
	a.voiceID = strings.TrimSpace(request.Voice)
	if a.voiceID == "" {
		return nil, errors.New("voice is required and must be an ElevenLabs voice_id")
	}
	a.responseFormat = request.ResponseFormat
	upstreamModel := OpenAIAudioModel(request.Model, true)
	info.UpstreamModelName = upstreamModel
	payload := map[string]any{"text": request.Input, "model_id": upstreamModel}
	if request.Speed != nil {
		payload["voice_settings"] = map[string]any{"speed": *request.Speed}
	}
	jsonData, err := common.Marshal(payload)
	if err != nil {
		return nil, err
	}
	c.Set(contextTextCharsKey, utf8.RuneCountInString(request.Input))
	return bytes.NewReader(jsonData), nil
}

func (a *Adaptor) convertTranscriptionRequest(c *gin.Context, info *relaycommon.RelayInfo, request dto.AudioRequest) (io.Reader, error) {
	upstreamModel := OpenAIAudioModel(request.Model, false)
	info.UpstreamModelName = upstreamModel
	body, audioTokens, err := BuildOpenAITranscriptionMultipart(c, upstreamModel)
	if err != nil {
		return nil, err
	}
	c.Set(contextAudioTokensKey, audioTokens)
	return body, nil
}

func (a *Adaptor) handleSpeechResponse(c *gin.Context, resp *http.Response) *dto.Usage {
	defer service.CloseResponseBodyGracefully(resp)
	for key, values := range resp.Header {
		if len(values) > 0 && service.ShouldCopyUpstreamHeader(c, key, values) {
			c.Writer.Header().Set(key, values[0])
		}
	}
	c.Writer.WriteHeader(resp.StatusCode)
	_, _ = io.Copy(c.Writer, resp.Body)
	c.Writer.Flush()
	chars := correctedCharacterCost(c.GetInt(contextTextCharsKey), resp.Header)
	usage := &dto.Usage{PromptTokens: chars, TotalTokens: chars}
	usage.PromptTokensDetails.TextTokens = chars
	return usage
}

func (a *Adaptor) handleTranscriptionResponse(c *gin.Context, resp *http.Response) (*types.NewAPIError, *dto.Usage) {
	defer service.CloseResponseBodyGracefully(resp)
	responseBody, err := io.ReadAll(resp.Body)
	if err != nil {
		return types.NewOpenAIError(err, types.ErrorCodeReadResponseBodyFailed, http.StatusInternalServerError), nil
	}
	service.IOCopyBytesGracefully(c, resp, responseBody)
	audioTokens := c.GetInt(contextAudioTokensKey)
	usage := &dto.Usage{PromptTokens: audioTokens, TotalTokens: audioTokens}
	usage.PromptTokensDetails.AudioTokens = audioTokens
	return nil, usage
}
