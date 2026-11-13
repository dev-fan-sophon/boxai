package sora

import (
	"fmt"
	"math"
	"net/http"
	"net/url"
	"slices"
	"strconv"
	"strings"

	"github.com/dev-fan-sophon/boxai/constant"
	"github.com/dev-fan-sophon/boxai/dto"
	relaycommon "github.com/dev-fan-sophon/boxai/relay/common"
	"github.com/dev-fan-sophon/boxai/service"
	"github.com/gin-gonic/gin"
)

func isWanModel(name string) bool {
	return slices.Contains([]string{"wan-3.0-video", "wan-3.0-video-prime", "wan3.0-video-1080p", "wan3.0-video-prime-1080p", "wan3.0-video-prime-720p", "wan3.0-video-nsfw"}, name)
}

type wanRequest struct {
	Body    map[string]interface{}
	Request relaycommon.TaskSubmitReq
	Ratios  map[string]float64
}

// validateWanRequest freezes the same normalized options for transport and billing.
func (a *TaskAdaptor) validateWanRequest(c *gin.Context, info *relaycommon.RelayInfo, name string) *dto.TaskError {
	body, err := a.passthroughJSONBody(c)
	if err != nil {
		return service.TaskErrorWrapperLocal(err, "invalid_request", http.StatusBadRequest)
	}
	// Wan's object-form references cannot use the generic []string decoder.
	// Resolve the same authenticated upload handles before freezing this body.
	for _, field := range []string{"first_frame", "last_frame", "image", "input_reference"} {
		if handle := bodyString(body, field); service.IsFileReference(handle) {
			resolved, err := service.ResolveFileReference(c.GetInt("id"), handle)
			if err != nil {
				return service.TaskErrorWrapperLocal(err, "invalid_request", http.StatusBadRequest)
			}
			body[field] = resolved
		}
	}
	for _, field := range []string{"images", "reference_images", "reference_videos", "reference_audios"} {
		items, _ := body[field].([]interface{})
		for i, item := range items {
			handle, _ := item.(string)
			object, isObject := item.(map[string]interface{})
			if isObject {
				handle = bodyString(object, "url")
			}
			if !service.IsFileReference(handle) {
				continue
			}
			resolved, err := service.ResolveFileReference(c.GetInt("id"), handle)
			if err != nil {
				return service.TaskErrorWrapperLocal(err, "invalid_request", http.StatusBadRequest)
			}
			if isObject {
				object["url"] = resolved
			} else {
				items[i] = resolved
			}
		}
	}
	request, err := normalizeWanRequest(body, name)
	if err != nil {
		return service.TaskErrorWrapperLocal(err, "invalid_request", http.StatusBadRequest)
	}
	c.Set("wan_request", request)
	c.Set("task_request", request.Request)
	info.Action = constant.TaskActionTextGenerate
	if request.Request.HasImage() || request.Request.FirstFrame != "" || len(request.Request.ReferenceImages)+len(request.Request.ReferenceVideos)+len(request.Request.ReferenceAudios) > 0 {
		info.Action = constant.TaskActionGenerate
	}
	return nil
}

