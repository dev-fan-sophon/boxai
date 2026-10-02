package common

import (
	"math"
	"strconv"
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
	resolution, _ := GrokImagineDimensionsFromSize(size)
	return resolution
}

// grokImagineAspectRatios are the ratios documented for xAI video generation.
var grokImagineAspectRatios = []struct {
	label string
	value float64
}{
	{"16:9", 16.0 / 9.0}, {"9:16", 9.0 / 16.0}, {"1:1", 1}, {"4:3", 4.0 / 3.0},
	{"3:4", 3.0 / 4.0}, {"3:2", 3.0 / 2.0}, {"2:3", 2.0 / 3.0},
}

// GrokImagineDimensionsFromSize maps a WxH size onto the xAI resolution tier
// (shorter side 480/720/1080) and aspect ratio (within 2%). Empty size uses
// the 1280x720 default. Unsupported sizes return empty strings.
func GrokImagineDimensionsFromSize(size string) (resolution string, ratio string) {
	size = strings.ToLower(strings.TrimSpace(size))
	if size == "" {
		size = GrokImagineDefaultSize
	}
	widthText, heightText, found := strings.Cut(size, "x")
	width, errW := strconv.Atoi(strings.TrimSpace(widthText))
	height, errH := strconv.Atoi(strings.TrimSpace(heightText))
	if !found || errW != nil || errH != nil || width <= 0 || height <= 0 {
		return "", ""
	}
	switch min(width, height) {
	case 480:
		resolution = "480p"
	case 720:
		resolution = "720p"
	case 1080:
		resolution = "1080p"
	default:
		return "", ""
	}
	aspect := float64(width) / float64(height)
	for _, candidate := range grokImagineAspectRatios {
		if math.Abs(aspect/candidate.value-1) <= 0.02 {
			return resolution, candidate.label
		}
	}
	return "", ""
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
