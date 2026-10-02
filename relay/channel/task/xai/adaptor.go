package xai

import (
	"bytes"
	"context"
	"fmt"
	"io"
	"net/http"
	"net/url"
	"slices"
	"strconv"
	"strings"
	"time"

	"github.com/dev-fan-sophon/boxai/common"
	"github.com/dev-fan-sophon/boxai/dto"
	"github.com/dev-fan-sophon/boxai/model"
	"github.com/dev-fan-sophon/boxai/relay/channel"
	taskcommon "github.com/dev-fan-sophon/boxai/relay/channel/task/taskcommon"
	relaycommon "github.com/dev-fan-sophon/boxai/relay/common"
	"github.com/dev-fan-sophon/boxai/service"
	"github.com/dev-fan-sophon/boxai/setting/system_setting"
	"github.com/gin-gonic/gin"
)

const (
	modelImagine     = "grok-imagine-video"
	modelImagine15   = "grok-imagine-video-1.5"
	defaultVideoSize = "1280x720"
)

// maxReferenceImages is the documented reference-to-video limit of
// grok-imagine-video-1.5 (https://x.ai/news/grok-imagine-video-1-5-references).
const maxReferenceImages = 7

// videoRequest follows POST /v1/videos/generations:
// https://docs.x.ai/developers/model-capabilities/video/generation
type videoRequest struct {
	Model           string       `json:"model"`
	Prompt          string       `json:"prompt"`
	Duration        int          `json:"duration"`
	AspectRatio     string       `json:"aspect_ratio"`
	Resolution      string       `json:"resolution"`
	Image           *videoImage  `json:"image,omitempty"`
	LastFrame       *videoImage  `json:"last_frame,omitempty"`
	ReferenceImages []videoImage `json:"reference_images,omitempty"`
	GenerateAudio   *bool        `json:"generate_audio,omitempty"`
}

type videoImage struct {
	URL string `json:"url"`
}

type videoResponse struct {
	RequestID string `json:"request_id,omitempty"`
	Status    string `json:"status,omitempty"`
	Model     string `json:"model,omitempty"`
	Video     *struct {
		URL               string `json:"url"`
		Duration          int    `json:"duration"`
		RespectModeration bool   `json:"respect_moderation"`
	} `json:"video,omitempty"`
	Error *videoError `json:"error,omitempty"`
}

type videoError struct {
	Code    string `json:"code"`
	Message string `json:"message"`
}

type TaskAdaptor struct {
	taskcommon.BaseBilling
	apiKey  string
	baseURL string
}

func (a *TaskAdaptor) Init(info *relaycommon.RelayInfo) {
	a.apiKey, a.baseURL = info.ApiKey, info.ChannelBaseUrl
}

func (a *TaskAdaptor) ValidateRequestAndSetAction(c *gin.Context, info *relaycommon.RelayInfo) *dto.TaskError {
	if taskErr := relaycommon.ValidateMultipartDirect(c, info); taskErr != nil {
		return taskErr
	}
	return a.validateRequest(c, info, false)
}

func (a *TaskAdaptor) ValidateMappedRequest(c *gin.Context, info *relaycommon.RelayInfo) *dto.TaskError {
	return a.validateRequest(c, info, true)
}

func (a *TaskAdaptor) validateRequest(c *gin.Context, info *relaycommon.RelayInfo, requireKnownModel bool) *dto.TaskError {
	req, err := relaycommon.GetTaskRequest(c)
	if err != nil {
		return service.TaskErrorWrapperLocal(err, "invalid_request", http.StatusBadRequest)
	}
	if req.Seconds != "" {
		seconds, err := strconv.Atoi(req.Seconds)
		if err != nil || seconds < 1 || seconds > 15 || (req.Duration != 0 && req.Duration != seconds) {
			return service.TaskErrorWrapperLocal(fmt.Errorf("seconds must be between 1 and 15 and agree with duration"), "invalid_duration", http.StatusBadRequest)
		}
		req.Duration = seconds
		c.Set("task_request", req)
	}
	if req.Duration < 1 || req.Duration > 15 {
		return service.TaskErrorWrapperLocal(fmt.Errorf("duration must be between 1 and 15 seconds"), "invalid_duration", http.StatusBadRequest)
	}
	modelName := req.Model
	if requireKnownModel && info != nil {
		modelName = info.UpstreamModelName
	}
	if requireKnownModel && modelName != modelImagine && modelName != modelImagine15 {
		return service.TaskErrorWrapperLocal(fmt.Errorf("unsupported xAI video model %q", modelName), "unsupported_model", http.StatusBadRequest)
	}
	if _, err := buildVideoRequest(&req, modelName); err != nil {
		return service.TaskErrorWrapperLocal(err, "invalid_request", http.StatusBadRequest)
	}
	return nil
}

