package controller

import (
	"sort"
	"strings"

	"github.com/gin-gonic/gin"

	"github.com/dev-fan-sophon/boxai/common"
	"github.com/dev-fan-sophon/boxai/model"
	"github.com/dev-fan-sophon/boxai/service"
)

// Internal tool endpoints for the boxai-chat service. The public managed-run
// machinery (run rows, execution tokens, claim CAS) exists to constrain an
// untrusted browser; a trusted sibling gets direct request/response endpoints
// that still run the full relay pipeline, so channel selection, quota, and
// billing behave exactly as they do for a browser call.

func internalAbilityGroups(c *gin.Context, requested string) ([]string, bool) {
	userGroup := c.GetString("group")
	group := strings.TrimSpace(requested)
	if group == "" {
		group = userGroup
	} else if !service.GroupInUserUsableGroups(userGroup, group) {
		common.ApiErrorMsg(c, "group is not available to this user")
		return nil, false
	}
	if group == "auto" {
		return service.GetUserAutoGroup(userGroup), true
	}
	return []string{group}, true
}

// InternalPlaygroundToolModels reports which model the platform would pick for
// each tool action in a group, so the chat service can parameterize direct
// /pg relay calls without porting ability data.
func InternalPlaygroundToolModels(c *gin.Context) {
	abilityGroups, ok := internalAbilityGroups(c, c.Query("group"))
	if !ok {
		return
	}
	modelSet := map[string]struct{}{}
	for _, group := range abilityGroups {
		for _, enabledModel := range model.GetGroupEnabledModels(group) {
			modelSet[enabledModel] = struct{}{}
		}
	}
	models := make([]string, 0, len(modelSet))
	for enabledModel := range modelSet {
		models = append(models, enabledModel)
	}
	documentAvailable := false
	for _, group := range abilityGroups {
		if service.DocumentBuilderAvailable(group) {
			documentAvailable = true
			break
		}
	}
	common.ApiSuccess(c, gin.H{
		"image_model": selectToolModel(models, service.PlaygroundToolImage),
		"video_model": selectToolModel(models, service.PlaygroundToolVideo),
		"document":    documentAvailable,
	})
}

// InternalPlaygroundTaskStatus lets the chat service poll an async media task
// (video) it submitted through the relay on a user's behalf.
func InternalPlaygroundTaskStatus(c *gin.Context) {
	userId := c.GetInt("id")
	taskId := strings.TrimSpace(c.Param("taskId"))
	if taskId == "" {
		common.ApiErrorMsg(c, "invalid task")
		return
	}
	task, ok, err := model.GetByTaskId(userId, taskId)
	if err != nil {
		common.ApiError(c, err)
		return
	}
	if !ok {
		common.ApiErrorMsg(c, "task not found")
		return
	}
	response := gin.H{
		"task_id":     taskId,
		"status":      string(task.Status),
		"progress":    task.Progress,
		"fail_reason": task.FailReason,
	}
	if task.Status == model.TaskStatusSuccess {
		response["video_url"] = "/v1/videos/" + taskId + "/content"
	}
	common.ApiSuccess(c, response)
}

func selectToolModel(models []string, action string) string {
	// Image tools only pick models that speak the OpenAI Images request shape
	// used by the playground (gpt-image-2* and grok-imagine-image*).
	if action == service.PlaygroundToolImage {
		type rankMatch struct {
			model string
			rank  int
		}
		var matches []rankMatch
		for _, enabled := range models {
			bare := enabled
			if i := strings.LastIndex(enabled, "/"); i >= 0 {
				bare = enabled[i+1:]
			}
			lower := strings.ToLower(strings.TrimSpace(bare))
			rank := -1
			switch {
			case lower == "gpt-image-2":
				rank = 0
			case strings.HasPrefix(lower, "gpt-image-2-"):
				rank = 1
			case lower == "grok-imagine-image-pro":
				rank = 2
			case lower == "grok-imagine-image" || strings.HasPrefix(lower, "grok-imagine-image-"):
				rank = 3
			case strings.HasPrefix(lower, "grok-2-image"):
				rank = 4
			}
			if rank >= 0 {
				matches = append(matches, rankMatch{model: enabled, rank: rank})
			}
		}
		if len(matches) == 0 {
			return ""
		}
		sort.Slice(matches, func(i, j int) bool {
			if matches[i].rank != matches[j].rank {
				return matches[i].rank < matches[j].rank
			}
			return strings.ToLower(matches[i].model) < strings.ToLower(matches[j].model)
		})
		return matches[0].model
	}

	priorities := []string{}
	need := []string{}
	if action == service.PlaygroundToolVideo {
		priorities = []string{"grok-imagine-video"}
		need = []string{"video", "sora", "veo", "kling", "wan", "seedance"}
	} else {
		return ""
	}
	for _, preferred := range priorities {
		for _, enabled := range models {
			if strings.EqualFold(enabled, preferred) {
				return enabled
			}
		}
	}
	fallbacks := append([]string(nil), models...)
	sort.Slice(fallbacks, func(i, j int) bool {
		return strings.ToLower(fallbacks[i]) < strings.ToLower(fallbacks[j])
	})
	for _, candidate := range fallbacks {
		lower := strings.ToLower(candidate)
		bare := lower
		if i := strings.LastIndex(bare, "/"); i >= 0 {
			bare = bare[i+1:]
		}
		// The chat video tool is text-to-video. xAI 1.5 is image-only in
		// the task adapter, so selecting it guarantees a 400 before relay.
		if action == service.PlaygroundToolVideo && bare == "grok-imagine-video-1.5" {
			continue
		}
		for _, keyword := range need {
			if strings.Contains(lower, keyword) {
				return candidate
			}
		}
	}
	return ""
}
