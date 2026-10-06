package common

import (
	"errors"
	"fmt"
	"strconv"
	"strings"

	"github.com/dev-fan-sophon/boxai/common"
	"github.com/dev-fan-sophon/boxai/dto"
)

// Image model families with a modeled request contract. Unknown models keep
// the historical pass-through behavior.
const (
	ImageFamilyGPT    = "gpt-image"
	ImageFamilyXAI    = "xai"
	ImageFamilyGemini = "gemini"
)

const (
	// GPTImageMaxReferenceImages: OpenAI gpt-image edits accept up to 16 images.
	GPTImageMaxReferenceImages = 16
	// XAIImageMaxReferenceImages: xAI multi-image editing accepts up to five
	// source images (docs.x.ai …/images/multi-image-editing).
	XAIImageMaxReferenceImages = 5
	// GeminiImageMaxReferenceImages: Gemini image models accept up to 14
	// reference images (ai.google.dev/gemini-api/docs/image-generation).
	GeminiImageMaxReferenceImages = 14
	// GPTImageMaxN and XAIImageMaxN are the provider `n` ranges (1–10).
	GPTImageMaxN = 10
	XAIImageMaxN = 10
	// Gemini returns one image per generateContent call.
	GeminiImageMaxN = 1

	gptImageMaxEdge      = 3840
	gptImageMinPixels    = 655_360
	gptImageMaxPixels    = 8_294_400
	gptImageMaxEdgeRatio = 3
)

var (
	xaiImageAspectRatios = []string{"auto", "1:1", "16:9", "9:16", "4:3", "3:4", "3:2", "2:3", "2:1", "1:2", "19.5:9", "9:19.5", "20:9", "9:20", "21:9", "5:2"}
	xaiImageResolutions  = []string{"1k", "2k"}
	xaiImageQualities    = []string{"auto", "low", "medium"}

	geminiImageAspectRatios = []string{"1:1", "3:2", "2:3", "3:4", "4:3", "4:5", "5:4", "9:16", "16:9", "21:9"}

	gptImageClassicSizes = []string{"auto", "1024x1024", "1536x1024", "1024x1536"}
	gptImage2Sizes       = []string{"auto", "1024x1024", "1536x1024", "1024x1536", "2048x2048", "2048x1152", "1152x2048", "3840x2160", "2160x3840"}
	gptImageQualities    = []string{"auto", "low", "medium", "high"}
	gptImageBackgrounds  = []string{"auto", "opaque", "transparent"}
	gptImageFormats      = []string{"png", "jpeg", "webp"}
	gptImageModeration   = []string{"auto", "low"}
)

// BareImageModel lowercases a model id and strips a vendor prefix such as
// "openai/" so family checks work on catalog ids.
func BareImageModel(model string) string {
	name := strings.ToLower(strings.TrimSpace(model))
	if index := strings.LastIndex(name, "/"); index >= 0 {
		name = name[index+1:]
	}
	return name
}

// ImageModelFamily classifies an image model id; "" means unmodeled.
func ImageModelFamily(model string) string {
	bare := BareImageModel(model)
	switch {
	case strings.HasPrefix(bare, "gpt-image-"):
		return ImageFamilyGPT
	case strings.HasPrefix(bare, "grok-imagine-image"), strings.HasPrefix(bare, "grok-2-image"):
		return ImageFamilyXAI
	case strings.HasPrefix(bare, "gemini-") && strings.Contains(bare, "-image"),
		strings.HasPrefix(bare, "nano-banana"):
		return ImageFamilyGemini
	}
	return ""
}

func isFlexibleGPTImageModel(model string) bool {
	return strings.HasPrefix(BareImageModel(model), "gpt-image-2") && !IsGPTImage25Model(model)
}

// IsGPTImage25Model identifies the native Rolldek Image 2.5 contract, not
// OpenAI's flexible-size GPT Image 2 contract.
func IsGPTImage25Model(model string) bool {
	bare := BareImageModel(model)
	return bare == "gpt-image-2.5-sunburst" || bare == "gpt-image-2.5-flare"
}

