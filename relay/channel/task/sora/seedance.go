package sora

import (
	"fmt"
	"regexp"
	"slices"
	"strconv"
	"strings"

	relaycommon "github.com/dev-fan-sophon/boxai/relay/common"
)

// Seedance models reached through an OpenAI-video passthrough channel are
// served by aggregator gateways that translate `/v1/videos` into the
// Volcengine contents API. Those gateways ignore the OpenAI-style top-level
// `size`/`duration`/`first_frame`/`last_frame` fields and only honor the
// string `seconds` plus `metadata.{resolution,ratio,generate_audio,content}`.
// The helpers below rewrite the passthrough body so BoxAI clients can keep
// using one uniform OpenAI-style request for every video channel.

var seedance2Pattern = regexp.MustCompile(`(?i)(?:seedance-2[.-]|cdance2[.-])`)
var seedance25Pattern = regexp.MustCompile(`(?i)(?:seedance-2[.-]5|cdance2[.-]5)`)

func isSeedanceModel(name string) bool {
	return relaycommon.IsSeedanceModel(name)
}

// seedanceReferenceLimits returns the Ark multimodal reference limits
// (images, videos, audios): 30/10/10 on 2.5, 9/3/3 on 2.0, fast and mini.
func seedanceReferenceLimits(name string) (int, int, int) {
	if seedance25Pattern.MatchString(name) {
		return 30, 10, 10
	}
	return 9, 3, 3
}

func seedanceOutputFromSize(size string) (resolution string, ratio string) {
	return relaycommon.SeedanceOutputFromSize(size)
}

func seedanceResolutionRatio(resolution string) float64 {
	return relaycommon.SeedanceResolutionRatio(resolution)
}

func bodyString(body map[string]interface{}, key string) string {
	value, ok := body[key].(string)
	if !ok {
		return ""
	}
	return strings.TrimSpace(value)
}

func bodyStringSlice(body map[string]interface{}, key string) []string {
	raw, ok := body[key].([]interface{})
	if !ok {
		return nil
	}
	items := make([]string, 0, len(raw))
	for _, item := range raw {
		value, ok := item.(string)
		if !ok {
			continue
		}
		value = strings.TrimSpace(value)
		if value != "" {
			items = append(items, value)
		}
	}
	return items
}

func seedanceImageContent(url, role string) map[string]interface{} {
	return seedanceMediaContent("image_url", url, role)
}

// seedanceMediaContent builds one Ark content item of mediaType
// (image_url / video_url / audio_url).
func seedanceMediaContent(mediaType, url, role string) map[string]interface{} {
	item := map[string]interface{}{
		"type":    mediaType,
		mediaType: map[string]interface{}{"url": url},
	}
	if role != "" {
		item["role"] = role
	}
	return item
}

