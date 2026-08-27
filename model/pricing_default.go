package model

import (
	"strings"

	"github.com/dev-fan-sophon/boxai/common"
)

type defaultModelCatalogMetadata struct {
	Vendor           string
	Description      string
	Tags             string
	Icon             string
	InputModalities  []string
	OutputModalities []string
	Capabilities     []string
}

func textCatalogMetadata(vendor, description, tags, icon string, multimodal bool) defaultModelCatalogMetadata {
	inputModalities := []string{"text"}
	capabilities := []string{"streaming", "reasoning", "tools"}
	if multimodal {
		inputModalities = []string{"text", "image"}
		capabilities = append(capabilities, "vision")
	}
	return defaultModelCatalogMetadata{
		Vendor: vendor, Description: description, Tags: tags, Icon: icon,
		InputModalities: inputModalities, OutputModalities: []string{"text"}, Capabilities: capabilities,
	}
}

func mediaCatalogMetadata(vendor, description, tags, icon string, input, output, capabilities []string) defaultModelCatalogMetadata {
	return defaultModelCatalogMetadata{
		Vendor: vendor, Description: description, Tags: tags, Icon: icon,
		InputModalities: input, OutputModalities: output, Capabilities: capabilities,
	}
}

var defaultVendorDescriptions = map[string]string{
	"Alibaba":               "Alibaba Cloud model family, including Qwen foundation models.",
	"Anthropic":             "AI safety and research company behind the Claude model family.",
	"ByteDance":             "Technology company behind Seedance and Dreamina media models.",
	"DeepSeek":              "AI research company building efficient open and reasoning models.",
	"ElevenLabs":            "Voice AI platform for speech synthesis, transcription, sound effects, music generation, and audio processing.",
	"Google":                "Google AI model family, including Gemini language and image models.",
	"MiniMax":               "AI company building multimodal foundation and agent models.",
	"Moonshot AI":           "AI company behind the Kimi model family.",
	"OpenAI":                "AI research and product company behind GPT and text embedding models.",
	"Thinking Machines Lab": "AI research company behind the Inkling model.",
	"xAI":                   "AI company behind Grok language and media models.",
	"Zhipu AI":              "AI company behind the GLM model family.",
}