func videoDimensions(size string) (string, string, error) {
	if size == "" {
		size = defaultVideoSize
	}
	resolution, aspect := relaycommon.GrokImagineDimensionsFromSize(size)
	if resolution == "" {
		return "", "", fmt.Errorf("unsupported video size %q", size)
	}
	return aspect, resolution, nil
}

// buildVideoRequest maps the unified task request onto the xAI body:
// first_frame / input_reference / image pin the opening frame, last_frame the
// closing one (1.5 only), and reference_images guide reference-to-video
// (1.5 only, at most 7, capped at 720p). Model-specific rules only apply once
// modelName is a known xAI video model.
func buildVideoRequest(req *relaycommon.TaskSubmitReq, modelName string) (*videoRequest, error) {
	aspect, resolution, err := videoDimensions(req.Size)
	if err != nil {
		return nil, err
	}
	if len(req.ReferenceVideos) > 0 || len(req.ReferenceAudios) > 0 {
		return nil, fmt.Errorf("xAI video does not accept reference videos or audios")
	}
	body := &videoRequest{Model: modelName, Prompt: req.Prompt, Duration: req.Duration, AspectRatio: aspect, Resolution: resolution}
	if value, exists := req.Metadata["generate_audio"]; exists {
		audio, ok := value.(bool)
		if !ok {
			return nil, fmt.Errorf("generate_audio must be boolean")
		}
		body.GenerateAudio = &audio
	}
	first := strings.TrimSpace(req.FirstFrame)
	for _, alias := range []string{req.InputReference, req.Image} {
		if first == "" {
			first = strings.TrimSpace(alias)
		}
	}
	last := strings.TrimSpace(req.LastFrame)
	references := []videoImage{}
	for _, image := range req.ReferenceImages {
		references = append(references, videoImage{URL: image})
	}
	// Untyped images keep their historical meaning: without an explicit
	// first frame, images[0] is the image-to-video frame; any further
	// untyped images are references.
	for _, image := range req.Images {
		image = strings.TrimSpace(image)
		if image == "" || image == first || image == last || slices.Contains(req.ReferenceImages, image) {
			continue
		}
		if first == "" {
			first = image
			continue
		}
		references = append(references, videoImage{URL: image})
	}
	if modelName == modelImagine {
		if resolution == "1080p" {
			return nil, fmt.Errorf("1080p is only supported by %s", modelImagine15)
		}
		if last != "" {
			return nil, fmt.Errorf("last frame is only supported by %s", modelImagine15)
		}
		if len(references) > 0 {
			return nil, fmt.Errorf("reference images are only supported by %s", modelImagine15)
		}
	}
	if len(references) > maxReferenceImages {
		return nil, fmt.Errorf("at most %d reference images are supported", maxReferenceImages)
	}
	if len(references) > 0 && resolution == "1080p" {
		return nil, fmt.Errorf("reference-to-video is limited to 720p")
	}
	if first != "" {
		body.Image = &videoImage{URL: first}
	}
	if last != "" {
		body.LastFrame = &videoImage{URL: last}
	}
	if len(references) > 0 {
		body.ReferenceImages = references
	}
	return body, nil
}

func (a *TaskAdaptor) EstimateBilling(c *gin.Context, info *relaycommon.RelayInfo) map[string]float64 {
	req, err := relaycommon.GetTaskRequest(c)
	if err != nil {
		return nil
	}
	_, resolution, err := videoDimensions(req.Size)
	if err != nil {
		return nil
	}
	modelName := info.UpstreamModelName
	if modelName == "" {
		modelName = req.Model
	}
	ratio := relaycommon.GrokImagineResolutionRatio(modelName, resolution)
	// Task ModelPrice supports multiplicative parameters only, so there is no
	// separate input-image charge here. ModelPrice is the configured 480p/sec base.
	return map[string]float64{"seconds": float64(req.Duration), "resolution": ratio}
}

