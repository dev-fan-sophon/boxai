package controller

import (
	"net/http"
	"strconv"
	"strings"

	"github.com/gin-gonic/gin"

	"github.com/dev-fan-sophon/boxai/common"
	"github.com/dev-fan-sophon/boxai/constant"
	"github.com/dev-fan-sophon/boxai/dto"
	"github.com/dev-fan-sophon/boxai/model"
	"github.com/dev-fan-sophon/boxai/service"
	"github.com/dev-fan-sophon/boxai/types"
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
	searchModel := ""
	searchGroup := ""
	documentAvailable := false
	for _, group := range abilityGroups {
		if service.DocumentBuilderAvailable(group) {
			documentAvailable = true
			break
		}
	}
	if abilities, err := model.GetEnabledGrokPlaygroundSearchAbilities(abilityGroups); err == nil {
		for _, group := range abilityGroups {
			groupModels := make([]string, 0, len(abilities))
			for _, ability := range abilities {
				if ability.Group == group && (ability.ChannelType == constant.ChannelTypeXai || ability.ChannelType == constant.ChannelTypeOpenAI) {
					groupModels = append(groupModels, ability.Model)
				}
			}
			if selected := selectToolModel(groupModels, service.PlaygroundToolSearch); selected != "" {
				searchModel = selected
				searchGroup = group
				break
			}
		}
	}
	common.ApiSuccess(c, gin.H{
		"image_model":  selectToolModel(models, service.PlaygroundToolImage),
		"video_model":  selectToolModel(models, service.PlaygroundToolVideo),
		"search_model": searchModel,
		"search_group": searchGroup,
		"document":     documentAvailable,
	})
}

// PrepareInternalPlaygroundSearch pins the Grok channel and rebuilds the
// request body exactly like the managed browser path, minus the run contract.
func PrepareInternalPlaygroundSearch() gin.HandlerFunc {
	return func(c *gin.Context) {
		var body struct {
			Query string `json:"query"`
			Group string `json:"group"`
		}
		if err := common.DecodeJson(c.Request.Body, &body); err != nil {
			playgroundExecutionError(c, http.StatusBadRequest, "invalid search request")
			c.Abort()
			return
		}
		body.Query = strings.TrimSpace(body.Query)
		if body.Query == "" || len([]rune(body.Query)) > service.MaxPlaygroundSearchQueryRunes {
			playgroundExecutionError(c, http.StatusBadRequest, "invalid search query")
			c.Abort()
			return
		}
		abilityGroups, ok := internalAbilityGroups(c, body.Group)
		if !ok {
			c.Abort()
			return
		}
		abilities, err := model.GetEnabledGrokPlaygroundSearchAbilities(abilityGroups)
		if err != nil {
			playgroundExecutionError(c, http.StatusInternalServerError, "search abilities unavailable")
			c.Abort()
			return
		}
		var searchModel, searchGroup string
		channelID := 0
		for _, group := range abilityGroups {
			groupModels := make([]string, 0, len(abilities))
			for _, ability := range abilities {
				if ability.Group == group && (ability.ChannelType == constant.ChannelTypeXai || ability.ChannelType == constant.ChannelTypeOpenAI) {
					groupModels = append(groupModels, ability.Model)
				}
			}
			selected := selectToolModel(groupModels, service.PlaygroundToolSearch)
			if selected == "" {
				continue
			}
			for _, ability := range abilities {
				if ability.Group == group && ability.Model == selected {
					searchModel = ability.Model
					searchGroup = ability.Group
					channelID = ability.ChannelId
					break
				}
			}
			if searchModel != "" {
				break
			}
		}
		if searchModel == "" || channelID <= 0 {
			playgroundExecutionError(c, http.StatusServiceUnavailable, "no enabled search model is available for this group")
			c.Abort()
			return
		}
		canonical, marshalErr := common.Marshal(map[string]any{
			"model": searchModel, "input": body.Query,
			"tools":               []map[string]string{{"type": dto.BuildInToolXAIWebSearch}, {"type": dto.BuildInToolXAIXSearch}},
			"stream":              false,
			"store":               false,
			"parallel_tool_calls": false,
			"max_turns":           playgroundSearchMaxTurns,
		})
		if marshalErr != nil || replaceRequestBody(c, canonical) != nil {
			playgroundExecutionError(c, http.StatusInternalServerError, "failed to prepare search")
			c.Abort()
			return
		}
		common.SetContextKey(c, constant.ContextKeyUsingGroup, searchGroup)
		common.SetContextKey(c, constant.ContextKeyTokenSpecificChannelId, strconv.Itoa(channelID))
		c.Set("playground_managed_search", true)
		c.Set("internal_search_model", searchModel)
		c.Next()
	}
}

// InternalPlaygroundSearch relays the pinned search request and returns the
// bounded terminal result instead of the raw upstream body.
func InternalPlaygroundSearch(c *gin.Context) {
	playgroundRelay(c, types.RelayFormatOpenAIResponses, false)
	if c.Writer.Status() >= http.StatusBadRequest {
		return
	}
	responseValue, ok := c.Get("playground_search_response")
	response, responseOK := responseValue.(*dto.OpenAIResponsesResponse)
	if !ok || !responseOK {
		playgroundExecutionError(c, http.StatusBadGateway, "malformed search response")
		return
	}
	result, sources, err := managedSearchTerminalResult(response)
	if err != nil {
		playgroundExecutionError(c, http.StatusBadGateway, err.Error())
		return
	}
	text, _ := result["text"].(string)
	common.ApiSuccess(c, gin.H{
		"text":    text,
		"sources": sources,
		"model":   c.GetString("internal_search_model"),
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
