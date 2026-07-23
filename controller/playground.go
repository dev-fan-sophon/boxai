package controller

import (
	"crypto/subtle"
	"errors"
	"fmt"
	"io"
	"net/http"
	"net/url"
	"strconv"
	"strings"

	"github.com/QuantumNous/new-api/common"
	"github.com/QuantumNous/new-api/constant"
	"github.com/QuantumNous/new-api/dto"
	"github.com/QuantumNous/new-api/middleware"
	"github.com/QuantumNous/new-api/model"
	"github.com/QuantumNous/new-api/service"
	"github.com/QuantumNous/new-api/types"

	"github.com/gin-gonic/gin"
	"gorm.io/gorm"
)

func Playground(c *gin.Context) {
	playgroundRelay(c, types.RelayFormatOpenAI, false)
}

func PlaygroundResponses(c *gin.Context) {
	if !playgroundClaimSearchExecution(c) {
		return
	}
	runID := c.GetInt("playground_search_run_id")
	userID := c.GetInt("id")
	defer func() {
		if c.Writer.Status() >= http.StatusBadRequest {
			_ = model.UpdatePlaygroundChatToolRunCAS(runID, userID, "executing", map[string]any{"status": "failed", "error_message": "managed search relay failed"})
		}
	}()
	playgroundRelay(c, types.RelayFormatOpenAIResponses, false)
	if c.Writer.Status() >= http.StatusBadRequest {
		return
	}
	responseValue, ok := c.Get("playground_search_response")
	response, responseOK := responseValue.(*dto.OpenAIResponsesResponse)
	if !ok || !responseOK {
		_ = model.UpdatePlaygroundChatToolRunCAS(runID, userID, "executing", map[string]any{"status": "failed", "error_message": "malformed managed search response"})
		playgroundExecutionError(c, http.StatusBadGateway, "malformed managed search response")
		return
	}
	result, sources, err := managedSearchTerminalResult(response)
	if err != nil {
		_ = model.UpdatePlaygroundChatToolRunCAS(runID, userID, "executing", map[string]any{"status": "failed", "error_message": err.Error()})
		playgroundExecutionError(c, http.StatusBadGateway, err.Error())
		return
	}
	resultJSON, resultErr := common.Marshal(result)
	sourcesJSON, sourcesErr := common.Marshal(sources)
	if resultErr != nil || sourcesErr != nil || len(resultJSON) > 64*1024 || len(sourcesJSON) > 64*1024 {
		_ = model.UpdatePlaygroundChatToolRunCAS(runID, userID, "executing", map[string]any{"status": "failed", "error_message": "managed search result is too large"})
		playgroundExecutionError(c, http.StatusBadGateway, "managed search result is too large")
		return
	}
	bodyValue, bodyOK := c.Get("playground_search_response_body")
	body, bytesOK := bodyValue.([]byte)
	if !bodyOK || !bytesOK {
		_ = model.UpdatePlaygroundChatToolRunCAS(runID, userID, "executing", map[string]any{"status": "failed", "error_message": "managed search response body is unavailable"})
		playgroundExecutionError(c, http.StatusInternalServerError, "managed search response body is unavailable")
		return
	}
	if err := model.UpdatePlaygroundChatToolRunCAS(runID, userID, "executing", map[string]any{"status": "completed", "result_json": string(resultJSON), "sources_json": string(sourcesJSON), "error_message": ""}); err != nil {
		playgroundExecutionError(c, http.StatusInternalServerError, "failed to persist managed search result")
		return
	}
	contentType := c.GetString("playground_search_response_content_type")
	if contentType == "" {
		contentType = "application/json"
	}
	c.Data(http.StatusOK, contentType, body)
}

