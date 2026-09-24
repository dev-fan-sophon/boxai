package sora

import (
	"bytes"
	"context"
	"fmt"
	"io"
	"net/http"
	"strconv"
	"strings"

	"github.com/dev-fan-sophon/boxai/common"
	"github.com/dev-fan-sophon/boxai/dto"
	"github.com/dev-fan-sophon/boxai/model"
	relaycommon "github.com/dev-fan-sophon/boxai/relay/common"
	"github.com/dev-fan-sophon/boxai/service"
	"github.com/dev-fan-sophon/boxai/setting/system_setting"

	"github.com/gin-gonic/gin"
	"github.com/pkg/errors"
)

// volcengineGatewayHost is the Seedance edge gateway from the Volcengine AIGC
// integration guide. It speaks the Ark contents API, not OpenAI /v1/videos.
const volcengineGatewayHost = "volcengine-aigc.com.cn"

func isVolcengineGateway(baseURL string) bool {
	return strings.Contains(strings.ToLower(baseURL), volcengineGatewayHost)
}

// isVolcengineGatewayTask reports a stored or polled Ark contents response.
// Polling has no channel base URL, so the id prefix is the discriminator:
// this gateway returns cgt-* task ids, OpenAI video returns video_*.
func isVolcengineGatewayTask(body []byte) bool {
	if len(body) == 0 {
		return false
	}
	var probe struct {
		ID     string `json:"id"`
		Status string `json:"status"`
	}
	if err := common.Unmarshal(body, &probe); err != nil {
		return false
	}
	if !strings.HasPrefix(probe.ID, "cgt-") {
		return false
	}
	switch probe.Status {
	case "pending", "queued", "processing", "running", "succeeded", "failed":
		return true
	default:
		return false
	}
}

type gatewayContentItem struct {
	Type     string        `json:"type,omitempty"`
	Text     string        `json:"text,omitempty"`
	ImageURL *gatewayMedia `json:"image_url,omitempty"`
	VideoURL *gatewayMedia `json:"video_url,omitempty"`
	AudioURL *gatewayMedia `json:"audio_url,omitempty"`
	Role     string        `json:"role,omitempty"`
}

type gatewayMedia struct {
	URL string `json:"url,omitempty"`
}

type gatewayCreateRequest struct {
	Model           string               `json:"model"`
	Content         []gatewayContentItem `json:"content"`
	GenerateAudio   *bool                `json:"generate_audio,omitempty"`
	Ratio           string               `json:"ratio,omitempty"`
	Resolution      string               `json:"resolution,omitempty"`
	Duration        *int                 `json:"duration,omitempty"`
	Watermark       *bool                `json:"watermark,omitempty"`
	ReturnLastFrame *bool                `json:"return_last_frame,omitempty"`
}

type gatewayCreateResponse struct {
	ID string `json:"id"`
}

type gatewayTaskResponse struct {
	ID      string `json:"id"`
	Model   string `json:"model"`
	Status  string `json:"status"`
	Content struct {
		VideoURL     string `json:"video_url"`
		LastFrameURL string `json:"last_frame_url"`
	} `json:"content"`
	Error struct {
		Code    string `json:"code"`
		Message string `json:"message"`
	} `json:"error"`
	Resolution string `json:"resolution"`
	Ratio      string `json:"ratio"`
	Duration   int    `json:"duration"`
	CreatedAt  int64  `json:"created_at"`
	UpdatedAt  int64  `json:"updated_at"`
	Usage      struct {
		CompletionTokens int `json:"completion_tokens"`
		TotalTokens      int `json:"total_tokens"`
	} `json:"usage"`
}

func (a *TaskAdaptor) buildVolcengineGatewayBody(c *gin.Context, info *relaycommon.RelayInfo) (io.Reader, error) {
	storage, err := common.GetBodyStorage(c)
	if err != nil {
		return nil, errors.Wrap(err, "get_request_body_failed")
	}
	cachedBody, err := storage.Bytes()
	if err != nil {
		return nil, errors.Wrap(err, "read_body_bytes_failed")
	}
	var body map[string]interface{}
	if err := common.Unmarshal(cachedBody, &body); err != nil {
		return nil, errors.Wrap(err, "unmarshal_request_failed")
	}
	if err := normalizeSeedancePassthroughBody(body, info.UpstreamModelName); err != nil {
		return nil, err
	}
	if err := rewriteGatewayReferenceURLs(body, info.UserId); err != nil {
		return nil, err
	}
	payload, err := gatewayCreateFromPassthrough(body, info.UpstreamModelName)
	if err != nil {
		return nil, err
	}
	raw, err := common.Marshal(payload)
	if err != nil {
		return nil, err
	}
	return bytes.NewReader(raw), nil
}