func geminiImageResolutions(model string) []string {
	bare := BareImageModel(model)
	switch {
	case strings.Contains(bare, "flash-lite-image"):
		return []string{"1K"}
	case strings.HasPrefix(bare, "gemini-3"), strings.HasPrefix(bare, "nano-banana-pro"):
		return []string{"1K", "2K", "4K"}
	}
	// Gemini 2.x image models have no imageSize control.
	return []string{}
}

// DefaultImageCapabilities returns the modeled contract of an image model, or
// nil when the model is not a modeled image family.
func DefaultImageCapabilities(model string) *dto.ImageModelCapabilities {
	switch ImageModelFamily(model) {
	case ImageFamilyGPT:
		sizes := gptImageClassicSizes
		qualities := gptImageQualities
		maxN := GPTImageMaxN
		if isFlexibleGPTImageModel(model) {
			sizes = gptImage2Sizes
		}
		if IsGPTImage25Model(model) {
			// https://www.rolldek.com/docs/img25.md: native (non-official)
			// groups accept these fixed sizes and one image per request.
			sizes = []string{
				"1536x512", "1344x576", "1280x720", "1152x768", "1024x768", "1024x1024", "768x1024", "768x1152", "720x1280", "512x1536",
				"3072x1024", "2688x1152", "2048x1152", "2304x1536", "2048x1536", "2048x2048", "1536x2048", "1536x2304", "1152x2048", "1024x3072",
				"3840x1280", "3840x1648", "3840x2160", "3520x2352", "3312x2480", "2880x2880", "2480x3312", "2352x3520", "2160x3840", "1280x3840",
			}
			qualities = []string{"auto", "low", "medium", "high", "xhigh", "max"}
			maxN = 1
		}
		return &dto.ImageModelCapabilities{
			Family:             ImageFamilyGPT,
			Modes:              []string{"generate", "edit"},
			MaxReferenceImages: GPTImageMaxReferenceImages,
			SizeMode:           "pixels",
			Sizes:              append([]string{}, sizes...),
			AspectRatios:       []string{},
			Resolutions:        []string{},
			Qualities:          append([]string{}, qualities...),
			MaxN:               maxN,
			SupportsMask:       true,
			Backgrounds:        append([]string{}, gptImageBackgrounds...),
			OutputFormats:      append([]string{}, gptImageFormats...),
			Moderation:         append([]string{}, gptImageModeration...),
			Defaults:           dto.ImageModelDefaults{Size: "1024x1024", Quality: "auto", Background: "auto", OutputFormat: "png"},
		}
	case ImageFamilyXAI:
		return &dto.ImageModelCapabilities{
			Family:             ImageFamilyXAI,
			Modes:              []string{"generate", "edit"},
			MaxReferenceImages: XAIImageMaxReferenceImages,
			SizeMode:           "aspect",
			Sizes:              []string{},
			AspectRatios:       append([]string{}, xaiImageAspectRatios...),
			Resolutions:        append([]string{}, xaiImageResolutions...),
			Qualities:          append([]string{}, xaiImageQualities...),
			MaxN:               XAIImageMaxN,
			Backgrounds:        []string{},
			OutputFormats:      []string{},
			Moderation:         []string{},
			Defaults:           dto.ImageModelDefaults{AspectRatio: "auto", Resolution: "1k", Quality: "auto"},
		}
	case ImageFamilyGemini:
		resolutions := geminiImageResolutions(model)
		defaults := dto.ImageModelDefaults{AspectRatio: "1:1"}
		if len(resolutions) > 0 {
			defaults.Resolution = resolutions[0]
		}
		return &dto.ImageModelCapabilities{
			Family:             ImageFamilyGemini,
			Modes:              []string{"generate", "edit"},
			MaxReferenceImages: GeminiImageMaxReferenceImages,
			SizeMode:           "aspect",
			Sizes:              []string{},
			AspectRatios:       append([]string{}, geminiImageAspectRatios...),
			Resolutions:        resolutions,
			Qualities:          []string{},
			MaxN:               GeminiImageMaxN,
			Backgrounds:        []string{},
			OutputFormats:      []string{},
			Moderation:         []string{},
			Defaults:           defaults,
		}
	}
	return nil
}

