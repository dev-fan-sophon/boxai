package controller

import (
	"crypto/subtle"
	"errors"
	"fmt"
	"io"
	"net/http"
	"strconv"
	"strings"

	"github.com/QuantumNous/new-api/common"
	"github.com/QuantumNous/new-api/middleware"
	"github.com/QuantumNous/new-api/model"
	relaycommon "github.com/QuantumNous/new-api/relay/common"
	"github.com/QuantumNous/new-api/service"
	"github.com/QuantumNous/new-api/types"

	"github.com/gin-gonic/gin"
	"gorm.io/gorm"
)

func Playground(c *gin.Context) {
	if err := playgroundMaybeInjectWebSearch(c); err != nil {
		status := http.StatusBadRequest
		if errors.Is(err, gorm.ErrRecordNotFound) {
			status = http.StatusNotFound
		}
		c.JSON(status, gin.H{
			"error": map[string]any{
				"message": err.Error(),
				"type":    "invalid_request_error",
			},
		})
		return
	}
	playgroundRelay(c, types.RelayFormatOpenAI, false)
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

	relayInfo, err := relaycommon.GenRelayInfo(c, relayFormat, nil, nil)
	if err != nil {
		newAPIError = types.NewError(err, types.ErrorCodeInvalidRequest, types.ErrOptionWithSkipRetry())
		return
	}

	userId := c.GetInt("id")

	userCache, err := model.GetUserCache(userId)
	if err != nil {
		newAPIError = types.NewError(err, types.ErrorCodeQueryDataError, types.ErrOptionWithSkipRetry())
		return
	}
	userCache.WriteContext(c)

	tempToken := &model.Token{
		UserId: userId,
		Name:   fmt.Sprintf("playground-%s", relayInfo.UsingGroup),
		Group:  relayInfo.UsingGroup,
	}
	_ = middleware.SetupContextForToken(c, tempToken)

	if task {
		RelayTask(c)
		return
	}
	Relay(c, relayFormat)
}

// playgroundMaybeInjectWebSearch runs when the client sets web_search=true.
func playgroundMaybeInjectWebSearch(c *gin.Context) error {
	var envelope struct {
		ManagedToolRunID *int             `json:"managed_tool_run_id"`
		WebSearch        bool             `json:"web_search"`
		MaxToolLoops     int              `json:"max_tool_loops"`
		Messages         []map[string]any `json:"messages"`
	}
	if err := common.UnmarshalBodyReusable(c, &envelope); err != nil {
		return nil
	}
	managedID := 0
	if envelope.ManagedToolRunID != nil {
		managedID = *envelope.ManagedToolRunID
		if managedID <= 0 {
			return fmt.Errorf("managed_tool_run_id must be a positive integer")
		}
	}
	if managedID == 0 && !envelope.WebSearch {
		return nil
	}

	maxLoops := envelope.MaxToolLoops
	if maxLoops <= 0 {
		maxLoops = 1
	}
	if maxLoops > 20 {
		maxLoops = 20
	}
	_ = maxLoops // reserved for multi-round tool loops

	query := service.ExtractLastUserQuery(envelope.Messages)
	var results *service.SearchResponse
	if managedID != 0 {
		run, err := model.GetPlaygroundChatToolRun(managedID, c.GetInt("id"))
		if err != nil {
			return err
		}
		if run.Action != service.PlaygroundToolSearch || run.Status != "completed" {
			return fmt.Errorf("managed tool run is not a completed web_search run")
		}
		if err := common.UnmarshalJsonStr(run.SourcesJson, &results); err != nil || results == nil {
			return fmt.Errorf("managed tool run has invalid persisted sources")
		}
		query = results.Query
	} else {
		provider := service.GetPlaygroundSearchProvider()
		if !provider.Configured() {
			return fmt.Errorf("web search is enabled but not configured on this server")
		}
		if query == "" {
			return nil
		}
		var err error
		results, err = provider.Search(c.Request.Context(), query, 5)
		if err != nil {
			return fmt.Errorf("web search failed: %w", err)
		}
	}
	snippet := service.BuildWebSearchSystemSnippet(query, results)

	storage, err := common.GetBodyStorage(c)
	if err != nil {
		return nil
	}
	raw, err := storage.Bytes()
	if err != nil {
		return nil
	}
	var full map[string]any
	if err := common.Unmarshal(raw, &full); err != nil {
		return nil
	}
	msgs, _ := full["messages"].([]any)
	injected := map[string]any{"role": "system", "content": snippet}
	newMsgs := make([]any, 0, len(msgs)+1)
	inserted := false
	for i, m := range msgs {
		if !inserted && i == 0 {
			if mm, ok := m.(map[string]any); ok {
				if role, _ := mm["role"].(string); role == "system" {
					newMsgs = append(newMsgs, m, injected)
					inserted = true
					continue
				}
			}
			newMsgs = append(newMsgs, injected)
			inserted = true
			newMsgs = append(newMsgs, m)
			continue
		}
		if !inserted {
			newMsgs = append(newMsgs, injected)
			inserted = true
		}
		newMsgs = append(newMsgs, m)
	}
	if !inserted {
		newMsgs = append(newMsgs, injected)
	}
	full["messages"] = newMsgs
	delete(full, "web_search")
	delete(full, "max_tool_loops")
	delete(full, "managed_tool_run_id")

	newBody, err := common.Marshal(full)
	if err != nil {
		return nil
	}
	return replaceRequestBody(c, newBody)
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