var defaultModelCatalogMetadataByName = map[string]defaultModelCatalogMetadata{
	"MiniMax-M3": textCatalogMetadata("MiniMax", "MiniMax agent model for coding, reasoning, and tool-driven workflows.", "family:minimax,chat,reasoning,tools,input:text,output:text", "Minimax.Color", false),

	"claude-fable-5":            textCatalogMetadata("Anthropic", "Claude model for creative writing, analysis, and controlled agent workflows.", "family:claude,chat,reasoning,tools,vision,input:text,input:image,output:text", "Claude.Color", true),
	"claude-haiku-4-5-20251001": textCatalogMetadata("Anthropic", "Fast Claude Haiku model for responsive assistants, extraction, and lightweight agent tasks.", "family:claude-haiku,chat,reasoning,tools,vision,input:text,input:image,output:text", "Claude.Color", true),
	"claude-opus-4-6":           textCatalogMetadata("Anthropic", "Claude Opus model for demanding coding, analysis, and long-running agent tasks.", "family:claude-opus,chat,reasoning,tools,vision,input:text,input:image,output:text", "Claude.Color", true),
	"claude-opus-4-7":           textCatalogMetadata("Anthropic", "Claude Opus model for complex professional work, coding, and agent orchestration.", "family:claude-opus,chat,reasoning,tools,vision,input:text,input:image,output:text", "Claude.Color", true),
	"claude-opus-4-8":           textCatalogMetadata("Anthropic", "Claude Opus model for advanced reasoning, repository work, and autonomous agents.", "family:claude-opus,chat,reasoning,tools,vision,input:text,input:image,output:text", "Claude.Color", true),
	"claude-opus-5":             textCatalogMetadata("Anthropic", "Claude Opus flagship for coding, agents, and professional knowledge work.", "family:claude-opus,chat,reasoning,tools,vision,input:text,input:image,output:text", "Claude.Color", true),
	"claude-sonnet-4-6":         textCatalogMetadata("Anthropic", "Balanced Claude Sonnet model for coding, analysis, and everyday agent workflows.", "family:claude-sonnet,chat,reasoning,tools,vision,input:text,input:image,output:text", "Claude.Color", true),
	"claude-sonnet-5":           textCatalogMetadata("Anthropic", "Claude Sonnet model for coding, planning, browsing, and general agent work.", "family:claude-sonnet,chat,reasoning,tools,vision,input:text,input:image,output:text", "Claude.Color", true),
	"deepseek-v4-flash":         textCatalogMetadata("DeepSeek", "Fast DeepSeek V4 model for economical reasoning, coding, and long-context work.", "family:deepseek,chat,reasoning,tools,open-weights,input:text,output:text", "DeepSeek.Color", false),
	"deepseek-v4-pro":           textCatalogMetadata("DeepSeek", "DeepSeek V4 flagship for coding, complex reasoning, and long agent runs.", "family:deepseek,chat,reasoning,tools,open-weights,input:text,output:text", "DeepSeek.Color", false),
	"gemini-3.1-pro-preview":    textCatalogMetadata("Google", "Reasoning-first Gemini Pro preview for agentic coding and complex problem solving.", "family:gemini-pro,chat,reasoning,tools,vision,input:text,input:image,output:text", "Gemini.Color", true),
	"gemini-3.6-flash":          textCatalogMetadata("Google", "Fast Gemini model for responsive reasoning, generation, and tool use.", "family:gemini-flash,chat,reasoning,tools,vision,input:text,input:image,output:text", "Gemini.Color", true),
	"gemini-3.7-flash":          textCatalogMetadata("Google", "Gemini Flash model for high-throughput chat, coding, and multimodal work.", "family:gemini-flash,chat,reasoning,tools,vision,input:text,input:image,output:text", "Gemini.Color", true),
	"gemini-3.7-flash-high":     textCatalogMetadata("Google", "Gemini Flash high-reasoning model for difficult analysis and coding tasks.", "family:gemini-flash,chat,reasoning,tools,vision,input:text,input:image,output:text", "Gemini.Color", true),
	"glm-5.2":                   textCatalogMetadata("Zhipu AI", "GLM flagship model for long-horizon coding agents and extended-context reasoning.", "family:glm,chat,reasoning,tools,open-weights,input:text,output:text", "Zhipu.Color", false),
	"glm-5.2-fast":              textCatalogMetadata("Zhipu AI", "Fast GLM 5.2 variant for responsive coding, reasoning, and agent loops.", "family:glm,chat,reasoning,tools,input:text,output:text", "Zhipu.Color", false),
	"glm-5.3":                   textCatalogMetadata("Zhipu AI", "GLM 5.3 model for coding, reasoning, and tool-enabled agent workflows.", "family:glm,chat,reasoning,tools,input:text,output:text", "Zhipu.Color", false),
	"glm-5.3-flash":             textCatalogMetadata("Zhipu AI", "Low-latency GLM 5.3 model for chat, coding, and high-volume agent tasks.", "family:glm,chat,reasoning,tools,input:text,output:text", "Zhipu.Color", false),
	"gpt-5.3-codex-spark":       textCatalogMetadata("OpenAI", "Coding-optimized GPT model for repository edits, reviews, and agentic software work.", "family:gpt-codex,chat,reasoning,tools,vision,input:text,input:image,output:text", "OpenAI", true),
	"gpt-5.4":                   textCatalogMetadata("OpenAI", "Agent-ready GPT model for coding, reasoning, and computer-use workflows.", "family:gpt,chat,reasoning,tools,vision,input:text,input:image,output:text", "OpenAI", true),
	"gpt-5.4-mini":              textCatalogMetadata("OpenAI", "Efficient GPT model for fast chat, reasoning, coding, and tool use.", "family:gpt,chat,reasoning,tools,vision,input:text,input:image,output:text", "OpenAI", true),
	"gpt-5.5":                   textCatalogMetadata("OpenAI", "GPT model for advanced reasoning, coding, tools, and multimodal chat.", "family:gpt,chat,reasoning,tools,vision,input:text,input:image,output:text", "OpenAI", true),
	"gpt-5.6-luna":              textCatalogMetadata("OpenAI", "Cost-efficient GPT model for fast, high-volume agent workloads.", "family:gpt,chat,reasoning,tools,vision,input:text,input:image,output:text", "OpenAI", true),
	"gpt-5.6-sol":               textCatalogMetadata("OpenAI", "Frontier GPT model for complex professional work, coding, and agentic workflows.", "family:gpt,chat,reasoning,tools,vision,input:text,input:image,output:text", "OpenAI", true),
	"gpt-5.6-terra":             textCatalogMetadata("OpenAI", "Balanced GPT model for capable, cost-efficient everyday agent work.", "family:gpt,chat,reasoning,tools,vision,input:text,input:image,output:text", "OpenAI", true),
	"gpt-oss-120b":              textCatalogMetadata("OpenAI", "Open-weight GPT model for reasoning, coding, and self-hostable tool workflows.", "family:gpt-oss,chat,reasoning,tools,open-weights,input:text,output:text", "OpenAI", false),
	"grok-4.5":                  textCatalogMetadata("xAI", "Grok model for chat, coding, agentic tools, and visual reasoning.", "family:grok,chat,reasoning,tools,vision,input:text,input:image,output:text", "XAI", true),
	"grok-4.6":                  textCatalogMetadata("xAI", "Grok flagship for coding, long-running agents, and visual work.", "family:grok,chat,reasoning,tools,vision,input:text,input:image,output:text", "XAI", true),
	"inkling":                   textCatalogMetadata("Thinking Machines Lab", "Thinking Machines Lab model for efficient reasoning, coding, and general assistant workloads.", "family:inkling,chat,reasoning,tools,input:text,output:text", "Fireworks.Color", false),
	"kimi-k2.6":                 textCatalogMetadata("Moonshot AI", "Multimodal Kimi workhorse for agent loops, coding tasks, and visual context.", "family:kimi,chat,reasoning,tools,vision,input:text,input:image,output:text", "Moonshot", true),
	"kimi-k2.7-code":            textCatalogMetadata("Moonshot AI", "Coding-focused Kimi model for long-horizon repository and software agent work.", "family:kimi,chat,reasoning,tools,vision,input:text,input:image,output:text", "Moonshot", true),
	"kimi-k3":                   textCatalogMetadata("Moonshot AI", "Multimodal Kimi model for long-context reasoning and agent workflows.", "family:kimi,chat,reasoning,tools,vision,input:text,input:image,output:text", "Moonshot", true),
	"kimi-k3-fast":              textCatalogMetadata("Moonshot AI", "Fast Kimi model for responsive coding, chat, and tool-enabled agents.", "family:kimi,chat,reasoning,tools,vision,input:text,input:image,output:text", "Moonshot", true),
	"qwen3.8-max":               textCatalogMetadata("Alibaba", "Qwen flagship model for multilingual reasoning, coding, and tool use.", "family:qwen,chat,reasoning,tools,input:text,output:text", "Qwen.Color", false),

	"dreamina-seedance-2-5":       mediaCatalogMetadata("ByteDance", "Dreamina Seedance 2.5 model for prompt-driven video generation.", "family:seedance,video-generation,input:text,output:video", "Doubao.Color", []string{"text"}, []string{"video"}, []string{"video_generation"}),
	"seedance-2-0":                mediaCatalogMetadata("ByteDance", "Seedance 2.0 model for prompt-driven video generation.", "family:seedance,video-generation,input:text,output:video", "Doubao.Color", []string{"text"}, []string{"video"}, []string{"video_generation"}),
	"seedance-2-0-fast":           mediaCatalogMetadata("ByteDance", "Fast Seedance 2.0 model for prompt-driven video generation.", "family:seedance,video-generation,input:text,output:video", "Doubao.Color", []string{"text"}, []string{"video"}, []string{"video_generation"}),
	"gemini-3-pro-image":          mediaCatalogMetadata("Google", "Gemini Pro image model for high-quality generation and visual editing.", "family:gemini-image,image-generation,image-editing,input:text,input:image,output:image", "Gemini.Color", []string{"text", "image"}, []string{"image"}, []string{"image_generation", "image_editing"}),
	"gemini-3.1-flash-image":      mediaCatalogMetadata("Google", "Fast Gemini image model for prompt-driven generation and editing.", "family:gemini-image,image-generation,image-editing,input:text,input:image,output:image", "Gemini.Color", []string{"text", "image"}, []string{"image"}, []string{"image_generation", "image_editing"}),
	"gemini-3.1-flash-lite-image": mediaCatalogMetadata("Google", "Efficient Gemini image model for rapid generation and editing workflows.", "family:gemini-image,image-generation,image-editing,input:text,input:image,output:image", "Gemini.Color", []string{"text", "image"}, []string{"image"}, []string{"image_generation", "image_editing"}),
	"gpt-image-2":                 mediaCatalogMetadata("OpenAI", "OpenAI image model for prompt-driven generation, editing, and visual design.", "family:gpt-image,image-generation,image-editing,input:text,input:image,output:image", "OpenAI", []string{"text", "image"}, []string{"image"}, []string{"image_generation", "image_editing"}),
	"grok-imagine-image-2.0":      mediaCatalogMetadata("xAI", "Grok Imagine model for image generation and editing.", "family:grok-imagine,image-generation,image-editing,input:text,input:image,output:image", "XAI", []string{"text", "image"}, []string{"image"}, []string{"image_generation", "image_editing"}),
	"grok-imagine-video-1.5":      mediaCatalogMetadata("xAI", "Grok Imagine image-to-video model with native audio and high-resolution output.", "family:grok-imagine,image-to-video,native-audio,input:text,input:image,output:video", "XAI", []string{"text", "image"}, []string{"video"}, []string{"video_generation", "image_to_video", "native_audio"}),

	"text-embedding-3-large": mediaCatalogMetadata("OpenAI", "High-capacity OpenAI text embedding model for semantic search, clustering, and retrieval.", "family:text-embedding,embeddings,input:text,output:embedding", "OpenAI", []string{"text"}, []string{"embedding"}, []string{"embeddings"}),
	"text-embedding-3-small": mediaCatalogMetadata("OpenAI", "Efficient OpenAI text embedding model for semantic search, clustering, and retrieval.", "family:text-embedding,embeddings,input:text,output:embedding", "OpenAI", []string{"text"}, []string{"embedding"}, []string{"embeddings"}),

	"eleven_v3":                   mediaCatalogMetadata("ElevenLabs", "Expressive text-to-speech model for high-quality voice generation.", "family:elevenlabs,tts,voice,input:text,output:audio", "ElevenLabs.Avatar", []string{"text"}, []string{"audio"}, []string{"speech_synthesis"}),
	"scribe_v2":                   mediaCatalogMetadata("ElevenLabs", "Speech-to-text model for transcription, subtitles, and spoken-language understanding.", "family:elevenlabs,stt,transcription,input:audio,output:text", "ElevenLabs.Avatar", []string{"audio"}, []string{"text"}, []string{"transcription"}),
	"eleven_multilingual_sts_v2":  mediaCatalogMetadata("ElevenLabs", "Speech-to-speech model that transforms voices while preserving expressive delivery.", "family:elevenlabs,speech-to-speech,voice,input:audio,output:audio", "ElevenLabs.Avatar", []string{"audio"}, []string{"audio"}, []string{"speech_to_speech"}),
	"eleven_text_to_sound_v2":     mediaCatalogMetadata("ElevenLabs", "Text-to-sound-effects model for short SFX, game audio, and ambience.", "family:elevenlabs,sfx,sound-generation,input:text,output:audio", "ElevenLabs.Avatar", []string{"text"}, []string{"audio"}, []string{"sound_generation"}),
	"music_v2":                    mediaCatalogMetadata("ElevenLabs", "Music generation model for prompt-driven tracks and longer compositions.", "family:elevenlabs,music,generation,input:text,output:audio", "ElevenLabs.Avatar", []string{"text"}, []string{"audio"}, []string{"music_generation"}),
	"elevenlabs-audio-isolation":  mediaCatalogMetadata("ElevenLabs", "Audio isolation capability for separating speech from noisy source audio.", "family:elevenlabs,isolation,cleanup,input:audio,output:audio", "ElevenLabs.Avatar", []string{"audio"}, []string{"audio"}, []string{"audio_isolation"}),
	"elevenlabs-forced-alignment": mediaCatalogMetadata("ElevenLabs", "Forced alignment capability that aligns transcript text to audio timestamps.", "family:elevenlabs,alignment,timestamps,input:text,input:audio,output:text", "ElevenLabs.Avatar", []string{"text", "audio"}, []string{"text"}, []string{"forced_alignment", "timestamps"}),
}