func (a *TaskAdaptor) BuildRequestURL(_ *relaycommon.RelayInfo) (string, error) {
	return strings.TrimRight(a.baseURL, "/") + "/v1/videos/generations", nil
}
func (a *TaskAdaptor) BuildRequestHeader(_ *gin.Context, req *http.Request, _ *relaycommon.RelayInfo) error {
	req.Header.Set("Authorization", "Bearer "+a.apiKey)
	req.Header.Set("Content-Type", "application/json")
	req.Header.Set("Accept", "application/json")
	return nil
}
func (a *TaskAdaptor) BuildRequestBody(c *gin.Context, info *relaycommon.RelayInfo) (io.Reader, error) {
	req, err := relaycommon.GetTaskRequest(c)
	if err != nil {
		return nil, err
	}
	if info.UpstreamModelName != modelImagine && info.UpstreamModelName != modelImagine15 {
		return nil, fmt.Errorf("unsupported xAI video model %q", info.UpstreamModelName)
	}
	body, err := buildVideoRequest(&req, info.UpstreamModelName)
	if err != nil {
		return nil, err
	}
	// Private studio assets become short-lived provider-readable URLs.
	images := []*videoImage{body.Image, body.LastFrame}
	for index := range body.ReferenceImages {
		images = append(images, &body.ReferenceImages[index])
	}
	for _, image := range images {
		if image == nil {
			continue
		}
		image.URL, err = service.PrivateReferenceMediaURL(image.URL, system_setting.ServerAddress, info.UserId)
		if err != nil {
			return nil, err
		}
	}
	b, err := common.Marshal(body)
	if err != nil {
		return nil, err
	}
	return bytes.NewReader(b), nil
}
func (a *TaskAdaptor) DoRequest(c *gin.Context, info *relaycommon.RelayInfo, body io.Reader) (*http.Response, error) {
	return channel.DoTaskApiRequest(a, c, info, body)
}
func (a *TaskAdaptor) DoResponse(c *gin.Context, resp *http.Response, info *relaycommon.RelayInfo) (string, []byte, *dto.TaskError) {
	b, err := io.ReadAll(resp.Body)
	if err != nil {
		return "", nil, service.TaskErrorWrapper(err, "read_response_body_failed", http.StatusInternalServerError)
	}
	defer resp.Body.Close()
	var result videoResponse
	if err := common.Unmarshal(b, &result); err != nil {
		return "", nil, service.TaskErrorWrapper(err, "unmarshal_response_failed", http.StatusInternalServerError)
	}
	if strings.TrimSpace(result.RequestID) == "" {
		return "", nil, service.TaskErrorWrapper(fmt.Errorf("missing request_id"), "invalid_response", http.StatusInternalServerError)
	}
	video := dto.NewOpenAIVideo()
	video.ID, video.TaskID, video.Model, video.CreatedAt = info.PublicTaskID, info.PublicTaskID, info.OriginModelName, time.Now().Unix()
	c.JSON(http.StatusOK, video)
	return result.RequestID, b, nil
}
func (a *TaskAdaptor) FetchTask(baseURL, key string, body map[string]any, proxy string) (*http.Response, error) {
	return a.FetchTaskWithContext(context.Background(), baseURL, key, body, proxy)
}

