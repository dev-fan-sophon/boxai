package hailuo

import (
	"fmt"
	"math"
	"strconv"
	"strings"
	"unicode/utf8"

	"github.com/dev-fan-sophon/boxai/common"
	"github.com/dev-fan-sophon/boxai/constant"
	"github.com/dev-fan-sophon/boxai/dto"
	"github.com/dev-fan-sophon/boxai/model"
	relaycommon "github.com/dev-fan-sophon/boxai/relay/common"
	"github.com/dev-fan-sophon/boxai/service"
	"github.com/dev-fan-sophon/boxai/setting/ratio_setting"
	"github.com/gin-gonic/gin"
)

// Polling receives action, but not the model. Persist a distinct action so a
// fresh adaptor can select V2 without guessing from the host or task ID.
const h3GenerateAction = "generate_h3"

// These are exact documented V2 IDs, not prefix matches. Only MiniMax-H3's
// live-verified 768P/4s text capability is enabled below; extended models are
// recognized so they cannot accidentally be sent to the legacy V1 endpoint.
func isH3Model(name string) bool {
	switch name {
	case "MiniMax-H3", "MiniMax-H3-Highspeed", "MiniMax-H3-Lite", "MiniMax-H3-Max", "MiniMax-H3-Max-Turbo", "MiniMax-H3-MG", "MiniMax-H3-NC":
		return true
	}
	return false
}

type h3Content struct {
	Type string `json:"type"`
	Text string `json:"text"`
}

type h3Request struct {
	Model         string      `json:"model"`
	Content       []h3Content `json:"content"`
	Resolution    string      `json:"resolution"`
	Duration      *int        `json:"duration,omitempty"`
	Ratio         string      `json:"ratio"`
	GenerateAudio *bool       `json:"generate_audio,omitempty"`
}

type h3Error struct {
	Code     string `json:"code"`
	Type     string `json:"type"`
	Message  string `json:"message"`
	HTTPCode string `json:"http_code"`
}

type h3Task struct {
	ID         string `json:"id"`
	Status     string `json:"status"`
	Duration   int    `json:"duration"`
	Resolution string `json:"resolution"`
	Ratio      string `json:"ratio"`
	Content    struct {
		URL string `json:"url"`
	} `json:"content"`
	Usage struct {
		TotalTokens      int `json:"total_tokens"`
		CompletionTokens int `json:"completion_tokens"`
		TotalSeconds     int `json:"total_seconds"`
		OutputSeconds    int `json:"output_seconds"`
	} `json:"usage"`
	Error *h3Error `json:"error"`
}

type h3Response struct {
	TaskID   string    `json:"task_id"`
	Task     *h3Task   `json:"task"`
	Error    *h3Error  `json:"error"`
	BaseResp *BaseResp `json:"base_resp"`
}

// buildH3Request is also used at the serialization boundary: metadata must
// never override a previously validated duration, model, or reference set.
func buildH3Request(req relaycommon.TaskSubmitReq, modelName string) (*h3Request, error) {
	if modelName != "MiniMax-H3" {
		return nil, fmt.Errorf("H3 variant %q is not enabled", modelName)
	}
	if strings.TrimSpace(req.Prompt) == "" || utf8.RuneCountInString(req.Prompt) > 7000 {
		return nil, fmt.Errorf("H3 prompt must contain 1 to 7000 characters")
	}
	if req.Mode != "" || req.Image != "" || len(req.Images) != 0 || req.InputReference != "" || req.FirstFrame != "" || req.LastFrame != "" || len(req.ReferenceImages)+len(req.ReferenceVideos)+len(req.ReferenceAudios) != 0 {
		return nil, fmt.Errorf("H3 currently supports text-only generation")
	}
	// Do not unmarshal arbitrary metadata over the provider request. Reject V1
	// options and content/reference bypasses instead of silently dropping them.
	for key := range req.Metadata {
		switch key {
		case "duration", "resolution", "ratio", "generate_audio":
		default:
			return nil, fmt.Errorf("unsupported H3 metadata field %q", key)
		}
	}
	var options struct {
		Duration      *int    `json:"duration"`
		Resolution    *string `json:"resolution"`
		Ratio         *string `json:"ratio"`
		GenerateAudio *bool   `json:"generate_audio"`
	}
	if err := req.UnmarshalMetadata(&options); err != nil {
		return nil, err
	}
	// Explicit null is not an absent override.
	for key, value := range req.Metadata {
		if value == nil {
			return nil, fmt.Errorf("H3 metadata %s must not be null", key)
		}
	}
	duration := 4
	if req.Duration != 0 {
		duration = req.Duration
	}
	if req.Seconds != "" {
		seconds, err := strconv.Atoi(req.Seconds)
		if err != nil || seconds != 4 {
			return nil, fmt.Errorf("H3 currently requires 4 seconds")
		}
		duration = seconds
	}
	if req.Duration != 0 && req.Duration != 4 {
		return nil, fmt.Errorf("H3 currently requires duration 4")
	}
	if options.Duration != nil {
		if *options.Duration < 1 || *options.Duration > relaycommon.MaxTaskDurationSeconds || *options.Duration != 4 {
			return nil, fmt.Errorf("H3 currently requires metadata duration 4")
		}
		duration = *options.Duration
	}
	if duration != 4 {
		return nil, fmt.Errorf("H3 currently requires duration 4")
	}
	if req.Size != "" && !strings.EqualFold(req.Size, Resolution768P) && req.Size != "1344x768" {
		return nil, fmt.Errorf("H3 currently requires 768P size")
	}
	if options.Resolution != nil && !strings.EqualFold(*options.Resolution, Resolution768P) {
		return nil, fmt.Errorf("H3 currently requires 768P resolution")
	}
	if options.Ratio != nil && *options.Ratio != "16:9" {
		return nil, fmt.Errorf("H3 currently requires ratio 16:9")
	}
	return &h3Request{
		Model: modelName, Content: []h3Content{{Type: "text", Text: req.Prompt}},
		Resolution: Resolution768P, Duration: &duration, Ratio: "16:9", GenerateAudio: options.GenerateAudio,
	}, nil
}