func normalizeWanRequest(body map[string]interface{}, name string) (*wanRequest, error) {
	if !isWanModel(name) {
		return nil, fmt.Errorf("unsupported Wan model")
	}
	for key := range body {
		if !slices.Contains([]string{"model", "group", "prompt", "mode", "seconds", "duration", "size", "resolution", "aspect_ratio", "ratio", "metadata", "first_frame", "last_frame", "image", "images", "input_reference", "reference_images", "reference_videos", "reference_audios"}, key) {
			return nil, fmt.Errorf("field %q is unavailable for Wan", key)
		}
	}
	prompt := bodyString(body, "prompt")
	if prompt == "" {
		return nil, fmt.Errorf("prompt is required")
	}
	fixedResolution := ""
	if strings.HasSuffix(name, "1080p") {
		fixedResolution = "1080p"
	} else if strings.HasSuffix(name, "720p") {
		fixedResolution = "720p"
	}
	minimum, defaultSeconds := 4, 4
	if fixedResolution != "" {
		minimum, defaultSeconds = 15, 15
	}
	if name == "wan3.0-video-nsfw" {
		minimum, defaultSeconds = 2, 2
	}
	seconds := 0
	for _, field := range []string{"seconds", "duration"} {
		value, exists := body[field]
		if !exists {
			continue
		}
		var parsed int
		switch v := value.(type) {
		case string:
			n, err := strconv.Atoi(v)
			if err != nil {
				return nil, fmt.Errorf("%s must be an integer", field)
			}
			parsed = n
		case float64:
			if math.IsNaN(v) || math.IsInf(v, 0) || v != math.Trunc(v) || v < 1 || v > relaycommon.MaxTaskDurationSeconds {
				return nil, fmt.Errorf("invalid %s", field)
			}
			parsed = int(v)
		default:
			return nil, fmt.Errorf("%s must be an integer", field)
		}
		if parsed < minimum || parsed > 30 || (fixedResolution != "" && parsed != 15 && parsed != 30) {
			return nil, fmt.Errorf("duration is unavailable for %s", name)
		}
		if seconds != 0 && seconds != parsed {
			return nil, fmt.Errorf("conflicting duration aliases")
		}
		seconds = parsed
	}
	if seconds == 0 {
		seconds = defaultSeconds
	}
	resolution, ratio := "", ""
	metadata := map[string]interface{}{}
	if value, exists := body["metadata"]; exists {
		var ok bool
		metadata, ok = value.(map[string]interface{})
		if !ok {
			return nil, fmt.Errorf("metadata must be an object")
		}
		for key := range metadata {
			if key != "resolution" && key != "ratio" {
				return nil, fmt.Errorf("metadata field %q is unavailable for Wan", key)
			}
		}
	}
	for _, source := range []map[string]interface{}{body, metadata} {
		for _, key := range []string{"size", "resolution"} {
			value, exists := source[key]
			if !exists {
				continue
			}
			text, ok := value.(string)
			if !ok || text == "" {
				return nil, fmt.Errorf("%s must be a nonempty string", key)
			}
			tier := strings.ToLower(strings.TrimSpace(text))
			if !slices.Contains([]string{"480p", "720p", "1080p"}, tier) {
				var sizeRatio string
				tier, sizeRatio = relaycommon.GrokImagineDimensionsFromSize(text)
				if tier == "" {
					return nil, fmt.Errorf("unsupported video size")
				}
				if ratio != "" && ratio != sizeRatio {
					return nil, fmt.Errorf("conflicting aspect ratios")
				}
				ratio = sizeRatio
			}
			if resolution != "" && resolution != tier {
				return nil, fmt.Errorf("conflicting resolutions")
			}
			resolution = tier
		}
		for _, key := range []string{"aspect_ratio", "ratio"} {
			value, exists := source[key]
			if !exists {
				continue
			}
			text, ok := value.(string)
			if !ok || !slices.Contains([]string{"16:9", "9:16", "1:1", "adaptive"}, text) {
				return nil, fmt.Errorf("unsupported aspect ratio")
			}
			if ratio != "" && ratio != text {
				return nil, fmt.Errorf("conflicting aspect ratios")
			}
			ratio = text
		}
	}
	if resolution == "" {
		resolution = fixedResolution
	}
	if resolution == "" {
		resolution = "720p"
		if name == "wan3.0-video-nsfw" {
			resolution = "480p"
		}
	}
	if fixedResolution != "" && resolution != fixedResolution {
		return nil, fmt.Errorf("model fixes resolution at %s", fixedResolution)
	}
	if resolution == "480p" && name != "wan3.0-video-nsfw" {
		return nil, fmt.Errorf("480p is unavailable for this model")
	}
	if ratio == "" {
		ratio = "16:9"
	}
	if name == "wan3.0-video-nsfw" && ratio != "16:9" {
		return nil, fmt.Errorf("NSFW currently supports only verified 16:9 output")
	}
	request := relaycommon.TaskSubmitReq{Model: name, Prompt: prompt, Seconds: strconv.Itoa(seconds), Duration: seconds, Metadata: map[string]interface{}{"resolution": resolution, "ratio": ratio}}
	first, last := "", ""
	for _, key := range []string{"first_frame", "image", "input_reference"} {
		value := bodyString(body, key)
		if value == "" {
			continue
		}
		if first != "" && first != value {
			return nil, fmt.Errorf("conflicting first frames")
		}
		first = value
	}
	last = bodyString(body, "last_frame")
	for _, kind := range []string{"images", "reference_images", "reference_videos", "reference_audios"} {
		raw, exists := body[kind]
		if !exists {
			continue
		}
		items, ok := raw.([]interface{})
		if !ok {
			return nil, fmt.Errorf("%s must be an array", kind)
		}
		for _, item := range items {
			mediaURL, role := "", "reference_image"
			switch value := item.(type) {
			case string:
				mediaURL = value
			case map[string]interface{}:
				mediaURL = bodyString(value, "url")
				if r := bodyString(value, "role"); r != "" {
					role = r
				}
			default:
				return nil, fmt.Errorf("invalid %s entry", kind)
			}
			parsed, err := url.Parse(mediaURL)
			if err != nil || parsed.Scheme != "https" || parsed.Host == "" || parsed.User != nil {
				return nil, fmt.Errorf("reference media must use public HTTPS URLs")
			}
			switch kind {
			case "images", "reference_images":
				switch role {
				case "first_frame":
					if first != "" && first != mediaURL {
						return nil, fmt.Errorf("only one first frame is allowed")
					}
					first = mediaURL
				case "last_frame":
					if last != "" && last != mediaURL {
						return nil, fmt.Errorf("only one last frame is allowed")
					}
					last = mediaURL
				case "reference_image":
					if kind == "images" && first != "" && (mediaURL == first || mediaURL == last) {
						continue
					}
					if !slices.Contains(request.ReferenceImages, mediaURL) {
						request.ReferenceImages = append(request.ReferenceImages, mediaURL)
					}
				default:
					return nil, fmt.Errorf("unsupported image role")
				}
			case "reference_videos":
				if !slices.Contains(request.ReferenceVideos, mediaURL) {
					request.ReferenceVideos = append(request.ReferenceVideos, mediaURL)
				}
			case "reference_audios":
				if !slices.Contains(request.ReferenceAudios, mediaURL) {
					request.ReferenceAudios = append(request.ReferenceAudios, mediaURL)
				}
			}
		}
	}
	// Live Rolldek NSFW requests accept both reference formats but bill only
	// output seconds, unlike their documented input+output contract. Do not
	// advertise or charge for an unverified reference-video operation.
	if name == "wan3.0-video-nsfw" && len(request.ReferenceVideos) > 0 {
		return nil, fmt.Errorf("NSFW reference-video mode is not available")
	}
	if len(request.ReferenceImages) > 10 || len(request.ReferenceVideos) > 5 || len(request.ReferenceAudios) > 5 {
		return nil, fmt.Errorf("Wan allows at most 10 images, 5 videos and 5 audios")
	}
	if last != "" && first == "" {
		return nil, fmt.Errorf("last frame requires a first frame")
	}
	if first != "" && len(request.ReferenceImages)+len(request.ReferenceVideos)+len(request.ReferenceAudios) > 0 {
		return nil, fmt.Errorf("frames cannot be combined with reference media")
	}
	images := make([]map[string]string, 0, len(request.ReferenceImages)+2)
	for _, image := range request.ReferenceImages {
		images = append(images, map[string]string{"url": image})
	}
	if first != "" {
		for _, image := range []string{first, last} {
			if image == "" {
				continue
			}
			parsed, err := url.Parse(image)
			if err != nil || parsed.Scheme != "https" || parsed.Host == "" || parsed.User != nil {
				return nil, fmt.Errorf("frames must use public HTTPS URLs")
			}
		}
		request.FirstFrame, request.InputReference, request.LastFrame = first, first, last
		request.Images = []string{first}
		images = append(images, map[string]string{"url": first, "role": "first_frame"})
		if last != "" {
			request.Images = append(request.Images, last)
			images = append(images, map[string]string{"url": last, "role": "last_frame"})
		}
	}
	// Rebuild only the documented fields so alternate passthrough fields cannot
	// change the media or quantity after validation and billing.
	normalized := map[string]interface{}{"model": name, "prompt": prompt, "seconds": request.Seconds, "size": strings.ToUpper(resolution), "aspect_ratio": ratio}
	if len(images) > 0 {
		normalized["reference_images"] = images
	}
	if len(request.ReferenceVideos) > 0 {
		normalized["reference_videos"] = request.ReferenceVideos
	}
	if len(request.ReferenceAudios) > 0 {
		normalized["reference_audios"] = request.ReferenceAudios
	}
	resolutionRatio := relaycommon.WanResolutionRatio(name, resolution)
	return &wanRequest{Body: normalized, Request: request, Ratios: map[string]float64{"seconds": float64(seconds), "resolution": resolutionRatio}}, nil
}
