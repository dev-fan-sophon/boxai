package constant

type EndpointType string

const (
	EndpointTypeOpenAI                EndpointType = "openai"
	EndpointTypeOpenAIResponse        EndpointType = "openai-response"
	EndpointTypeOpenAIResponseCompact EndpointType = "openai-response-compact"
	EndpointTypeOpenAIAlphaSearch     EndpointType = "openai-alpha-search"
	EndpointTypeDeepSeekToolsSearch   EndpointType = "deepseek-tools-search"
	EndpointTypeDeepSeekToolsFetch    EndpointType = "deepseek-tools-fetch"
	EndpointTypeAnthropic             EndpointType = "anthropic"
	EndpointTypeGemini                EndpointType = "gemini"
	EndpointTypeGeminiEmbedding       EndpointType = "gemini-embedding"
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

// Model names the distributor assigns to /v1/tools/search and /v1/tools/fetch,
// whose bodies carry no model (upstream 6cf0d90b5). Channels serve the
// endpoints by listing them; they are also the billing names.
const (
	DeepSeekSearchModel = "deepseek-search"
	DeepSeekFetchModel  = "deepseek-fetch"
)