func managedSearchTerminalResult(response *dto.OpenAIResponsesResponse) (map[string]any, []map[string]string, error) {
	if response == nil || response.IncompleteDetails != nil {
		return nil, nil, errors.New("managed search did not complete")
	}
	var status string
	if common.Unmarshal(response.Status, &status) != nil || status != "completed" {
		return nil, nil, errors.New("managed search did not complete")
	}
	if responseError := response.GetOpenAIError(); responseError != nil && responseError.Type != "" {
		return nil, nil, errors.New("managed search did not complete")
	}
	var texts []string
	var candidates []map[string]any
	for _, output := range response.Output {
		for _, content := range output.Content {
			if content.Type == "output_text" && content.Text != "" {
				texts = append(texts, content.Text)
			}
			for _, annotation := range content.Annotations {
				if candidate, ok := annotation.(map[string]any); ok {
					candidates = append(candidates, candidate)
				}
			}
		}
	}
	for _, citation := range response.Citations {
		switch value := citation.(type) {
		case string:
			candidates = append(candidates, map[string]any{"url": value})
		case map[string]any:
			candidates = append(candidates, value)
		}
	}
	text := strings.TrimSpace(strings.Join(texts, "\n"))
	if text == "" || len([]byte(text)) > 64*1024 {
		return nil, nil, errors.New("managed search returned no bounded answer text")
	}
	seen := map[string]bool{}
	sources := make([]map[string]string, 0)
	for _, candidate := range candidates {
		raw, _ := candidate["url"].(string)
		parsed, err := url.Parse(raw)
		if err != nil || parsed.Hostname() == "" || (parsed.Scheme != "http" && parsed.Scheme != "https") {
			continue
		}
		parsed.Fragment = ""
		href := parsed.String()
		if seen[href] {
			continue
		}
		seen[href] = true
		title, _ := candidate["title"].(string)
		title = strings.TrimSpace(title)
		if title == "" {
			title = parsed.Hostname()
		}
		sources = append(sources, map[string]string{"href": href, "title": title, "domain": parsed.Hostname()})
	}
	return map[string]any{"text": text, "sources": sources}, sources, nil
}

const (
	playgroundSearchMaxTurns          = 2
	playgroundSearchReservedToolCalls = 32
)

// PreparePlaygroundSearch validates the owner-scoped execution contract,
// rebuilds the request from trusted run data, and pins its Grok channel before
// the distributor runs. The ready->executing claim intentionally happens in
// PlaygroundResponses, immediately before billing and relay.
func PreparePlaygroundSearch() gin.HandlerFunc {
	return func(c *gin.Context) {
		runID, err := strconv.Atoi(strings.TrimSpace(c.GetHeader("X-Playground-Run-Id")))
		token := c.GetHeader("X-Playground-Execution-Token")
		if err != nil || runID <= 0 || token == "" {
			playgroundExecutionError(c, http.StatusBadRequest, "managed execution headers are required")
			c.Abort()
			return
		}
		run, err := model.GetPlaygroundChatToolRun(runID, c.GetInt("id"))
		if err != nil || run.Action != service.PlaygroundToolSearch || subtle.ConstantTimeCompare([]byte(token), []byte(run.ExecutionToken)) != 1 {
			playgroundExecutionError(c, http.StatusBadRequest, "invalid managed execution contract")
			c.Abort()
			return
		}
		if run.Status != "ready" {
			playgroundExecutionError(c, http.StatusConflict, "managed tool run was already executed")
			c.Abort()
			return
		}
		userGroup := common.GetContextKeyString(c, constant.ContextKeyUserGroup)
		if !service.GroupInUserUsableGroups(userGroup, run.UsingGroup) {
			playgroundExecutionError(c, http.StatusForbidden, "managed search group is no longer available")
			c.Abort()
			return
		}
		var args map[string]any
		if common.UnmarshalJsonStr(run.ArgumentsJson, &args) != nil {
			playgroundExecutionError(c, http.StatusBadRequest, "invalid managed search run")
			c.Abort()
			return
		}
		channelValue, _ := args["__channel_id"].(float64)
		channelID := int(channelValue)
		abilities, abilityErr := model.GetEnabledGrokPlaygroundSearchAbilities([]string{run.UsingGroup})
		valid := abilityErr == nil
		if valid {
			valid = false
			for _, ability := range abilities {
				if ability.ChannelId == channelID && ability.Model == run.ToolModel {
					valid = true
					break
				}
			}
		}
		if !valid || channelID <= 0 {
			playgroundExecutionError(c, http.StatusForbidden, "managed search channel is no longer available")
			c.Abort()
			return
		}
		canonical, marshalErr := common.Marshal(map[string]any{
			"model": run.ToolModel, "input": run.Prompt,
			"tools":               []map[string]string{{"type": dto.BuildInToolXAIWebSearch}, {"type": dto.BuildInToolXAIXSearch}},
			"stream":              false,
			"store":               false,
			"parallel_tool_calls": false,
			"max_turns":           playgroundSearchMaxTurns,
		})
		if marshalErr != nil || replaceRequestBody(c, canonical) != nil {
			playgroundExecutionError(c, http.StatusInternalServerError, "failed to prepare managed search")
			c.Abort()
			return
		}
		common.SetContextKey(c, constant.ContextKeyUsingGroup, run.UsingGroup)
		common.SetContextKey(c, constant.ContextKeyTokenSpecificChannelId, strconv.Itoa(channelID))
		c.Set("playground_managed_search", true)
		c.Set("playground_search_run_id", run.Id)
		c.Next()
	}
}

