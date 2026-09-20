package common

import (
	"strings"
)

const (
	GrokImagineVideoModel     = "grok-imagine-video"
	GrokImagineVideo15Model   = "grok-imagine-video-1.5"
	GrokImagineDefaultSize    = "1280x720"
	GrokImagineDefaultSeconds = 5
)

// IsGrokImagineVideoModel reports whether name is an xAI Imagine video task
// model. ModelPrice for these aliases is the 480p-per-second base; duration
// and resolution are applied as OtherRatios.
func IsGrokImagineVideoModel(name string) bool {
	return strings.HasPrefix(strings.ToLower(strings.TrimSpace(name)), "grok-imagine-video")
}

// GrokImagineResolutionFromSize maps an OpenAI-style WxH size onto the xAI
// Imagine resolution tier. Empty size uses the playground/API default 720p.
func GrokImagineResolutionFromSize(size string) string {
	switch strings.ToLower(strings.TrimSpace(size)) {
	case "", GrokImagineDefaultSize, "720x1280":
		return "720p"
	case "1920x1080", "1080x1920":
		return "1080p"
	default:
		return ""
	}
}

// GrokImagineResolutionRatio is the OtherRatio that scales the 480p/sec
// ModelPrice. grok-imagine-video-1.5: 720p=1.75×, 1080p=3.125×.
// grok-imagine-video: 720p=1.4×. Unknown resolutions keep the 480p base (1).
func GrokImagineResolutionRatio(modelName, resolution string) float64 {
	name := strings.ToLower(strings.TrimSpace(modelName))
	tier := strings.ToLower(strings.TrimSpace(resolution))
	if name == GrokImagineVideo15Model || strings.HasPrefix(name, GrokImagineVideo15Model+"-") {
		switch tier {
		case "720p":
			return 1.75
		case "1080p":
			return 3.125
		default:
			return 1
		}
	}
	if strings.HasPrefix(name, GrokImagineVideoModel) && tier == "720p" {
		return 1.4
	}
	return 1
}
