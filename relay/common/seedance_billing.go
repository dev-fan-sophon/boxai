package common

import (
	"math"
	"regexp"
	"strconv"
	"strings"
)

// cdance is the Volcengine edge-gateway prefix for the same Seedance family
// (cdance2.0-0611, cdance2.0-fast-0611, cdance2.0-mini-0611, cdance2.5-0807).
var seedanceModelPattern = regexp.MustCompile(`(?i)(?:seedance|cdance)`)

// SeedanceResolutionRatios scales the per-second ModelPrice (720p, no video
// input) by the relative pixel budget of each output tier. Official Volcengine
// 5s no-input prices for Seedance 2.5 are 3.36 CNY (480p), 7.56 CNY (720p),
// 18.71 CNY (1080p) → 0.444× / 1× / 2.475×. The code keeps 0.45 / 1 / 2.5 so
// existing OtherRatio snapshots stay stable.
var SeedanceResolutionRatios = map[string]float64{
	"480p":  0.45,
	"720p":  1,
	"1080p": 2.5,
}

// SeedanceDefaultDurationSeconds is the OpenAI-video / Volcengine default when
// the client omits duration.
const SeedanceDefaultDurationSeconds = 4

// IsSeedanceModel reports whether name is a Seedance family model, including
// public aliases (dreamina-seedance-2-5), Volcengine upstream ids
// (doubao-seedance-2-0-260128), and edge-gateway ids (cdance2.0-0611).
func IsSeedanceModel(name string) bool {
	return seedanceModelPattern.MatchString(name)
}

// SeedanceResolutionRatio returns the OtherRatio for a resolution label.
// Unknown labels keep the 720p base (1).
func SeedanceResolutionRatio(resolution string) float64 {
	ratio, ok := SeedanceResolutionRatios[strings.ToLower(strings.TrimSpace(resolution))]
	if !ok {
		return 1
	}
	return ratio
}

// SeedanceOutputFromSize maps an OpenAI-style WxH size to the Volcengine
// resolution tier and closest supported aspect ratio. Unknown sizes return
// empty strings so callers can fall back to metadata or defaults.
func SeedanceOutputFromSize(size string) (resolution string, ratio string) {
	parts := strings.Split(strings.ToLower(strings.TrimSpace(size)), "x")
	if len(parts) != 2 {
		return "", ""
	}
	width, errW := strconv.Atoi(strings.TrimSpace(parts[0]))
	height, errH := strconv.Atoi(strings.TrimSpace(parts[1]))
	if errW != nil || errH != nil || width <= 0 || height <= 0 {
		return "", ""
	}
	shorter := math.Min(float64(width), float64(height))
	switch {
	case shorter >= 1000:
		resolution = "1080p"
	case shorter >= 640:
		resolution = "720p"
	default:
		resolution = "480p"
	}
	aspect := float64(width) / float64(height)
	bestDiff := math.Inf(1)
	for _, candidate := range seedanceAspectRatios {
		diff := math.Abs(candidate.value - aspect)
		if diff < bestDiff {
			bestDiff = diff
			ratio = candidate.label
		}
	}
	return resolution, ratio
}

var seedanceAspectRatios = []struct {
	label string
	value float64
}{
	{"16:9", 16.0 / 9.0},
	{"4:3", 4.0 / 3.0},
	{"1:1", 1},
	{"3:4", 3.0 / 4.0},
	{"9:16", 9.0 / 16.0},
	{"21:9", 21.0 / 9.0},
}

// ResolveSeedanceDurationSeconds returns the billed duration, capped because
// it is used as a quota multiplier.
func ResolveSeedanceDurationSeconds(seconds string, duration int) int {
	parsed, _ := strconv.Atoi(strings.TrimSpace(seconds))
	if parsed == 0 {
		parsed = duration
	}
	if parsed <= 0 {
		return SeedanceDefaultDurationSeconds
	}
	if parsed > MaxTaskDurationSeconds {
		return MaxTaskDurationSeconds
	}
	return parsed
}

// ResolveSeedanceResolution prefers explicit metadata, then WxH size, then
// the 720p base the ModelPrice is calibrated on.
func ResolveSeedanceResolution(metadataResolution, size string) string {
	resolution := strings.ToLower(strings.TrimSpace(metadataResolution))
	if _, ok := SeedanceResolutionRatios[resolution]; ok {
		return resolution
	}
	if derived, _ := SeedanceOutputFromSize(size); derived != "" {
		return derived
	}
	return "720p"
}

// SeedanceRequiresPerSecondPrice is true for Seedance video tasks: they must
// bill from ModelPrice (USD/s at 720p) × seconds × resolution, never from
// ModelRatio/2 token fallback.
func SeedanceRequiresPerSecondPrice(name string) bool {
	return IsSeedanceModel(name)
}