type defaultVendorRule struct {
	Prefix string
	Vendor string
}

// Ordered family prefixes make fallback inference deterministic and prevent a
// family name from matching inside an unrelated model (for example, inkling).
var defaultVendorRules = []defaultVendorRule{
	{Prefix: "text-embedding-", Vendor: "OpenAI"},
	{Prefix: "gpt", Vendor: "OpenAI"}, {Prefix: "dall-e", Vendor: "OpenAI"},
	{Prefix: "whisper", Vendor: "OpenAI"}, {Prefix: "tts-", Vendor: "OpenAI"},
	{Prefix: "o1", Vendor: "OpenAI"}, {Prefix: "o3", Vendor: "OpenAI"},
	{Prefix: "eleven_", Vendor: "ElevenLabs"}, {Prefix: "elevenlabs", Vendor: "ElevenLabs"},
	{Prefix: "music_v", Vendor: "ElevenLabs"}, {Prefix: "scribe", Vendor: "ElevenLabs"},
	{Prefix: "claude", Vendor: "Anthropic"}, {Prefix: "gemini", Vendor: "Google"},
	{Prefix: "moonshot", Vendor: "Moonshot AI"}, {Prefix: "kimi", Vendor: "Moonshot AI"},
	{Prefix: "chatglm", Vendor: "Zhipu AI"}, {Prefix: "glm-", Vendor: "Zhipu AI"},
	{Prefix: "qwen", Vendor: "Alibaba"}, {Prefix: "deepseek", Vendor: "DeepSeek"},
	{Prefix: "abab", Vendor: "MiniMax"}, {Prefix: "minimax", Vendor: "MiniMax"},
	{Prefix: "ernie", Vendor: "百度"}, {Prefix: "spark", Vendor: "讯飞"},
	{Prefix: "hunyuan", Vendor: "腾讯"}, {Prefix: "command", Vendor: "Cohere"},
	{Prefix: "@cf/", Vendor: "Cloudflare"}, {Prefix: "360", Vendor: "360"},
	{Prefix: "yi", Vendor: "零一万物"}, {Prefix: "jina", Vendor: "Jina"},
	{Prefix: "mistral", Vendor: "Mistral"}, {Prefix: "grok", Vendor: "xAI"},
	{Prefix: "llama", Vendor: "Meta"}, {Prefix: "doubao", Vendor: "ByteDance"},
	{Prefix: "seedance", Vendor: "ByteDance"}, {Prefix: "dreamina", Vendor: "ByteDance"},
	{Prefix: "kling", Vendor: "快手"}, {Prefix: "jimeng", Vendor: "即梦"},
	{Prefix: "vidu", Vendor: "Vidu"},
}

