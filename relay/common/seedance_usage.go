package common

import "strings"

// Ark bills native Seedance video in tokens: output pixels per frame ×
// frames / 1024, with frames = 24 fps × seconds + 1. Production usage
// matches this exactly for Seedance 2.0 720p and Seedance 2.5 1080p
// (e.g. 1280×720 × 121 frames / 1024 = 108900 ≈ 108899 billed for 5 s).
const (
	SeedanceFramesPerSecond = 24
	// SeedanceReferenceVideoMaxSeconds is Ark's total reference-video
	// duration limit. A submission cannot know the clips' real length, so
	// estimates assume the limit; settlement bills the reported usage.
	SeedanceReferenceVideoMaxSeconds = 15
	// TaskUsagePreChargeMargin is the headroom a usage-estimated task
	// reserves above its estimate. The Seedance formula matches billed usage
	// within 0.01% on 2.0 and on 2.5 1080p (2.5 720p bills ~4% below it).
	TaskUsagePreChargeMargin = 1.05
	// SeedanceOmittedDurationSeconds is Ark's Seedance 2.x default duration,
	// which applies when neither duration nor frames is sent upstream.
	SeedanceOmittedDurationSeconds = 5
)

// seedanceFramePixels lists Ark's Seedance output frame sizes (width ×
// height) per resolution tier and aspect ratio. 4k doubles each 1080p side.
var seedanceFramePixels = map[string]map[string]int{
	"480p": {
		"16:9": 864 * 480, "4:3": 736 * 544, "1:1": 640 * 640,
		"3:4": 544 * 736, "9:16": 480 * 864, "21:9": 960 * 416,
	},
	"720p": {
		"16:9": 1280 * 720, "4:3": 1112 * 834, "1:1": 960 * 960,
		"3:4": 834 * 1112, "9:16": 720 * 1280, "21:9": 1470 * 630,
	},
	"1080p": {
		"16:9": 1920 * 1080, "4:3": 1664 * 1248, "1:1": 1440 * 1440,
		"3:4": 1248 * 1664, "9:16": 1080 * 1920, "21:9": 2206 * 946,
	},
	"4k": {
		"16:9": 3840 * 2160, "4:3": 3328 * 2496, "1:1": 2880 * 2880,
		"3:4": 2496 * 3328, "9:16": 2160 * 3840, "21:9": 4412 * 1892,
	},
}

// EstimateSeedanceVideoTokens predicts the usage Ark reports for one
// Seedance generation. Unknown tiers fall back to 720p; adaptive or unknown
// aspect ratios take the tier's largest frame so the estimate never assumes
// a cheaper shape than Ark may pick. Reference videos add their frames at
// the output size (Ark reports output + input frames), assuming the
// documented total-duration limit.
func EstimateSeedanceVideoTokens(resolution, ratio string, seconds int, hasVideoInput bool) int {
	sizes, ok := seedanceFramePixels[strings.ToLower(strings.TrimSpace(resolution))]
	if !ok {
		sizes = seedanceFramePixels["720p"]
	}
	pixels, ok := sizes[strings.TrimSpace(ratio)]
	if !ok {
		for _, candidate := range sizes {
			pixels = max(pixels, candidate)
		}
	}
	seconds = min(max(seconds, 1), MaxTaskDurationSeconds)
	frames := int64(seconds*SeedanceFramesPerSecond + 1)
	if hasVideoInput {
		frames += SeedanceReferenceVideoMaxSeconds*SeedanceFramesPerSecond + 1
	}
	return int(int64(pixels) * frames / 1024)
}

// seedanceVideoPriceKey selects a price row: output tier (neither flag set
// is the 480p/720p base tier) and whether the request carries video input.
type seedanceVideoPriceKey struct {
	is1080p  bool
	is4k     bool
	hasVideo bool
}

// seedanceVideoPriceTable lists Ark unit prices (CNY per million tokens) by
// upstream model. The zero key {480p/720p, no video} is the base price the
// configured ModelRatio represents; billing uses price/base as OtherRatio.
var seedanceVideoPriceTable = map[string]map[seedanceVideoPriceKey]float64{
	"doubao-seedance-2-0-mini-260615": {
		{hasVideo: false}:                23.0,
		{hasVideo: true}:                 14.0,
		{is1080p: true, hasVideo: false}: 23.0,
		{is1080p: true, hasVideo: true}:  14.0,
	},
	"doubao-seedance-2-5-260628": {
		{hasVideo: false}:                70.0,
		{hasVideo: true}:                 42.0,
		{is1080p: true, hasVideo: false}: 77.0,
		{is1080p: true, hasVideo: true}:  46.0,
	},
	"doubao-seedance-2-0-260128": {
		{hasVideo: false}:                46.0,
		{hasVideo: true}:                 28.0,
		{is1080p: true, hasVideo: false}: 51.0,
		{is1080p: true, hasVideo: true}:  31.0,
		{is4k: true, hasVideo: false}:    26.0,
		{is4k: true, hasVideo: true}:     16.0,
	},
	"doubao-seedance-2-0-fast-260128": {
		{hasVideo: false}: 37.0,
		{hasVideo: true}:  22.0,
	},
}

// SeedanceVideoInputRatio returns the price multiplier of an output tier and
// video-input combination relative to the model's base price. The second
// result reports whether the upstream model has a price table; callers may
// skip a 1.0 ratio.
func SeedanceVideoInputRatio(upstreamModel, resolution string, hasVideo bool) (float64, bool) {
	prices, ok := seedanceVideoPriceTable[upstreamModel]
	base := prices[seedanceVideoPriceKey{}]
	if !ok || base <= 0 {
		return 0, false
	}
	res := strings.ToLower(strings.TrimSpace(resolution))
	price, ok := prices[seedanceVideoPriceKey{is1080p: res == "1080p", is4k: res == "4k", hasVideo: hasVideo}]
	if !ok {
		// Preserve the input-video tier when no resolution-specific price exists.
		price = prices[seedanceVideoPriceKey{hasVideo: hasVideo}]
		if price <= 0 {
			price = base
		}
	}
	return price / base, true
}

// SeedancePriceModel names the Ark model whose price table bills a public
// Seedance alias. Estimates run before a channel (and its model mapping) is
// chosen, so they resolve the family from the name; relay billing keeps
// using the mapped upstream id.
func SeedancePriceModel(name string) string {
	lower := strings.ToLower(strings.TrimSpace(name))
	if _, ok := seedanceVideoPriceTable[lower]; ok {
		return lower
	}
	switch {
	case !IsSeedanceModel(lower):
		return ""
	case strings.Contains(lower, "2-5") || strings.Contains(lower, "2.5"):
		return "doubao-seedance-2-5-260628"
	case strings.Contains(lower, "mini"):
		return "doubao-seedance-2-0-mini-260615"
	case strings.Contains(lower, "fast"):
		return "doubao-seedance-2-0-fast-260128"
	case strings.Contains(lower, "2-0") || strings.Contains(lower, "2.0"):
		return "doubao-seedance-2-0-260128"
	default:
		return ""
	}
}
