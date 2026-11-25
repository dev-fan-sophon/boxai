package kling

import (
	"fmt"
	"math"
	"strings"

	"github.com/dev-fan-sophon/boxai/common"
	"github.com/dev-fan-sophon/boxai/dto"
	"github.com/dev-fan-sophon/boxai/model"
	relaycommon "github.com/dev-fan-sophon/boxai/relay/common"
	"github.com/dev-fan-sophon/boxai/service"
	"github.com/dev-fan-sophon/boxai/setting/ratio_setting"
	"github.com/gin-gonic/gin"
)

// PPIO's native transport uses Bearer auth and an array-valued task query.
// Keep it separate from Kling's JWT and New API compatibility transports.
func isPPIOKling(baseURL string) bool {
	return strings.HasSuffix(strings.TrimRight(baseURL, "/"), "/v3/kling")
}

type ppioRequest struct {
	Prompt   string `json:"prompt"`
	Settings struct {
		Resolution string `json:"resolution"`
		Duration   int    `json:"duration"`
		Audio      string `json:"audio"`
	} `json:"settings"`
}

type ppioTask struct {
	ID      string `json:"id"`
	Status  string `json:"status"`
	Message string `json:"message"`
	Outputs []struct {
		Type     string `json:"type"`
		URL      string `json:"url"`
		Duration string `json:"duration"`
	} `json:"outputs"`
}

func buildPPIOKlingRequest(req relaycommon.TaskSubmitReq, mappedModel string) (*ppioRequest, error) {
	if mappedModel != "kling-3.0" || strings.TrimSpace(req.Prompt) == "" {
		return nil, fmt.Errorf("PPIO Kling requires model kling-3.0 and a prompt")
	}
	if req.Mode != "" || req.Image != "" || len(req.Images) != 0 || req.InputReference != "" || req.FirstFrame != "" || req.LastFrame != "" || len(req.ReferenceImages)+len(req.ReferenceVideos)+len(req.ReferenceAudios) != 0 {
		return nil, fmt.Errorf("PPIO Kling currently supports text-only generation")
	}
	if (req.Duration != 0 && req.Duration != 5) || (req.Seconds != "" && req.Seconds != "5") || (req.Size != "" && req.Size != "1280x720") {
		return nil, fmt.Errorf("PPIO Kling currently requires 720p, 16:9, 5 seconds")
	}
	for key, value := range req.Metadata {
		switch key {
		case "resolution":
			if value != "720p" {
				return nil, fmt.Errorf("PPIO Kling currently requires resolution 720p")
			}
		case "ratio":
			if value != "16:9" {
				return nil, fmt.Errorf("PPIO Kling currently requires ratio 16:9")
			}
		case "generate_audio":
			if value != false {
				return nil, fmt.Errorf("PPIO Kling audio has not been enabled")
			}
		default:
			return nil, fmt.Errorf("unsupported PPIO Kling metadata field %q", key)
		}
	}
	body := &ppioRequest{Prompt: req.Prompt}
	body.Settings.Resolution, body.Settings.Duration, body.Settings.Audio = "720p", 5, "off"
	return body, nil
}

func (a *TaskAdaptor) ValidateMappedRequest(c *gin.Context, info *relaycommon.RelayInfo) *dto.TaskError {
	if !isPPIOKling(a.baseURL) {
		return nil
	}
	req, err := relaycommon.GetTaskRequest(c)
	if err == nil {
		_, err = buildPPIOKlingRequest(req, info.UpstreamModelName)
	}
	if err != nil {
		return service.TaskErrorWrapperLocal(err, "invalid_kling_request", 400)
	}
	price, configured := ratio_setting.GetModelPrice(info.OriginModelName, false)
	if !configured || price < 0 || math.IsNaN(price) || math.IsInf(price, 0) {
		return service.TaskErrorWrapperLocal(fmt.Errorf("PPIO Kling requires a configured per-second ModelPrice"), "model_price_error", 400)
	}
	return nil
}

func (a *TaskAdaptor) EstimateBilling(_ *gin.Context, info *relaycommon.RelayInfo) map[string]float64 {
	if isPPIOKling(a.baseURL) {
		return map[string]float64{"seconds": 5}
	}
	return nil
}

func parsePPIOKlingTask(data []byte) (*relaycommon.TaskInfo, *ppioTask, error) {
	var response struct {
		Code    int        `json:"code"`
		Message string     `json:"message"`
		Data    []ppioTask `json:"data"`
	}
	if err := common.Unmarshal(data, &response); err != nil {
		return nil, nil, err
	}
	if response.Code != 0 || len(response.Data) != 1 || response.Data[0].ID == "" {
		return nil, nil, fmt.Errorf("invalid PPIO Kling task response: %s", response.Message)
	}
	task := &response.Data[0]
	result := &relaycommon.TaskInfo{TaskID: task.ID}
	switch task.Status {
	case "submitted", "pending":
		result.Status, result.Progress = model.TaskStatusSubmitted, "10%"
	case "processing":
		result.Status, result.Progress = model.TaskStatusInProgress, "50%"
	case "succeeded":
		for _, output := range task.Outputs {
			if output.Type == "video" && output.URL != "" {
				result.Url = output.URL
				break
			}
		}
		if result.Url == "" {
			return nil, nil, fmt.Errorf("successful PPIO Kling task has no video URL")
		}
		result.Status, result.Progress = model.TaskStatusSuccess, "100%"
	case "failed", "cancelled", "canceled":
		result.Status, result.Progress, result.Reason = model.TaskStatusFailure, "100%", task.Message
		if result.Reason == "" {
			result.Reason = "PPIO Kling task " + task.Status
		}
	default:
		return nil, nil, fmt.Errorf("unknown PPIO Kling status %q", task.Status)
	}
	return result, task, nil
}
