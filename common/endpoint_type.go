package common

import (
	"strings"

	"github.com/dev-fan-sophon/boxai/constant"
)

func elevenLabsEndpointTypes(modelName string) []constant.EndpointType {
	switch modelName {
	case "eleven_v3":
		return []constant.EndpointType{constant.EndpointTypeAudioTTS}
	case "scribe_v2":
		return []constant.EndpointType{constant.EndpointTypeAudioSTT}
	case "eleven_multilingual_sts_v2":
		return []constant.EndpointType{constant.EndpointTypeAudioSpeechToSpeech}
	case "eleven_text_to_sound_v2":
		return []constant.EndpointType{constant.EndpointTypeAudioSFX}
	case "music_v2":
		return []constant.EndpointType{constant.EndpointTypeAudioMusic}
	case "elevenlabs-audio-isolation":
		return []constant.EndpointType{constant.EndpointTypeAudioIsolation}
	case "elevenlabs-forced-alignment":
		return []constant.EndpointType{constant.EndpointTypeAudioAlignment}
	default:
		return nil
	}
}

// GetEndpointTypesByChannelType returns the relay surfaces a model can use.
func GetEndpointTypesByChannelType(channelType int, modelName string) []constant.EndpointType {
	var endpointTypes []constant.EndpointType
	if channelType == constant.ChannelTypeElevenLabs {
		return elevenLabsEndpointTypes(modelName)
	}
	if channelType == constant.ChannelTypeCodexProxy {
		normalized := strings.ToLower(strings.TrimSpace(modelName))
		switch {
		case strings.Contains(normalized, "audio"), strings.Contains(normalized, "video"), strings.Contains(normalized, "realtime"):
			return nil
		case IsImageGenerationModel(normalized):
			return []constant.EndpointType{constant.EndpointTypeImageGeneration}
		case strings.Contains(normalized, "embed"):
			return []constant.EndpointType{constant.EndpointTypeEmbeddings}
		default:
			return []constant.EndpointType{
				constant.EndpointTypeOpenAI,
				constant.EndpointTypeOpenAIResponse,
				constant.EndpointTypeAnthropic,
				constant.EndpointTypeGemini,
			}
		}
	}
	if strings.HasPrefix(modelName, "grok-imagine-video") {
		return []constant.EndpointType{constant.EndpointTypeOpenAIVideo}
	}
	if strings.HasPrefix(modelName, "grok-imagine-image") || IsImageGenerationModel(modelName) {
		return []constant.EndpointType{constant.EndpointTypeImageGeneration}
	}
	if channelType == constant.ChannelTypeGemini && strings.Contains(strings.ToLower(modelName), "embedding") {
		return []constant.EndpointType{constant.EndpointTypeEmbeddings, constant.EndpointTypeGeminiEmbedding}
	}
	if strings.Contains(strings.ToLower(modelName), "embedding") {
		return []constant.EndpointType{constant.EndpointTypeEmbeddings}
	}
	if IsAudioModel(modelName) {
		return []constant.EndpointType{constant.EndpointTypeAudio}
	}
	switch channelType {
	case constant.ChannelTypeJina:
		endpointTypes = []constant.EndpointType{constant.EndpointTypeJinaRerank}
	//case constant.ChannelTypeMidjourney, constant.ChannelTypeMidjourneyPlus:
	//	endpointTypes = []constant.EndpointType{constant.EndpointTypeMidjourney}
	//case constant.ChannelTypeSunoAPI:
	//	endpointTypes = []constant.EndpointType{constant.EndpointTypeSuno}
	//case constant.ChannelTypeKling:
	//	endpointTypes = []constant.EndpointType{constant.EndpointTypeKling}
	//case constant.ChannelTypeJimeng:
	//	endpointTypes = []constant.EndpointType{constant.EndpointTypeJimeng}
	case constant.ChannelTypeAws:
		fallthrough
	case constant.ChannelTypeAnthropic:
		endpointTypes = withChatResponsesSupport([]constant.EndpointType{constant.EndpointTypeAnthropic, constant.EndpointTypeOpenAI})
	case constant.ChannelTypeVertexAi:
		fallthrough
	case constant.ChannelTypeGemini:
		endpointTypes = withChatResponsesSupport([]constant.EndpointType{constant.EndpointTypeGemini, constant.EndpointTypeOpenAI})
	case constant.ChannelTypeOpenRouter: // OpenRouter 只支持 OpenAI 端点
		endpointTypes = withChatResponsesSupport([]constant.EndpointType{constant.EndpointTypeOpenAI})
	case constant.ChannelTypeXai:
		endpointTypes = []constant.EndpointType{constant.EndpointTypeOpenAI, constant.EndpointTypeOpenAIResponse}
	case constant.ChannelTypeSora:
		endpointTypes = []constant.EndpointType{constant.EndpointTypeOpenAIVideo}
	case constant.ChannelTypeCodex:
		endpointTypes = []constant.EndpointType{
			constant.EndpointTypeOpenAIResponse,
			constant.EndpointTypeOpenAIResponseCompact,
			constant.EndpointTypeOpenAIAlphaSearch,
		}
	case constant.ChannelTypeSub2API, constant.ChannelTypeNewAPI:
		endpointTypes = []constant.EndpointType{
			constant.EndpointTypeOpenAI,
			constant.EndpointTypeOpenAIResponse,
			constant.EndpointTypeOpenAIResponseCompact,
			constant.EndpointTypeAnthropic,
			constant.EndpointTypeGemini,
			constant.EndpointTypeOpenAIAlphaSearch,
		}
	default:
		if IsOpenAIResponseOnlyModel(modelName) {
			endpointTypes = []constant.EndpointType{constant.EndpointTypeOpenAIResponse}
		} else {
			endpointTypes = withChatResponsesSupport([]constant.EndpointType{constant.EndpointTypeOpenAI})
		}
	}
	return endpointTypes
}

func withChatResponsesSupport(endpoints []constant.EndpointType) []constant.EndpointType {
	for _, endpoint := range endpoints {
		if endpoint == constant.EndpointTypeOpenAIResponse || endpoint == constant.EndpointTypeOpenAIResponseCompact {
			return endpoints
		}
	}
	return append(endpoints, constant.EndpointTypeOpenAIResponse)
}