func (a *TaskAdaptor) ValidateMappedRequest(c *gin.Context, info *relaycommon.RelayInfo) *dto.TaskError {
	if !isH3Model(info.UpstreamModelName) {
		info.Action = constant.TaskActionGenerate
		return nil
	}
	req, err := relaycommon.GetTaskRequest(c)
	if err == nil {
		_, err = buildH3Request(req, info.UpstreamModelName)
	}
	if err != nil {
		return service.TaskErrorWrapperLocal(err, "invalid_h3_request", 400)
	}
	// Seconds-based H3 must use an explicitly configured USD/s ModelPrice.
	// ModelRatio's token fallback would multiply usage tokens by seconds again.
	price, configured := ratio_setting.GetModelPrice(info.OriginModelName, false)
	if !configured || price < 0 || math.IsNaN(price) || math.IsInf(price, 0) {
		return service.TaskErrorWrapperLocal(fmt.Errorf("H3 requires a configured per-second ModelPrice"), "model_price_error", 400)
	}
	info.Action = h3GenerateAction
	return nil
}

func (a *TaskAdaptor) EstimateBilling(c *gin.Context, info *relaycommon.RelayInfo) map[string]float64 {
	if !isH3Model(info.UpstreamModelName) {
		return nil
	}
	req, err := relaycommon.GetTaskRequest(c)
	if err != nil {
		return nil
	}
	body, err := buildH3Request(req, info.UpstreamModelName)
	if err != nil {
		return nil
	}
	return map[string]float64{"seconds": float64(*body.Duration)}
}

func parseH3Task(resp h3Response) (*relaycommon.TaskInfo, error) {
	if resp.Error != nil {
		return nil, fmt.Errorf("H3 query error: %s", resp.Error.Message)
	}
	if resp.BaseResp != nil && resp.BaseResp.StatusCode != StatusSuccess {
		return nil, fmt.Errorf("H3 query error: %s", resp.BaseResp.StatusMsg)
	}
	if resp.Task == nil || resp.Task.ID == "" {
		return nil, fmt.Errorf("missing H3 task")
	}
	task := resp.Task
	result := &relaycommon.TaskInfo{TaskID: task.ID}
	switch task.Status {
	case "queued":
		result.Status, result.Progress = model.TaskStatusQueued, "10%"
	case "running":
		result.Status, result.Progress = model.TaskStatusInProgress, "50%"
	case "succeeded":
		if task.Content.URL == "" {
			return nil, fmt.Errorf("successful H3 task has no video URL")
		}
		result.Status, result.Progress, result.Url = model.TaskStatusSuccess, "100%", task.Content.URL
		// Expose upstream tokens to central completion persistence for audit.
		// Per-second ModelPrice uses PerCallBilling, so these do not reprice it.
		result.TotalTokens = common.QuotaFromFloat(float64(task.Usage.TotalTokens))
		result.CompletionTokens = common.QuotaFromFloat(float64(task.Usage.CompletionTokens))
	case "failed", "cancelled":
		result.Status, result.Progress, result.Reason = model.TaskStatusFailure, "100%", "H3 task "+task.Status
		if task.Error != nil {
			result.Reason = task.Error.Message
			result.Code, _ = strconv.Atoi(task.Error.Code)
		}
	default:
		return nil, fmt.Errorf("unknown H3 task status %q", task.Status)
	}
	return result, nil
}