func (a *TaskAdaptor) FetchTaskWithContext(ctx context.Context, baseURL, key string, body map[string]any, proxy string) (*http.Response, error) {
	id, ok := body["task_id"].(string)
	if !ok || id == "" {
		return nil, fmt.Errorf("invalid task_id")
	}
	req, err := http.NewRequestWithContext(ctx, http.MethodGet, strings.TrimRight(baseURL, "/")+"/v1/videos/"+url.PathEscape(id), nil)
	if err != nil {
		return nil, err
	}
	req.Header.Set("Authorization", "Bearer "+key)
	req.Header.Set("Accept", "application/json")
	client, err := service.GetHttpClientWithProxy(proxy)
	if err != nil {
		return nil, err
	}
	resp, err := client.Do(req)
	if err != nil {
		return nil, err
	}
	if resp.StatusCode >= 200 && resp.StatusCode < 300 {
		return resp, nil
	}
	if resp.StatusCode == http.StatusTooManyRequests || resp.StatusCode >= 500 {
		resp.Body.Close()
		return nil, fmt.Errorf("xAI video polling returned retryable status %d", resp.StatusCode)
	}
	responseBody, readErr := io.ReadAll(io.LimitReader(resp.Body, 1024*1024+1))
	resp.Body.Close()
	if readErr != nil {
		return nil, readErr
	}
	if len(responseBody) > 1024*1024 {
		return nil, fmt.Errorf("xAI polling error response exceeds limit")
	}
	message := strings.TrimSpace(string(responseBody))
	var upstreamError struct {
		Error *videoError `json:"error"`
	}
	if common.Unmarshal(responseBody, &upstreamError) == nil && upstreamError.Error != nil && upstreamError.Error.Message != "" {
		message = upstreamError.Error.Message
	}
	if message == "" {
		message = fmt.Sprintf("xAI video polling returned status %d", resp.StatusCode)
	}
	failureBody, marshalErr := common.Marshal(videoResponse{
		Status: "failed",
		Error:  &videoError{Code: fmt.Sprintf("http_%d", resp.StatusCode), Message: message},
	})
	if marshalErr != nil {
		return nil, marshalErr
	}
	resp.StatusCode = http.StatusOK
	resp.Body = io.NopCloser(bytes.NewReader(failureBody))
	resp.ContentLength = int64(len(failureBody))
	return resp, nil
}
func (a *TaskAdaptor) ParseTaskResult(body []byte) (*relaycommon.TaskInfo, error) {
	var result videoResponse
	if err := common.Unmarshal(body, &result); err != nil {
		return nil, fmt.Errorf("unmarshal task result: %w", err)
	}
	info := &relaycommon.TaskInfo{}
	switch result.Status {
	case "pending":
		info.Status, info.Progress = model.TaskStatusQueued, taskcommon.ProgressQueued
	case "done":
		if result.Video == nil || strings.TrimSpace(result.Video.URL) == "" {
			info.Status, info.Progress = model.TaskStatusFailure, taskcommon.ProgressComplete
			info.Reason = "xAI video task completed without a video URL"
		} else if !result.Video.RespectModeration {
			info.Status, info.Progress = model.TaskStatusFailure, taskcommon.ProgressComplete
			info.Reason = "xAI video task was blocked by moderation"
		} else {
			info.Status, info.Progress = model.TaskStatusSuccess, taskcommon.ProgressComplete
			info.Url = strings.TrimSpace(result.Video.URL)
		}
	case "failed", "expired":
		info.Status, info.Progress = model.TaskStatusFailure, taskcommon.ProgressComplete
		if result.Error != nil && result.Error.Message != "" {
			info.Reason = result.Error.Message
		} else {
			info.Reason = "xAI video task " + result.Status
		}
	default:
		info.Status, info.Progress = model.TaskStatusFailure, taskcommon.ProgressComplete
		if result.Error != nil && result.Error.Message != "" {
			info.Reason = result.Error.Message
		} else {
			info.Reason = fmt.Sprintf("unknown xAI video task status %q", result.Status)
		}
	}
	return info, nil
}
func (a *TaskAdaptor) ConvertToOpenAIVideo(task *model.Task) ([]byte, error) {
	var result videoResponse
	if len(task.Data) > 0 {
		_ = common.Unmarshal(task.Data, &result)
	}
	video := dto.NewOpenAIVideo()
	video.ID, video.TaskID = task.TaskID, task.TaskID
	video.Model = task.Properties.OriginModelName
	video.Status = task.Status.ToVideoStatus()
	video.SetProgressStr(task.Progress)
	video.CreatedAt = task.CreatedAt
	if task.FinishTime > 0 {
		video.CompletedAt = task.FinishTime
	}
	if task.Status == model.TaskStatusSuccess && task.PrivateData.ResultURL != "" {
		video.SetMetadata("url", taskcommon.BuildProxyURL(task.TaskID))
	}
	if result.Video != nil {
		video.Seconds = fmt.Sprintf("%d", result.Video.Duration)
	}
	if result.Error != nil {
		video.Error = &dto.OpenAIVideoError{Code: result.Error.Code, Message: result.Error.Message}
	} else if task.FailReason != "" {
		video.Error = &dto.OpenAIVideoError{Code: "video_generation_failed", Message: task.FailReason}
	}
	return common.Marshal(video)
}
func (a *TaskAdaptor) GetModelList() []string { return []string{modelImagine, modelImagine15} }
func (a *TaskAdaptor) GetChannelName() string { return "xAI" }
