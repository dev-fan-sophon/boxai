package controller

import (
	"errors"
	"fmt"
	"io"
	"net/url"
	"strings"

	"github.com/dev-fan-sophon/boxai/common"
	"github.com/dev-fan-sophon/boxai/constant"
	"github.com/dev-fan-sophon/boxai/dto"
	"github.com/dev-fan-sophon/boxai/middleware"
	"github.com/dev-fan-sophon/boxai/model"
	"github.com/dev-fan-sophon/boxai/types"

	"github.com/gin-gonic/gin"
)

func Playground(c *gin.Context) {
	playgroundRelay(c, types.RelayFormatOpenAI, false)
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
		// xAI sometimes emits the citation marker ("1", "[2]", and so on)
		// as the annotation title. Showing that marker as the link label makes
		// the source list look corrupt; the hostname is the truthful fallback
		// when the upstream did not provide a real page title.
		citationTitle := strings.Trim(title, "[]() ")
		if title == "" || (citationTitle != "" && strings.Trim(citationTitle, "0123456789") == "") {
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