var defaultVendorIcons = map[string]string{
	"OpenAI": "OpenAI", "ElevenLabs": "ElevenLabs.Avatar", "Anthropic": "Claude.Color",
	"Google": "Gemini.Color", "Moonshot AI": "Moonshot", "Zhipu AI": "Zhipu.Color",
	"Alibaba": "Qwen.Color", "DeepSeek": "DeepSeek.Color", "MiniMax": "Minimax.Color",
	"Thinking Machines Lab": "Fireworks.Color", "xAI": "XAI", "ByteDance": "Doubao.Color",
	"百度": "Wenxin.Color", "讯飞": "Spark.Color", "腾讯": "Hunyuan.Color", "Cohere": "Cohere.Color",
	"Cloudflare": "Cloudflare.Color", "360": "Ai360.Color", "零一万物": "Yi.Color",
	"Jina": "Jina", "Mistral": "Mistral.Color", "Meta": "Ollama", "快手": "Kling.Color",
	"即梦": "Jimeng.Color", "Vidu": "Vidu", "微软": "AzureAI", "Microsoft": "AzureAI", "Azure": "AzureAI",
}

func initDefaultVendorMapping(metaMap map[string]*Model, vendorMap map[int]*Vendor, enableAbilities []AbilityWithChannel) {
	for _, ability := range enableAbilities {
		modelName := ability.Model
		if metadata, ok := defaultModelCatalogMetadataByName[modelName]; ok {
			meta := &Model{ModelName: modelName, Status: 1, NameRule: NameRuleExact}
			if existing := metaMap[modelName]; existing != nil {
				copy := *existing
				meta = &copy
				meta.ModelName = modelName
			}
			if strings.TrimSpace(meta.Description) == "" {
				meta.Description = metadata.Description
			}
			if strings.TrimSpace(meta.Tags) == "" {
				meta.Tags = metadata.Tags
			}
			if strings.TrimSpace(meta.Icon) == "" {
				meta.Icon = metadata.Icon
			}
			meta.VendorID = getOrCreateVendor(metadata.Vendor, vendorMap)
			if catalogMetadataFieldMissing(meta.InputModalities) {
				meta.InputModalities = marshalCatalogStrings(metadata.InputModalities)
			}
			if catalogMetadataFieldMissing(meta.OutputModalities) {
				meta.OutputModalities = marshalCatalogStrings(metadata.OutputModalities)
			}
			if catalogMetadataFieldMissing(meta.Capabilities) {
				meta.Capabilities = marshalCatalogStrings(metadata.Capabilities)
			}
			metaMap[modelName] = meta
			continue
		}
		if _, exists := metaMap[modelName]; exists {
			continue
		}

		vendorID := 0
		modelLower := strings.ToLower(strings.TrimSpace(modelName))
		for _, rule := range defaultVendorRules {
			if strings.HasPrefix(modelLower, rule.Prefix) {
				vendorID = getOrCreateVendor(rule.Vendor, vendorMap)
				break
			}
		}
		metaMap[modelName] = &Model{ModelName: modelName, VendorID: vendorID, Status: 1, NameRule: NameRuleExact}
	}
}

func catalogMetadataFieldMissing(value string) bool {
	switch strings.TrimSpace(value) {
	case "", "[]", "null":
		return true
	default:
		return false
	}
}

func marshalCatalogStrings(values []string) string {
	data, err := common.Marshal(values)
	if err != nil {
		return "[]"
	}
	return string(data)
}

func getOrCreateVendor(vendorName string, vendorMap map[int]*Vendor) int {
	for id, vendor := range vendorMap {
		if vendor.Name == vendorName {
			return id
		}
	}

	newVendor := &Vendor{
		Name: vendorName, Description: defaultVendorDescriptions[vendorName],
		Status: 1, Icon: getDefaultVendorIcon(vendorName),
	}
	if err := newVendor.Insert(); err != nil {
		return 0
	}
	vendorMap[newVendor.Id] = newVendor
	return newVendor.Id
}

func getDefaultVendorIcon(vendorName string) string {
	return defaultVendorIcons[vendorName]
}
