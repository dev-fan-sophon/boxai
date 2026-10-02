package openai

import (
	"encoding/json"
	"errors"
	"fmt"
	"net/http"
	"regexp"
	"strings"
	"time"

	"github.com/dev-fan-sophon/boxai/common"
	"github.com/dev-fan-sophon/boxai/dto"
	relaycommon "github.com/dev-fan-sophon/boxai/relay/common"
	relayconstant "github.com/dev-fan-sophon/boxai/relay/constant"
	"github.com/dev-fan-sophon/boxai/service"
	"github.com/dev-fan-sophon/boxai/types"
	"github.com/gin-gonic/gin"
)

// imageFamilyConversion reports which modeled image family an Images request
// must be translated for on an OpenAI-compatible channel: xAI image models get
// the xAI Images body, Gemini image models are served through chat
// completions (OpenAI-compatible Gemini gateways only expose that route).
func imageFamilyConversion(info *relaycommon.RelayInfo) string {
	if info == nil || info.ChannelMeta == nil || (info.RelayMode != relayconstant.RelayModeImagesGenerations && info.RelayMode != relayconstant.RelayModeImagesEdits) {
		return ""
	}
	if ImageGenerationViaResponsesEnabled(info) {
		return ""
	}
	family := relaycommon.ImageModelFamily(info.UpstreamModelName)
	if family == relaycommon.ImageFamilyXAI || family == relaycommon.ImageFamilyGemini {
		return family
	}
	return ""
}

type geminiChatImageRequest struct {
	Model       string            `json:"model"`
	Messages    []map[string]any  `json:"messages"`
	Modalities  []string          `json:"modalities"`
	Stream      bool              `json:"stream"`
	ImageConfig map[string]string `json:"image_config,omitempty"`
}

// convertGeminiImageToChat turns an Images request into the chat completions
// body understood by OpenAI-compatible Gemini gateways: the prompt and the
// reference images as one user message, image output requested through
// `modalities` and `image_config` (aspect_ratio / image_size).
func convertGeminiImageToChat(c *gin.Context, info *relaycommon.RelayInfo, request dto.ImageRequest) (*geminiChatImageRequest, error) {
	var references []string
	if info.RelayMode == relayconstant.RelayModeImagesEdits {
		images, mask, err := relaycommon.ImageEditInputs(c, request)
		if err != nil {
			return nil, err
		}
		if mask != "" {
			return nil, errors.New("Gemini image models do not support mask")
		}
		references = images
	} else {
		images, err := relaycommon.JSONImageReferences(request)
		if err != nil {
			return nil, err
		}
		references = images
	}
	if len(references) > relaycommon.GeminiImageMaxReferenceImages {
		return nil, fmt.Errorf("Gemini image models accept at most %d reference images", relaycommon.GeminiImageMaxReferenceImages)
	}

	content := make([]map[string]any, 0, len(references)+1)
	content = append(content, map[string]any{"type": dto.ContentTypeText, "text": request.Prompt})
	for _, reference := range references {
		content = append(content, map[string]any{"type": dto.ContentTypeImageURL, "image_url": map[string]string{"url": reference}})
	}

	result := &geminiChatImageRequest{
		Model:      info.UpstreamModelName,
		Messages:   []map[string]any{{"role": "user", "content": content}},
		Modalities: []string{"image", "text"},
	}
	imageConfig := map[string]string{}
	if request.AspectRatio != "" {
		imageConfig["aspect_ratio"] = request.AspectRatio
	} else if ratio := relaycommon.AspectRatioFromImageSize(request.Size); ratio != "" {
		imageConfig["aspect_ratio"] = ratio
	}
	if request.Resolution != "" {
		imageConfig["image_size"] = strings.ToUpper(request.Resolution)
	}
	if len(imageConfig) > 0 {
		result.ImageConfig = imageConfig
	}
	return result, nil
}

var markdownImagePattern = regexp.MustCompile(`!\[[^\]]*\]\(\s*((?:data:image/[^)\s]+)|(?:https?://[^)\s]+))\s*\)`)

type chatImageCompletion struct {
	Choices []struct {
		Message struct {
			Content json.RawMessage `json:"content"`
			Images  []struct {
				ImageURL struct {
					URL string `json:"url"`
				} `json:"image_url"`
			} `json:"images"`
		} `json:"message"`
	} `json:"choices"`
	Usage *dto.Usage         `json:"usage"`
	Error *types.OpenAIError `json:"error,omitempty"`
}

