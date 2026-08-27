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
	"MiniMax-M3": textCatalogMetadata("MiniMax", "Open-weight MiniMax multimodal model for long-context coding, perception, and agent planning.", "reasoning,tools,multimodal,coding,long-context,open-weights", "Minimax.Color", false),

	"claude-fable-5":            textCatalogMetadata("Anthropic", "Claude model tuned for creative writing, nuanced analysis, and controlled agent workflows with image and document input.", "reasoning,tools,creative-writing,vision,documents,agents", "Claude.Color", true),
	"claude-haiku-4-5-20251001": textCatalogMetadata("Anthropic", "Fast Claude model for responsive assistance, classification, extraction, and lightweight tool-using agents.", "fast,tools,classification,extraction,vision,agents", "Claude.Color", true),
	"claude-opus-4-6":           textCatalogMetadata("Anthropic", "High-capability Claude Opus model for difficult coding, planning, analysis, and long-running agent tasks.", "reasoning,tools,coding,planning,vision,agents", "Claude.Color", true),
	"claude-opus-4-7":           textCatalogMetadata("Anthropic", "Claude Opus model for advanced software engineering, complex research, and high-stakes reasoning workflows.", "reasoning,tools,coding,research,vision,agents", "Claude.Color", true),
	"claude-opus-4-8":           textCatalogMetadata("Anthropic", "Top Claude Opus tier for the hardest reasoning, coding, multimodal analysis, and long-horizon agent work.", "reasoning,tools,coding,vision,long-horizon,agents", "Claude.Color", true),
	"claude-opus-5":             textCatalogMetadata("Anthropic", "Frontier Claude Opus model for expert coding, complex agents, professional analysis, and multimodal work.", "reasoning,tools,coding,vision,documents,agents", "Claude.Color", true),
	"claude-sonnet-4-6":         textCatalogMetadata("Anthropic", "Claude Sonnet workhorse for production coding agents, careful analysis, tool use, and balanced cost and latency.", "reasoning,tools,coding,vision,balanced,agents", "Claude.Color", true),
	"claude-sonnet-5":           textCatalogMetadata("Anthropic", "General-purpose Claude Sonnet model for coding, planning, browsing, document analysis, and everyday agent work.", "reasoning,tools,coding,vision,documents,agents", "Claude.Color", true),
	"deepseek-v4-flash":         textCatalogMetadata("DeepSeek", "Fast DeepSeek V4 model for economical reasoning, coding, tool use, and long-context agent workloads.", "reasoning,tools,coding,long-context,open-weights,fast", "DeepSeek.Color", false),
	"deepseek-v4-pro":           textCatalogMetadata("DeepSeek", "DeepSeek V4 Pro open-weight model with million-token context for complex coding and long-running agents.", "reasoning,tools,coding,1m-context,open-weights,agents", "DeepSeek.Color", false),
	"gemini-3.1-pro-preview":    textCatalogMetadata("Google", "Reasoning-first Gemini preview for agentic coding, complex problem solving, tools, and multimodal input.", "reasoning,tools,coding,multimodal,vision,agents", "Gemini.Color", true),
	"gemini-3.6-flash":          textCatalogMetadata("Google", "Fast Gemini model balancing multimodal reasoning, tool use, coding ability, latency, and cost.", "reasoning,tools,coding,multimodal,fast,balanced", "Gemini.Color", true),
	"gemini-3.7-flash":          textCatalogMetadata("Google", "High-efficiency Gemini model for agentic workflows, coding, tool use, and multimodal reasoning.", "reasoning,tools,coding,multimodal,fast,agents", "Gemini.Color", true),
	"gemini-3.7-flash-high":     textCatalogMetadata("Google", "Gemini 3.7 Flash variant with a higher reasoning budget for difficult coding and agent tasks.", "reasoning,tools,coding,multimodal,high-effort,agents", "Gemini.Color", true),
	"glm-5.2":                   textCatalogMetadata("Zhipu AI", "Open-weight GLM flagship for long-horizon coding agents, tool use, and million-token context workloads.", "reasoning,tools,coding,1m-context,open-weights,agents", "Zhipu.Color", false),
	"glm-5.2-fast":              textCatalogMetadata("Zhipu AI", "Low-latency GLM variant for efficient reasoning, coding, tool calls, and interactive agent workflows.", "reasoning,tools,coding,fast,long-context,agents", "Zhipu.Color", false),
	"glm-5.3":                   textCatalogMetadata("Zhipu AI", "Flagship GLM model for long-horizon coding, complex project delivery, tool use, and autonomous agents.", "reasoning,tools,coding,long-context,flagship,agents", "Zhipu.Color", false),
	"glm-5.3-flash":             textCatalogMetadata("Zhipu AI", "Efficient multimodal GLM model for coding, visual understanding, tool use, and long-running agents.", "reasoning,tools,coding,multimodal,fast,agents", "Zhipu.Color", false),
	"gpt-5.3-codex-spark":       textCatalogMetadata("OpenAI", "Coding-optimized GPT model for repository edits, reviews, command execution, and agentic software work.", "reasoning,tools,coding,vision,documents,agents", "OpenAI", true),
	"gpt-5.4":                   textCatalogMetadata("OpenAI", "Agent-ready GPT model for coding, computer-use workflows, research, tools, and multimodal knowledge work.", "reasoning,tools,coding,vision,computer-use,agents", "OpenAI", true),
	"gpt-5.4-mini":              textCatalogMetadata("OpenAI", "Efficient GPT model for coding subagents, quick reasoning, tool use, vision, and high-volume workloads.", "reasoning,tools,coding,vision,fast,cost-efficient", "OpenAI", true),
	"gpt-5.5":                   textCatalogMetadata("OpenAI", "Frontier GPT model for coding, computer use, research, tools, multimodal input, and professional knowledge work.", "reasoning,tools,coding,vision,computer-use,agents", "OpenAI", true),
	"gpt-5.6-luna":              textCatalogMetadata("OpenAI", "Cost-efficient GPT-5.6 route for fast search, tool use, coding, and high-volume agent workloads.", "reasoning,tools,coding,search,fast,cost-efficient", "OpenAI", true),
	"gpt-5.6-sol":               textCatalogMetadata("OpenAI", "Highest-capability GPT-5.6 route for complex professional work, coding, research, and agentic workflows.", "reasoning,tools,coding,research,vision,agents", "OpenAI", true),
	"gpt-5.6-terra":             textCatalogMetadata("OpenAI", "Balanced GPT-5.6 route for capable everyday coding, analysis, tool use, and multimodal agent work.", "reasoning,tools,coding,vision,balanced,agents", "OpenAI", true),
	"gpt-oss-120b":              textCatalogMetadata("OpenAI", "Open-weight 120B-class GPT model for self-hosted reasoning, instruction following, coding, and tool use.", "reasoning,tools,coding,open-weights,self-hosted,text", "OpenAI", false),
	"grok-4.5":                  textCatalogMetadata("xAI", "Grok model for chat, coding, visual analysis, tool-using agents, and grounded knowledge work.", "reasoning,tools,coding,vision,long-context,agents", "XAI.Color", true),
	"grok-4.6":                  textCatalogMetadata("xAI", "Frontier Grok model for long-running agents, coding, multimodal projects, and configurable reasoning.", "reasoning,tools,coding,vision,long-context,agents", "XAI.Color", true),
	"inkling":                   textCatalogMetadata("Thinking Machines Lab", "Open-weight 975B MoE multimodal reasoning model from Thinking Machines Lab with 41B active parameters, about one million tokens of context, text, image, and audio input, tool calling, and controllable thinking effort.", "reasoning,tools,multimodal,1m-context,open-weights,moe", "ThinkingMachines", false),
	"kimi-k2.6":                 textCatalogMetadata("Moonshot AI", "Open-weight multimodal Kimi workhorse for agent loops, coding, tool use, and visual or video context.", "reasoning,tools,coding,multimodal,open-weights,agents", "Kimi.Color", true),
	"kimi-k2.7-code":            textCatalogMetadata("Moonshot AI", "Coding-focused Kimi model for long-horizon repository work, tool use, visual context, and efficient reasoning.", "reasoning,tools,coding,multimodal,open-weights,agents", "Kimi.Color", true),
	"kimi-k3":                   textCatalogMetadata("Moonshot AI", "Open-weight multimodal Kimi model with million-token context and configurable thinking for long-horizon agents.", "reasoning,tools,multimodal,1m-context,open-weights,agents", "Kimi.Color", true),
	"kimi-k3-fast":              textCatalogMetadata("Moonshot AI", "Low-latency Kimi K3 variant for fast tool calling, coding, vision, structured output, and interactive agents.", "tools,coding,vision,structured-output,fast,agents", "Kimi.Color", true),
	"qwen3.8-max":               textCatalogMetadata("Alibaba", "Qwen flagship mixture-of-experts model for coding, professional work, multimodal understanding, and long-horizon agents.", "reasoning,tools,coding,multimodal,moe,agents", "Qwen.Color", false),

	"dreamina-seedance-2-5":       mediaCatalogMetadata("ByteDance", "Dreamina Seedance 2.5 video generation model for text-to-video and image-to-video workflows.", "video,generation,text-to-video,image-to-video", "Doubao.Color", []string{"text"}, []string{"video"}, []string{"video_generation"}),
	"seedance-2-0":                mediaCatalogMetadata("ByteDance", "Seedance 2.0 video generation model for text-to-video and image-to-video workflows.", "video,generation,text-to-video,image-to-video", "Doubao.Color", []string{"text"}, []string{"video"}, []string{"video_generation"}),
	"seedance-2-0-fast":           mediaCatalogMetadata("ByteDance", "Fast Seedance 2.0 video generation model for lower-latency text-to-video and image-to-video workflows.", "video,generation,text-to-video,image-to-video,fast", "Doubao.Color", []string{"text"}, []string{"video"}, []string{"video_generation"}),
	"gemini-3-pro-image":          mediaCatalogMetadata("Google", "High-fidelity Gemini image model for generation, design-heavy edits, visual composition, and text rendering.", "image,generation,editing,vision,design,text-rendering", "Gemini.Color", []string{"text", "image"}, []string{"image"}, []string{"image_generation", "image_editing"}),
	"gemini-3.1-flash-image":      mediaCatalogMetadata("Google", "Fast Gemini image model for prompt-driven generation, editing, visual ideation, and design workflows.", "image,generation,editing,vision,fast,design", "Gemini.Color", []string{"text", "image"}, []string{"image"}, []string{"image_generation", "image_editing"}),
	"gemini-3.1-flash-lite-image": mediaCatalogMetadata("Google", "Cost-efficient Gemini image model for high-volume 1K generation, editing, and visual content workflows.", "image,generation,editing,vision,fast,cost-efficient", "Gemini.Color", []string{"text", "image"}, []string{"image"}, []string{"image_generation", "image_editing"}),
	"gpt-image-2":                 mediaCatalogMetadata("OpenAI", "Image generation model for creating and editing high-quality images from text and visual prompts.", "image,generation,vision", "OpenAI", []string{"text", "image"}, []string{"image"}, []string{"image_generation", "image_editing"}),
	"grok-imagine-image-2.0":      mediaCatalogMetadata("xAI", "Grok Imagine Image 2.0 for high-quality image generation and editing at 1K or 2K resolution.", "image,generation,editing,text-to-image,image-to-image", "XAI.Color", []string{"text", "image"}, []string{"image"}, []string{"image_generation", "image_editing"}),
	"grok-imagine-video-1.5":      mediaCatalogMetadata("xAI", "Grok Imagine Video 1.5 for text-to-video and image-to-video generation up to 1080p.", "video,generation,text-to-video,image-to-video", "XAI.Color", []string{"text", "image"}, []string{"video"}, []string{"video_generation", "image_to_video", "native_audio"}),

	"text-embedding-3-large": mediaCatalogMetadata("OpenAI", "High-accuracy text embedding model for semantic search, retrieval, clustering, recommendations, and ranking.", "embeddings,retrieval,semantic-search,ranking,clustering,text", "OpenAI", []string{"text"}, []string{"embedding"}, []string{"embeddings"}),
	"text-embedding-3-small": mediaCatalogMetadata("OpenAI", "Cost-efficient text embedding model for semantic search, retrieval, clustering, recommendations, and ranking.", "embeddings,retrieval,semantic-search,ranking,clustering,text", "OpenAI", []string{"text"}, []string{"embedding"}, []string{"embeddings"}),

	"eleven_v3":                   mediaCatalogMetadata("ElevenLabs", "ElevenLabs' latest expressive text-to-speech model for high-quality voice generation.", "tts,voice,audio", "ElevenLabs.Avatar", []string{"text"}, []string{"audio"}, []string{"speech_synthesis"}),
	"scribe_v2":                   mediaCatalogMetadata("ElevenLabs", "Speech-to-text model for transcription, subtitles, and spoken-language understanding.", "stt,transcription,audio", "ElevenLabs.Avatar", []string{"audio"}, []string{"text"}, []string{"transcription"}),
	"eleven_multilingual_sts_v2":  mediaCatalogMetadata("ElevenLabs", "Speech-to-speech model for transforming spoken audio while preserving expressive delivery.", "speech-to-speech,voice,audio", "ElevenLabs.Avatar", []string{"audio"}, []string{"audio"}, []string{"speech_to_speech"}),
	"eleven_text_to_sound_v2":     mediaCatalogMetadata("ElevenLabs", "Text-to-sound-effects model for short SFX, notification sounds, game audio, and ambience.", "sfx,sound-effects,audio", "ElevenLabs.Avatar", []string{"text"}, []string{"audio"}, []string{"sound_generation"}),
	"music_v2":                    mediaCatalogMetadata("ElevenLabs", "Music generation model for prompt-driven instrumental tracks, stings, and longer compositions.", "music,generation,audio", "ElevenLabs.Avatar", []string{"text"}, []string{"audio"}, []string{"music_generation"}),
	"elevenlabs-audio-isolation":  mediaCatalogMetadata("ElevenLabs", "Audio isolation capability for separating or enhancing speech from noisy source audio.", "isolation,cleanup,audio", "ElevenLabs.Avatar", []string{"audio"}, []string{"audio"}, []string{"audio_isolation"}),
	"elevenlabs-forced-alignment": mediaCatalogMetadata("ElevenLabs", "Forced alignment capability that aligns transcript text to audio and returns word and character timestamps.", "alignment,timestamps,audio", "ElevenLabs.Avatar", []string{"text", "audio"}, []string{"text"}, []string{"forced_alignment", "timestamps"}),
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
	"Thinking Machines Lab": "ThinkingMachines", "xAI": "XAI", "ByteDance": "Doubao.Color",
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
			// These public fields are owned by the shared catalog. Keep endpoint
			// and capability metadata below fill-only so provider-specific local
			// behavior is not overwritten by catalog reconciliation.
			meta.Description = metadata.Description
			meta.Tags = metadata.Tags
			meta.Icon = metadata.Icon
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
			if description := defaultVendorDescriptions[vendorName]; description != "" {
				vendor.Description = description
			}
			if icon := getDefaultVendorIcon(vendorName); icon != "" {
				vendor.Icon = icon
			}
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