func gatewayCreateFromPassthrough(body map[string]interface{}, modelName string) (*gatewayCreateRequest, error) {
	req := &gatewayCreateRequest{
		Model:   modelName,
		Content: []gatewayContentItem{},
	}
	metadata, _ := body["metadata"].(map[string]interface{})
	if metadata == nil {
		metadata = map[string]interface{}{}
	}
	if prompt := bodyString(body, "prompt"); prompt != "" {
		req.Content = append(req.Content, gatewayContentItem{Type: "text", Text: prompt})
	}
	if content, ok := metadata["content"].([]interface{}); ok {
		for _, item := range content {
			entry, ok := item.(map[string]interface{})
			if !ok {
				continue
			}
			converted, ok := gatewayContentFromMap(entry)
			if !ok {
				continue
			}
			if err := rejectInlineGatewayMedia(converted); err != nil {
				return nil, err
			}
			req.Content = append(req.Content, converted)
		}
	}
	if len(req.Content) == 0 {
		return nil, errors.New("prompt is required")
	}
	req.Ratio = bodyString(metadata, "ratio")
	req.Resolution = bodyString(metadata, "resolution")
	if seconds := bodyString(body, "seconds"); seconds != "" {
		if parsed, err := strconv.Atoi(seconds); err == nil && parsed > 0 {
			req.Duration = &parsed
		}
	}
	if audio, ok := metadata["generate_audio"].(bool); ok {
		req.GenerateAudio = &audio
	}
	if watermark, ok := body["watermark"].(bool); ok {
		req.Watermark = &watermark
	} else if watermark, ok := metadata["watermark"].(bool); ok {
		req.Watermark = &watermark
	}
	return req, nil
}

func gatewayContentFromMap(entry map[string]interface{}) (gatewayContentItem, bool) {
	itemType := bodyString(entry, "type")
	role := bodyString(entry, "role")
	switch itemType {
	case "text":
		text := bodyString(entry, "text")
		if text == "" {
			return gatewayContentItem{}, false
		}
		return gatewayContentItem{Type: "text", Text: text}, true
	case "image_url":
		url := nestedURL(entry, "image_url")
		if url == "" {
			return gatewayContentItem{}, false
		}
		return gatewayContentItem{Type: "image_url", Role: role, ImageURL: &gatewayMedia{URL: url}}, true
	case "video_url":
		url := nestedURL(entry, "video_url")
		if url == "" {
			return gatewayContentItem{}, false
		}
		return gatewayContentItem{Type: "video_url", Role: role, VideoURL: &gatewayMedia{URL: url}}, true
	case "audio_url":
		url := nestedURL(entry, "audio_url")
		if url == "" {
			return gatewayContentItem{}, false
		}
		return gatewayContentItem{Type: "audio_url", Role: role, AudioURL: &gatewayMedia{URL: url}}, true
	default:
		return gatewayContentItem{}, false
	}
}

func rewriteGatewayReferenceURLs(body map[string]interface{}, userID int) error {
	metadata, _ := body["metadata"].(map[string]interface{})
	if metadata == nil {
		return nil
	}
	content, ok := metadata["content"].([]interface{})
	if !ok {
		return nil
	}
	origin := strings.TrimRight(strings.TrimSpace(system_setting.ServerAddress), "/")
	for _, item := range content {
		entry, ok := item.(map[string]interface{})
		if !ok {
			continue
		}
		for _, key := range []string{"image_url", "video_url", "audio_url"} {
			media, ok := entry[key].(map[string]interface{})
			if !ok {
				continue
			}
			raw := bodyString(media, "url")
			rewritten, err := gatewayFetchableURL(raw, origin, userID)
			if err != nil {
				return err
			}
			if rewritten != raw {
				media["url"] = rewritten
			}
		}
	}
	return nil
}

func gatewayFetchableURL(raw, origin string, userID int) (string, error) {
	value := strings.TrimSpace(raw)
	lower := strings.ToLower(value)
	if value == "" || strings.HasPrefix(lower, "asset://") || strings.HasPrefix(lower, "https://") || strings.HasPrefix(lower, "http://") {
		if strings.Contains(value, "/api/playground/assets/") {
			return "", errors.New("reference media must be a fetchable https or asset URL")
		}
		return value, nil
	}
	if !strings.HasPrefix(value, "/api/playground/assets/") {
		return "", errors.New("reference media must be a fetchable https or asset URL")
	}
	assetID := playgroundAssetID(value)
	if assetID <= 0 || userID <= 0 {
		return "", errors.New("reference media must be a fetchable https or asset URL")
	}
	grantPath, err := service.IssueMediaFetchGrant(userID, assetID)
	if err != nil {
		return "", err
	}
	return service.AbsoluteMediaFetchURL(origin, grantPath), nil
}