// normalizeSeedancePassthroughBody rewrites an OpenAI-style video request into
// the shape aggregator gateways forward to Volcengine for Seedance models:
//
//   - `seconds` is filled from the integer `duration` when absent;
//   - `metadata.resolution` / `metadata.ratio` are derived from `size` when absent;
//   - `first_frame` / `last_frame` / `images` / `image` / `input_reference` become
//     `metadata.content` entries with Volcengine roles when the caller did not
//     already provide `metadata.content`;
//   - the top-level image aliases are removed once `metadata.content` carries
//     the images, because gateways prepend `images[]` to `metadata.content` and
//     would otherwise send every image twice.
//
// Reference-image limits and the frames-vs-references exclusivity rule are
// enforced here so invalid requests fail before quota is reserved.
func normalizeSeedancePassthroughBody(body map[string]interface{}, upstreamModel string) error {
	if body == nil {
		return nil
	}
	if bodyString(body, "seconds") == "" {
		if duration, ok := body["duration"].(float64); ok && duration > 0 {
			body["seconds"] = strconv.Itoa(int(duration))
		}
	}

	metadata, _ := body["metadata"].(map[string]interface{})
	if metadata == nil {
		metadata = map[string]interface{}{}
	}
	if resolution, ratio := seedanceOutputFromSize(bodyString(body, "size")); resolution != "" {
		if _, ok := metadata["resolution"].(string); !ok || strings.TrimSpace(metadata["resolution"].(string)) == "" {
			metadata["resolution"] = resolution
		}
		if _, ok := metadata["ratio"].(string); !ok || strings.TrimSpace(metadata["ratio"].(string)) == "" {
			metadata["ratio"] = ratio
		}
	}

	content, _ := metadata["content"].([]interface{})
	if len(content) == 0 {
		firstFrame := bodyString(body, "first_frame")
		if firstFrame == "" {
			firstFrame = bodyString(body, "input_reference")
		}
		if firstFrame == "" {
			firstFrame = bodyString(body, "image")
		}
		lastFrame := bodyString(body, "last_frame")
		references := bodyStringSlice(body, "reference_images")
		for _, image := range bodyStringSlice(body, "images") {
			if image == firstFrame || image == lastFrame || slices.Contains(references, image) {
				continue
			}
			references = append(references, image)
		}
		referenceVideos := bodyStringSlice(body, "reference_videos")
		referenceAudios := bodyStringSlice(body, "reference_audios")
		usesFrames := firstFrame != "" || lastFrame != ""
		if usesFrames && seedance25Pattern.MatchString(upstreamModel) {
			if ratio, _ := metadata["ratio"].(string); strings.TrimSpace(ratio) != "" && ratio != "adaptive" {
				return fmt.Errorf("Seedance 2.5 first/last-frame generation requires adaptive ratio")
			}
		}
		// A lone `images:[x]` on a model without reference-image support is an
		// image-to-video first frame, not a style reference.
		if !usesFrames && len(references) == 1 && !seedance2Pattern.MatchString(upstreamModel) {
			firstFrame = references[0]
			references = nil
			usesFrames = true
		}
		if usesFrames && len(references)+len(referenceVideos)+len(referenceAudios) > 0 {
			return fmt.Errorf("reference media cannot be combined with first/last frames")
		}
		if lastFrame != "" && firstFrame == "" {
			return fmt.Errorf("last_frame requires first_frame")
		}
		if firstFrame != "" {
			role := ""
			if lastFrame != "" {
				role = "first_frame"
			}
			content = append(content, seedanceImageContent(firstFrame, role))
		}
		if lastFrame != "" {
			content = append(content, seedanceImageContent(lastFrame, "last_frame"))
		}
		for _, reference := range references {
			content = append(content, seedanceImageContent(reference, "reference_image"))
		}
		for _, video := range referenceVideos {
			content = append(content, seedanceMediaContent("video_url", video, "reference_video"))
		}
		for _, audio := range referenceAudios {
			content = append(content, seedanceMediaContent("audio_url", audio, "reference_audio"))
		}
	}

	referenceCount, videoCount, audioCount := 0, 0, 0
	for _, item := range content {
		entry, ok := item.(map[string]interface{})
		if !ok {
			continue
		}
		switch {
		case entry["type"] == "image_url" && entry["role"] == "reference_image":
			referenceCount++
		case entry["type"] == "video_url":
			videoCount++
		case entry["type"] == "audio_url":
			audioCount++
		}
	}
	maxImages, maxVideos, maxAudios := seedanceReferenceLimits(upstreamModel)
	if referenceCount > maxImages {
		return fmt.Errorf("this model supports at most %d reference images", maxImages)
	}
	if videoCount > maxVideos {
		return fmt.Errorf("this model supports at most %d reference videos", maxVideos)
	}
	if audioCount > maxAudios {
		return fmt.Errorf("this model supports at most %d reference audios", maxAudios)
	}

	if len(content) > 0 {
		metadata["content"] = content
		for _, alias := range []string{"images", "image", "input_reference", "first_frame", "last_frame", "reference_images", "reference_videos", "reference_audios"} {
			delete(body, alias)
		}
	}
	if len(metadata) > 0 {
		body["metadata"] = metadata
	}
	return nil
}
