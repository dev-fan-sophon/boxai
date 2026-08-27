package constant

type EndpointType string

const (
	EndpointTypeOpenAI                EndpointType = "openai"
	EndpointTypeOpenAIResponse        EndpointType = "openai-response"
	EndpointTypeOpenAIResponseCompact EndpointType = "openai-response-compact"
	EndpointTypeOpenAIAlphaSearch     EndpointType = "openai-alpha-search"
	EndpointTypeAnthropic             EndpointType = "anthropic"
	EndpointTypeGemini                EndpointType = "gemini"
	EndpointTypeJinaRerank            EndpointType = "jina-rerank"
	EndpointTypeImageGeneration       EndpointType = "image-generation"
	EndpointTypeEmbeddings            EndpointType = "embeddings"
	EndpointTypeOpenAIVideo           EndpointType = "openai-video"
	EndpointTypeAudio                 EndpointType = "audio"
	EndpointTypeAudioTTS              EndpointType = "audio-tts"
	EndpointTypeAudioSTT              EndpointType = "audio-stt"
	EndpointTypeAudioSpeechToSpeech   EndpointType = "audio-speech-to-speech"
	EndpointTypeAudioSFX              EndpointType = "audio-sfx"
	EndpointTypeAudioMusic            EndpointType = "audio-music"
	EndpointTypeAudioIsolation        EndpointType = "audio-isolation"
	EndpointTypeAudioAlignment        EndpointType = "audio-alignment"
	//EndpointTypeMidjourney     EndpointType = "midjourney-proxy"
	//EndpointTypeSuno           EndpointType = "suno-proxy"
	//EndpointTypeKling          EndpointType = "kling"
	//EndpointTypeJimeng         EndpointType = "jimeng"
)