// canonicalOption returns the allow-list spelling of value (case-insensitive).
func canonicalOption(value string, allowed []string) (string, bool) {
	for _, option := range allowed {
		if strings.EqualFold(option, value) {
			return option, true
		}
	}
	return "", false
}

func rawJSONString(raw []byte) (string, bool) {
	if len(raw) == 0 {
		return "", false
	}
	var value string
	if err := common.Unmarshal(raw, &value); err != nil {
		return "", false
	}
	return strings.TrimSpace(value), true
}

// validGPTImage2Size enforces the gpt-image-2 custom size rules: WxH multiples
// of 16, edges ≤ 3840, aspect ratio within 3:1, 655,360–8,294,400 pixels.
func validGPTImage2Size(size string) bool {
	if size == "auto" {
		return true
	}
	parts := strings.Split(size, "x")
	if len(parts) != 2 {
		return false
	}
	width, errW := strconv.Atoi(parts[0])
	height, errH := strconv.Atoi(parts[1])
	if errW != nil || errH != nil || width <= 0 || height <= 0 {
		return false
	}
	if width%16 != 0 || height%16 != 0 || width > gptImageMaxEdge || height > gptImageMaxEdge {
		return false
	}
	if width > height*gptImageMaxEdgeRatio || height > width*gptImageMaxEdgeRatio {
		return false
	}
	pixels := width * height
	return pixels >= gptImageMinPixels && pixels <= gptImageMaxPixels
}