func playgroundAssetID(ref string) int {
	const marker = "/api/playground/assets/"
	idx := strings.Index(ref, marker)
	if idx < 0 {
		return 0
	}
	rest := ref[idx+len(marker):]
	idPart := rest
	if slash := strings.IndexByte(rest, '/'); slash >= 0 {
		idPart = rest[:slash]
	}
	id, err := strconv.Atoi(idPart)
	if err != nil {
		return 0
	}
	return id
}

func rejectInlineGatewayMedia(item gatewayContentItem) error {
	urls := []string{}
	if item.ImageURL != nil {
		urls = append(urls, item.ImageURL.URL)
	}
	if item.VideoURL != nil {
		urls = append(urls, item.VideoURL.URL)
	}
	if item.AudioURL != nil {
		urls = append(urls, item.AudioURL.URL)
	}
	for _, raw := range urls {
		if strings.HasPrefix(strings.ToLower(strings.TrimSpace(raw)), "data:") {
			return errors.New("reference media must be an https or asset URL, not inline file bytes")
		}
	}
	return nil
}

func nestedURL(entry map[string]interface{}, key string) string {
	media, ok := entry[key].(map[string]interface{})
	if !ok {
		return ""
	}
	return bodyString(media, "url")
}

func (a *TaskAdaptor) fetchVolcengineGatewayTask(ctx context.Context, baseURL, key, taskID, proxy string) (*http.Response, error) {
	uri := fmt.Sprintf("%s/api/v3/contents/generations/tasks/%s", strings.TrimRight(baseURL, "/"), taskID)
	req, err := http.NewRequestWithContext(ctx, http.MethodGet, uri, nil)
	if err != nil {
		return nil, err
	}
	req.Header.Set("Accept", "application/json")
	req.Header.Set("Authorization", "Bearer "+key)
	client, err := service.GetHttpClientWithProxy(proxy)
	if err != nil {
		return nil, fmt.Errorf("new proxy http client failed: %w", err)
	}
	return client.Do(req)
}

func parseVolcengineGatewayTask(respBody []byte) (*relaycommon.TaskInfo, error) {
	resTask := gatewayTaskResponse{}
	if err := common.Unmarshal(respBody, &resTask); err != nil {
		return nil, errors.Wrap(err, "unmarshal gateway task result failed")
	}
	taskResult := relaycommon.TaskInfo{Code: 0}
	switch resTask.Status {
	case "pending", "queued":
		taskResult.Status = model.TaskStatusQueued
		taskResult.Progress = "10%"
	case "processing", "running":
		taskResult.Status = model.TaskStatusInProgress
		taskResult.Progress = "50%"
	case "succeeded":
		taskResult.Status = model.TaskStatusSuccess
		taskResult.Progress = "100%"
		taskResult.Url = resTask.Content.VideoURL
		taskResult.CompletionTokens = resTask.Usage.CompletionTokens
		taskResult.TotalTokens = resTask.Usage.TotalTokens
	case "failed":
		taskResult.Status = model.TaskStatusFailure
		taskResult.Progress = "100%"
		taskResult.Reason = resTask.Error.Message
		if taskResult.Reason == "" {
			taskResult.Reason = "task failed"
		}
	default:
		taskResult.Status = model.TaskStatusInProgress
		taskResult.Progress = "30%"
	}
	return &taskResult, nil
}

func convertVolcengineGatewayToOpenAIVideo(task *model.Task) ([]byte, error) {
	var resp gatewayTaskResponse
	if err := common.Unmarshal(task.Data, &resp); err != nil {
		return nil, errors.Wrap(err, "unmarshal gateway task data failed")
	}
	openAIVideo := dto.NewOpenAIVideo()
	openAIVideo.ID = task.TaskID
	openAIVideo.TaskID = task.TaskID
	openAIVideo.Status = task.Status.ToVideoStatus()
	openAIVideo.SetProgressStr(task.Progress)
	openAIVideo.SetMetadata("url", resp.Content.VideoURL)
	if resp.Content.LastFrameURL != "" {
		openAIVideo.SetMetadata("last_frame_url", resp.Content.LastFrameURL)
	}
	openAIVideo.CreatedAt = task.CreatedAt
	openAIVideo.CompletedAt = task.UpdatedAt
	openAIVideo.Model = task.Properties.OriginModelName
	if resp.Status == "failed" {
		openAIVideo.Error = &dto.OpenAIVideoError{
			Message: resp.Error.Message,
			Code:    resp.Error.Code,
		}
	}
	return common.Marshal(openAIVideo)
}
