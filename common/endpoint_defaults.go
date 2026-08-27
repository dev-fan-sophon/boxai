package common

import "github.com/dev-fan-sophon/boxai/constant"

// EndpointInfo 描述单个端点的默认请求信息
// path: 上游路径
// method: HTTP 请求方式，例如 POST/GET
// 目前均为 POST，后续可扩展
//
// json 标签用于直接序列化到 API 输出
// 例如：{"path":"/v1/chat/completions","method":"POST"}

type EndpointInfo struct {
	Path   string `json:"path"`
	Method string `json:"method"`
}

// defaultEndpointInfoMap 保存内置端点的默认 Path 与 Method
var defaultEndpointInfoMap = map[constant.EndpointType]EndpointInfo{
	constant.EndpointTypeOpenAI:                {Path: "/v1/chat/completions", Method: "POST"},
	constant.EndpointTypeOpenAIResponse:        {Path: "/v1/responses", Method: "POST"},
	constant.EndpointTypeOpenAIResponseCompact: {Path: "/v1/responses/compact", Method: "POST"},
	constant.EndpointTypeOpenAIAlphaSearch:     {Path: "/v1/alpha/search", Method: "POST"},
	constant.EndpointTypeAnthropic:             {Path: "/v1/messages", Method: "POST"},
	constant.EndpointTypeGemini:                {Path: "/v1beta/models/{model}:generateContent", Method: "POST"},
	constant.EndpointTypeGeminiEmbedding:       {Path: "/v1beta/models/{model}:embedContent", Method: "POST"},
	constant.EndpointTypeJinaRerank:            {Path: "/v1/rerank", Method: "POST"},
	constant.EndpointTypeImageGeneration:       {Path: "/v1/images/generations", Method: "POST"},
	constant.EndpointTypeEmbeddings:            {Path: "/v1/embeddings", Method: "POST"},
	constant.EndpointTypeAudio:                 {Path: "/v1/audio/speech", Method: "POST"},
	constant.EndpointTypeAudioTTS:              {Path: "/v1/audio/speech", Method: "POST"},
	constant.EndpointTypeAudioSTT:              {Path: "/v1/audio/transcriptions", Method: "POST"},
	constant.EndpointTypeAudioSpeechToSpeech:   {Path: "/elevenlabs/v1/speech-to-speech/{voice_id}", Method: "POST"},
	constant.EndpointTypeAudioSFX:              {Path: "/elevenlabs/v1/sound-generation", Method: "POST"},
	constant.EndpointTypeAudioMusic:            {Path: "/elevenlabs/v1/music/stream", Method: "POST"},
	constant.EndpointTypeAudioIsolation:        {Path: "/elevenlabs/v1/audio-isolation", Method: "POST"},
	constant.EndpointTypeAudioAlignment:        {Path: "/elevenlabs/v1/forced-alignment", Method: "POST"},
}

// GetDefaultEndpointInfo 返回指定端点类型的默认信息以及是否存在
func GetDefaultEndpointInfo(et constant.EndpointType) (EndpointInfo, bool) {
	info, ok := defaultEndpointInfoMap[et]
	return info, ok
}
