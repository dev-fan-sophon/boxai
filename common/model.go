package common

import "strings"

var (
	// OpenAIResponseOnlyModels is a list of models that are only available for OpenAI responses.
	OpenAIResponseOnlyModels = []string{
		"o3-pro",
		"o3-deep-research",
		"o4-mini-deep-research",
	}
	ImageGenerationModels = []string{
		"dall-e-3",
		"dall-e-2",
		"gpt-image-1",
		"gpt-image-2",
		"prefix:imagen-",
		"flux-",
		"flux.1-",
	}
	AudioModels = []string{
		"whisper-1",
		"tts-1",
		"tts-1-1106",
		"tts-1-hd",
		"tts-1-hd-1106",
		"gpt-4o-mini-tts",
		"gpt-4o-mini-tts-2025-03-20",
		"gpt-4o-mini-tts-2025-12-15",
		"eleven_v3",
		"eleven_flash_v2",
		"eleven_flash_v2_5",
		"eleven_turbo_v2",
		"eleven_turbo_v2_5",
		"eleven_multilingual_v1",
		"eleven_multilingual_v2",
		"scribe_v1",
		"scribe_v2",
		"eleven_english_sts_v2",
		"eleven_multilingual_sts_v2",
		"eleven_text_to_sound_v2",
		"music_v2",
		"elevenlabs-speech-to-speech",
		"elevenlabs-audio-isolation",
		"elevenlabs-forced-alignment",
		"elevenlabs-sound-generation",
		"elevenlabs-text-to-dialogue",
	}
	OpenAITextModels = []string{
		"gpt-",
		"o1",
		"o3",
		"o4",
		"chatgpt",
	}
)

func IsOpenAIResponseOnlyModel(modelName string) bool {
	for _, m := range OpenAIResponseOnlyModels {
		if strings.Contains(modelName, m) {
			return true
		}
	}
	return false
}

func IsImageGenerationModel(modelName string) bool {
	modelName = strings.ToLower(modelName)
	for _, m := range ImageGenerationModels {
		if strings.Contains(modelName, m) {
			return true
		}
		if strings.HasPrefix(m, "prefix:") && strings.HasPrefix(modelName, strings.TrimPrefix(m, "prefix:")) {
			return true
		}
	}
	return false
}

func IsAudioModel(modelName string) bool {
	modelName = strings.ToLower(modelName)
	for _, m := range AudioModels {
		if modelName == m || strings.HasPrefix(modelName, m+"-") {
			return true
		}
	}
	return false
}

func IsOpenAITextModel(modelName string) bool {
	modelName = strings.ToLower(modelName)
	for _, m := range OpenAITextModels {
		if strings.Contains(modelName, m) {
			return true
		}
	}
	return false
}