// ExtractChatCompletionImages collects every generated image of a chat
// completion: OpenRouter-style `message.images`, `image_url` content parts and
// markdown image links (data URIs or http URLs) in text content. The returned
// text is the remaining assistant text, kept for refusals.
func ExtractChatCompletionImages(body []byte) ([]string, string, *dto.Usage, *types.OpenAIError, error) {
	var completion chatImageCompletion
	if err := common.Unmarshal(body, &completion); err != nil {
		return nil, "", nil, nil, err
	}
	if completion.Error != nil && (completion.Error.Message != "" || completion.Error.Type != "") {
		return nil, "", nil, completion.Error, nil
	}
	var images []string
	var text strings.Builder
	addText := func(value string) {
		for _, match := range markdownImagePattern.FindAllStringSubmatch(value, -1) {
			images = append(images, match[1])
		}
		text.WriteString(strings.TrimSpace(markdownImagePattern.ReplaceAllString(value, "")))
	}
	for _, choice := range completion.Choices {
		for _, image := range choice.Message.Images {
			if url := strings.TrimSpace(image.ImageURL.URL); url != "" {
				images = append(images, url)
			}
		}
		switch common.GetJsonType(choice.Message.Content) {
		case "string":
			var value string
			if err := common.Unmarshal(choice.Message.Content, &value); err == nil {
				addText(value)
			}
		case "array":
			var parts []dto.MediaContent
			if err := common.Unmarshal(choice.Message.Content, &parts); err != nil {
				continue
			}
			for _, part := range parts {
				if part.Type == dto.ContentTypeText {
					addText(part.Text)
					continue
				}
				if part.Type == dto.ContentTypeImageURL {
					if imageURL := part.GetImageMedia(); imageURL != nil && imageURL.Url != "" {
						images = append(images, imageURL.Url)
					}
				}
			}
		}
	}
	return images, text.String(), completion.Usage, nil, nil
}

// imageDataFromURL splits a data URI into b64_json; http(s) URLs pass as url.
func imageDataFromURL(value string) dto.ImageData {
	if strings.HasPrefix(value, "data:") {
		if index := strings.Index(value, ","); index >= 0 {
			return dto.ImageData{B64Json: value[index+1:]}
		}
	}
	return dto.ImageData{Url: value}
}

// GeminiChatImageHandler converts a chat completion carrying Gemini image
// output back into the OpenAI Images response. Token usage is billed as
// reported, with each generated image floored at Google's published output
// token cost for the requested resolution because OpenAI-compatible
// gateways frequently omit image tokens.
func GeminiChatImageHandler(c *gin.Context, info *relaycommon.RelayInfo, resp *http.Response) (*dto.Usage, *types.NewAPIError) {
	defer service.CloseResponseBodyGracefully(resp)

	responseBody, err := readImageResponseBody(resp.Body)
	if err != nil {
		return nil, types.NewOpenAIError(err, types.ErrorCodeReadResponseBodyFailed, http.StatusBadGateway, types.ErrOptionWithSkipRetry())
	}
	images, text, usage, upstreamError, err := ExtractChatCompletionImages(responseBody)
	if err != nil {
		return nil, types.NewOpenAIError(err, types.ErrorCodeBadResponseBody, http.StatusBadGateway)
	}
	if upstreamError != nil {
		return nil, types.WithOpenAIError(*upstreamError, resp.StatusCode)
	}
	if len(images) == 0 {
		message := "Gemini returned no image"
		if text != "" {
			if runes := []rune(text); len(runes) > 300 {
				text = string(runes[:300])
			}
			message = fmt.Sprintf("Gemini returned no image: %s", text)
		}
		return nil, types.NewOpenAIError(errors.New(message), types.ErrorCodeBadResponseBody, http.StatusBadGateway, types.ErrOptionWithSkipRetry())
	}

	response := dto.ImageResponse{Created: time.Now().Unix(), Data: make([]dto.ImageData, 0, len(images))}
	for _, image := range images {
		response.Data = append(response.Data, imageDataFromURL(image))
	}
	payload, err := common.Marshal(response)
	if err != nil {
		return nil, types.NewOpenAIError(err, types.ErrorCodeBadResponseBody, http.StatusInternalServerError)
	}
	updateOpenAIImageCount(info, int64(len(images)))
	c.Data(http.StatusOK, "application/json", payload)

	if usage == nil {
		usage = &dto.Usage{}
	}
	resolution := ""
	if request, ok := info.Request.(*dto.ImageRequest); ok {
		resolution = request.Resolution
	}
	floor := len(images) * relaycommon.GeminiImageOutputTokens(info.UpstreamModelName, resolution)
	if usage.CompletionTokens < floor {
		usage.CompletionTokens = floor
	}
	usage.TotalTokens = usage.PromptTokens + usage.CompletionTokens
	return usage, nil
}