// ValidateImageRequestOptions enforces the per-family contract of an image
// request and canonicalizes aspect_ratio / resolution spelling in place.
// referenceCount is the number of source images; hasMask reports a mask.
// Unmodeled models only get the generic checks done elsewhere.
func ValidateImageRequestOptions(request *dto.ImageRequest, referenceCount int, hasMask bool) error {
	if request == nil {
		return errors.New("image request is required")
	}
	request.AspectRatio = strings.TrimSpace(request.AspectRatio)
	request.Resolution = strings.TrimSpace(request.Resolution)
	capabilities := DefaultImageCapabilities(request.Model)
	if capabilities == nil {
		return nil
	}
	n := uint(1)
	if request.N != nil && *request.N > 0 {
		n = *request.N
	}
	if n > uint(capabilities.MaxN) {
		return fmt.Errorf("n must be an integer between 1 and %d for %s", capabilities.MaxN, request.Model)
	}
	if referenceCount > capabilities.MaxReferenceImages {
		return fmt.Errorf("%s accepts at most %d reference images", request.Model, capabilities.MaxReferenceImages)
	}
	if (capabilities.Family != ImageFamilyGPT || IsGPTImage25Model(request.Model)) && request.Stream != nil && *request.Stream {
		return fmt.Errorf("stream is not supported for %s", request.Model)
	}
	if hasMask && !capabilities.SupportsMask {
		return fmt.Errorf("mask is not supported for %s", request.Model)
	}
	if IsGPTImage25Model(request.Model) {
		if request.Size != "" && !common.StringsContains(capabilities.Sizes, request.Size) {
			return fmt.Errorf("size must be one of %s for %s", strings.Join(capabilities.Sizes, ", "), request.Model)
		}
		if request.Quality != "" && !common.StringsContains(capabilities.Qualities, request.Quality) {
			return fmt.Errorf("quality must be one of %s for %s", strings.Join(capabilities.Qualities, ", "), request.Model)
		}
	}

	if capabilities.SizeMode == "pixels" {
		if request.AspectRatio != "" || request.Resolution != "" {
			return fmt.Errorf("%s uses size (WxH) instead of aspect_ratio/resolution", request.Model)
		}
		if isFlexibleGPTImageModel(request.Model) && request.Size != "" && !validGPTImage2Size(request.Size) {
			return fmt.Errorf("size must be auto or WIDTHxHEIGHT with multiples of 16, edges up to %d px, ratio within 3:1 and %d–%d pixels", gptImageMaxEdge, gptImageMinPixels, gptImageMaxPixels)
		}
		background, hasBackground := rawJSONString(request.Background)
		if hasBackground && background != "" && !common.StringsContains(capabilities.Backgrounds, background) {
			return fmt.Errorf("background must be one of %s", strings.Join(capabilities.Backgrounds, ", "))
		}
		format, hasFormat := rawJSONString(request.OutputFormat)
		if hasFormat && format != "" && !common.StringsContains(capabilities.OutputFormats, format) {
			return fmt.Errorf("output_format must be one of %s", strings.Join(capabilities.OutputFormats, ", "))
		}
		if background == "transparent" && format == "jpeg" {
			return errors.New("transparent background requires output_format png or webp")
		}
		moderation, hasModeration := rawJSONString(request.Moderation)
		if hasModeration && moderation != "" && !common.StringsContains(capabilities.Moderation, moderation) {
			return fmt.Errorf("moderation must be one of %s", strings.Join(capabilities.Moderation, ", "))
		}
		return nil
	}

	if request.AspectRatio != "" {
		ratio, ok := canonicalOption(request.AspectRatio, capabilities.AspectRatios)
		if !ok {
			return fmt.Errorf("aspect_ratio must be one of %s for %s", strings.Join(capabilities.AspectRatios, ", "), request.Model)
		}
		request.AspectRatio = ratio
	}
	if request.Resolution != "" {
		resolution, ok := canonicalOption(request.Resolution, capabilities.Resolutions)
		if !ok {
			if len(capabilities.Resolutions) == 0 {
				return fmt.Errorf("resolution is not supported for %s", request.Model)
			}
			return fmt.Errorf("resolution must be one of %s for %s", strings.Join(capabilities.Resolutions, ", "), request.Model)
		}
		request.Resolution = resolution
	}
	return nil
}

// AspectRatioFromImageSize maps an OpenAI WxH size onto a reduced aspect
// ratio ("1536x1024" → "3:2"). It returns "" for auto or malformed sizes.
func AspectRatioFromImageSize(size string) string {
	parts := strings.Split(strings.ToLower(strings.TrimSpace(size)), "x")
	if len(parts) != 2 {
		return ""
	}
	width, errW := strconv.Atoi(parts[0])
	height, errH := strconv.Atoi(parts[1])
	if errW != nil || errH != nil || width <= 0 || height <= 0 {
		return ""
	}
	a, b := width, height
	for b != 0 {
		a, b = b, a%b
	}
	return fmt.Sprintf("%d:%d", width/a, height/a)
}

// GeminiImageOutputTokens is the output-token cost Google bills for one
// generated image at the requested imageSize. It derives from the published
// per-image prices (ai.google.dev/gemini-api/docs/pricing): Flash $0.067 (1K),
// $0.101 (2K), $0.151 (4K) at $60/M; Pro $0.134 (1K/2K), $0.24 (4K) at $120/M.
// OpenAI-compatible proxies often under-report image tokens, so settlement
// uses this as a floor.
func GeminiImageOutputTokens(model, resolution string) int {
	bare := BareImageModel(model)
	resolution = strings.ToUpper(strings.TrimSpace(resolution))
	pro := strings.Contains(bare, "-pro-") || strings.HasSuffix(bare, "-pro") || strings.HasPrefix(bare, "nano-banana-pro")
	switch {
	case resolution == "4K" && pro:
		return 2000
	case resolution == "4K":
		return 2520
	case resolution == "2K" && !pro:
		return 1680
	}
	return 1120
}
