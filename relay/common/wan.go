package common

// WanResolutionRatio uses each model's lowest resolution as its base price.
// Keep Studio estimates and actual task charges on the same vendor price tiers.
func WanResolutionRatio(model, resolution string) float64 {
	switch model {
	case "wan3.0-video-nsfw":
		if resolution == "720p" {
			return 2
		}
		if resolution == "1080p" {
			return 4
		}
	case "wan-3.0-video":
		if resolution == "1080p" {
			return 0.42 / 0.32
		}
	case "wan-3.0-video-prime":
		if resolution == "1080p" {
			return 0.47 / 0.38
		}
	}
	return 1
}