func PlaygroundImage(c *gin.Context) {
	if !playgroundClaimMediaExecution(c, service.PlaygroundToolImage) {
		return
	}
	playgroundRelay(c, types.RelayFormatOpenAIImage, false)
}

func PlaygroundImageEdit(c *gin.Context) {
	if !playgroundClaimMediaExecution(c, service.PlaygroundToolImage) {
		return
	}
	playgroundRelay(c, types.RelayFormatOpenAIImage, false)
}

func PlaygroundAudio(c *gin.Context) {
	playgroundRelay(c, types.RelayFormatOpenAIAudio, false)
}

func PlaygroundVideo(c *gin.Context) {
	_ = playgroundNormalizeVideoBody(c)
	if !playgroundClaimMediaExecution(c, service.PlaygroundToolVideo) {
		return
	}
	playgroundRelay(c, types.RelayFormatTask, true)
}

func playgroundClaimMediaExecution(c *gin.Context, action string) bool {
	runIDHeader := strings.TrimSpace(c.GetHeader("X-Playground-Run-Id"))
	token := c.GetHeader("X-Playground-Execution-Token")
	if runIDHeader == "" && token == "" {
		return true
	}
	runID, err := strconv.Atoi(runIDHeader)
	if err != nil || runID <= 0 || token == "" {
		playgroundExecutionError(c, http.StatusBadRequest, "invalid managed execution contract")
		return false
	}
	run, err := model.GetPlaygroundChatToolRun(runID, c.GetInt("id"))
	if errors.Is(err, gorm.ErrRecordNotFound) {
		playgroundExecutionError(c, http.StatusNotFound, "managed tool run not found")
		return false
	}
	if err != nil {
		playgroundExecutionError(c, http.StatusInternalServerError, err.Error())
		return false
	}
	if run.Action != action || subtle.ConstantTimeCompare([]byte(token), []byte(run.ExecutionToken)) != 1 {
		playgroundExecutionError(c, http.StatusBadRequest, "invalid managed execution contract")
		return false
	}
	var identity struct {
		Model  string `json:"model"`
		Group  string `json:"group"`
		Prompt string `json:"prompt"`
	}
	if err := common.UnmarshalBodyReusable(c, &identity); err != nil || identity.Model != run.ToolModel || identity.Group != run.UsingGroup || identity.Prompt != run.Prompt {
		playgroundExecutionError(c, http.StatusBadRequest, "managed execution identity mismatch")
		return false
	}
	if err := model.UpdatePlaygroundChatToolRunCAS(run.Id, run.UserId, "ready", map[string]any{"status": "executing"}); err != nil {
		playgroundExecutionError(c, http.StatusConflict, "managed tool run was already executed")
		return false
	}
	return true
}

