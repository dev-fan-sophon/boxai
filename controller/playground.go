package controller

import (
	"errors"
	"fmt"
	"io"
	"strings"

	"github.com/QuantumNous/new-api/common"
	"github.com/QuantumNous/new-api/middleware"
	"github.com/QuantumNous/new-api/model"
	"github.com/QuantumNous/new-api/service"
	relaycommon "github.com/QuantumNous/new-api/relay/common"
	"github.com/QuantumNous/new-api/types"

	"github.com/gin-gonic/gin"
)

func Playground(c *gin.Context) {
	if err := playgroundMaybeInjectWebSearch(c); err != nil {
		c.JSON(400, gin.H{
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
	playgroundRelay(c, types.RelayFormatOpenAIImage, false)
}

func PlaygroundImageEdit(c *gin.Context) {
	playgroundRelay(c, types.RelayFormatOpenAIImage, false)
}

func PlaygroundAudio(c *gin.Context) {
	playgroundRelay(c, types.RelayFormatOpenAIAudio, false)
}

func PlaygroundVideo(c *gin.Context) {
	_ = playgroundNormalizeVideoBody(c)
	playgroundRelay(c, types.RelayFormatTask, true)
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
		WebSearch    bool             `json:"web_search"`
		MaxToolLoops int              `json:"max_tool_loops"`
		Messages     []map[string]any `json:"messages"`
	}
	if err := common.UnmarshalBodyReusable(c, &envelope); err != nil {
		return nil
	}
	if !envelope.WebSearch {
		return nil
	}

	provider := service.GetPlaygroundSearchProvider()
	if !provider.Configured() {
		return fmt.Errorf("web search is enabled but not configured on this server (set PLAYGROUND_SEARCH_URL)")
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
	if query == "" {
		return nil
	}
	results, err := provider.Search(query, 5)
	if err != nil {
		return fmt.Errorf("web search failed: %w", err)
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