func playgroundClaimSearchExecution(c *gin.Context) bool {
	runID, err := strconv.Atoi(strings.TrimSpace(c.GetHeader("X-Playground-Run-Id")))
	token := c.GetHeader("X-Playground-Execution-Token")
	if err != nil || runID <= 0 || token == "" {
		playgroundExecutionError(c, http.StatusBadRequest, "managed execution headers are required")
		return false
	}
	run, err := model.GetPlaygroundChatToolRun(runID, c.GetInt("id"))
	if errors.Is(err, gorm.ErrRecordNotFound) {
		playgroundExecutionError(c, http.StatusNotFound, "managed tool run not found")
		return false
	}
	if err != nil {
		playgroundExecutionError(c, http.StatusInternalServerError, err.Error())
		return false
	}
	if run.Action != service.PlaygroundToolSearch || subtle.ConstantTimeCompare([]byte(token), []byte(run.ExecutionToken)) != 1 {
		playgroundExecutionError(c, http.StatusBadRequest, "invalid managed execution contract")
		return false
	}
	if run.Id != c.GetInt("playground_search_run_id") {
		playgroundExecutionError(c, http.StatusBadRequest, "managed search execution mismatch")
		return false
	}
	if err := model.UpdatePlaygroundChatToolRunCAS(run.Id, run.UserId, "ready", map[string]any{"status": "executing"}); err != nil {
		playgroundExecutionError(c, http.StatusConflict, "managed tool run was already executed")
		return false
	}
	return true
}

func playgroundExecutionError(c *gin.Context, status int, message string) {
	c.JSON(status, gin.H{"error": map[string]any{"message": message, "type": "invalid_request_error"}})
}

func playgroundRelay(c *gin.Context, relayFormat types.RelayFormat, task bool) {
	var newAPIError *types.NewAPIError

	defer func() {
		if newAPIError != nil {
			c.JSON(newAPIError.StatusCode, gin.H{
				"error": newAPIError.ToOpenAIError(),
			})
		}
	}()

	useAccessToken := c.GetBool("use_access_token")
	if useAccessToken {
		newAPIError = types.NewError(errors.New("暂不支持使用 access token"), types.ErrorCodeAccessDenied, types.ErrOptionWithSkipRetry())
		return
	}

	userId := c.GetInt("id")

	userCache, err := model.GetUserCache(userId)
	if err != nil {
		newAPIError = types.NewError(err, types.ErrorCodeQueryDataError, types.ErrOptionWithSkipRetry())
		return
	}
	userCache.WriteContext(c)

	usingGroup := common.GetContextKeyString(c, constant.ContextKeyUsingGroup)
	tempToken := &model.Token{
		UserId: userId,
		Name:   fmt.Sprintf("playground-%s", usingGroup),
		Group:  usingGroup,
	}
	_ = middleware.SetupContextForToken(c, tempToken)

	if task {
		RelayTask(c)
		return
	}
	Relay(c, relayFormat)
}

func playgroundNormalizeVideoBody(c *gin.Context) error {
	var m map[string]any
	if err := common.UnmarshalBodyReusable(c, &m); err != nil {
		return nil
	}
	first, _ := m["first_frame"].(string)
	last, _ := m["last_frame"].(string)
	if first == "" && last == "" {
		return nil
	}
	if first != "" {
		if _, ok := m["input_reference"]; !ok {
			m["input_reference"] = first
		}
		if _, ok := m["image"]; !ok {
			m["image"] = first
		}
	}
	if images, ok := m["images"].([]any); !ok || len(images) == 0 {
		var arr []any
		if first != "" {
			arr = append(arr, first)
		}
		if last != "" {
			arr = append(arr, last)
		}
		if len(arr) > 0 {
			m["images"] = arr
		}
	}
	newBody, err := common.Marshal(m)
	if err != nil {
		return nil
	}
	return replaceRequestBody(c, newBody)
}

func replaceRequestBody(c *gin.Context, newBody []byte) error {
	common.CleanupBodyStorage(c)
	bs, err := common.CreateBodyStorage(newBody)
	if err != nil {
		return err
	}
	c.Set(common.KeyBodyStorage, bs)
	c.Set(common.KeyRequestBody, newBody)
	if _, seekErr := bs.Seek(0, io.SeekStart); seekErr != nil {
		return seekErr
	}
	c.Request.Body = io.NopCloser(bs)
	c.Request.ContentLength = int64(len(newBody))
	return nil
}

// silence unused import if search path changes
var _ = strings.TrimSpace
