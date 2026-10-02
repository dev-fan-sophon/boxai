package gemini

import (
	"errors"
	"fmt"
	"io"
	"net/http"
	"strings"
	"time"

	"github.com/dev-fan-sophon/boxai/common"
	"github.com/dev-fan-sophon/boxai/dto"
	relaycommon "github.com/dev-fan-sophon/boxai/relay/common"
	"github.com/dev-fan-sophon/boxai/relay/constant"
	"github.com/dev-fan-sophon/boxai/service"
	"github.com/dev-fan-sophon/boxai/types"
	"github.com/gin-gonic/gin"
)

// isGeminiNativeImageRequest reports an OpenAI Images request for a Gemini
// image model (gemini-*-image / nano-banana), served via generateContent.
func isGeminiNativeImageRequest(info *relaycommon.RelayInfo) bool {
	if info == nil || info.ChannelMeta == nil || (info.RelayMode != constant.RelayModeImagesGenerations && info.RelayMode != constant.RelayModeImagesEdits) {
		return false
	}
	return relaycommon.ImageModelFamily(info.UpstreamModelName) == relaycommon.ImageFamilyGemini
}

// convertImageRequestToGenerateContent builds the generateContent body for a
// Gemini image model: prompt text plus up to 14 reference images as inline
// parts, responseModalities [TEXT, IMAGE] and imageConfig {aspectRatio,
// imageSize} (ai.google.dev/gemini-api/docs/image-generation).
func convertImageRequestToGenerateContent(c *gin.Context, info *relaycommon.RelayInfo, request dto.ImageRequest) (*dto.GeminiChatRequest, error) {
	var references []string
	if info.RelayMode == constant.RelayModeImagesEdits {
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

	parts := []dto.GeminiPart{{Text: request.Prompt}}
	for _, reference := range references {
		inline, err := geminiInlineImage(c, reference)
		if err != nil {
			return nil, err
		}
		parts = append(parts, dto.GeminiPart{InlineData: inline})
	}

	imageConfig := map[string]string{}
	if request.AspectRatio != "" {
		imageConfig["aspectRatio"] = request.AspectRatio
	} else if ratio := relaycommon.AspectRatioFromImageSize(request.Size); ratio != "" {
		imageConfig["aspectRatio"] = ratio
	}
	if request.Resolution != "" {
		imageConfig["imageSize"] = strings.ToUpper(request.Resolution)
	}
	geminiRequest := &dto.GeminiChatRequest{
		Contents: []dto.GeminiChatContent{{Role: "user", Parts: parts}},
		GenerationConfig: dto.GeminiChatGenerationConfig{
			ResponseModalities: []string{"TEXT", "IMAGE"},
		},
	}
	if len(imageConfig) > 0 {
		raw, err := common.Marshal(imageConfig)
		if err != nil {
			return nil, err
		}
		geminiRequest.GenerationConfig.ImageConfig = raw
	}
	return geminiRequest, nil
}

func geminiInlineImage(c *gin.Context, reference string) (*dto.GeminiInlineData, error) {
	if strings.HasPrefix(reference, "data:") {
		header, data, found := strings.Cut(strings.TrimPrefix(reference, "data:"), ",")
		if !found || !strings.HasSuffix(header, ";base64") {
			return nil, errors.New("reference image must be a base64 data URI or an http(s) URL")
		}
		return &dto.GeminiInlineData{MimeType: strings.TrimSuffix(header, ";base64"), Data: data}, nil
	}
	if !strings.HasPrefix(reference, "http://") && !strings.HasPrefix(reference, "https://") {
		return nil, errors.New("reference image must be a base64 data URI or an http(s) URL")
	}
	file, err := service.GetFileBase64FromUrl(c, reference, "gemini image reference")
	if err != nil {
		return nil, fmt.Errorf("fetch reference image: %w", err)
	}
	return &dto.GeminiInlineData{MimeType: file.MimeType, Data: file.Base64Data}, nil
}

// GeminiImageGenerateContentHandler converts generateContent image output
// (inlineData parts) into the OpenAI Images response and bills the reported
// token usage, the same way Gemini chat image output is billed.
func GeminiImageGenerateContentHandler(c *gin.Context, info *relaycommon.RelayInfo, resp *http.Response) (*dto.Usage, *types.NewAPIError) {
	defer service.CloseResponseBodyGracefully(resp)
	responseBody, err := io.ReadAll(resp.Body)
	if err != nil {
		return nil, types.NewOpenAIError(err, types.ErrorCodeReadResponseBodyFailed, http.StatusBadGateway, types.ErrOptionWithSkipRetry())
	}
	var geminiResponse dto.GeminiChatResponse
	if err := common.Unmarshal(responseBody, &geminiResponse); err != nil {
		return nil, types.NewOpenAIError(err, types.ErrorCodeBadResponseBody, http.StatusBadGateway)
	}

	response := dto.ImageResponse{Created: time.Now().Unix()}
	var text strings.Builder
	for _, candidate := range geminiResponse.Candidates {
		for _, part := range candidate.Content.Parts {
			if part.InlineData != nil && strings.HasPrefix(part.InlineData.MimeType, "image/") && part.InlineData.Data != "" {
				response.Data = append(response.Data, dto.ImageData{B64Json: part.InlineData.Data})
				continue
			}
			if part.Text != "" && !part.Thought {
				text.WriteString(part.Text)
			}
		}
	}
	if len(response.Data) == 0 {
		message := "Gemini returned no image"
		if geminiResponse.PromptFeedback != nil && geminiResponse.PromptFeedback.BlockReason != nil {
			message = "request blocked by Gemini API: " + *geminiResponse.PromptFeedback.BlockReason
		} else if reply := strings.TrimSpace(text.String()); reply != "" {
			if runes := []rune(reply); len(runes) > 300 {
				reply = string(runes[:300])
			}
			message = "Gemini returned no image: " + reply
		}
		return nil, types.NewOpenAIError(errors.New(message), types.ErrorCodeBadResponseBody, http.StatusBadGateway, types.ErrOptionWithSkipRetry())
	}

	payload, err := common.Marshal(response)
	if err != nil {
		return nil, types.NewOpenAIError(err, types.ErrorCodeBadResponseBody, http.StatusInternalServerError)
	}
	if info.PriceData.UsePrice && len(response.Data) <= dto.MaxImageN {
		info.PriceData.AddOtherRatio("n", float64(len(response.Data)))
	}
	c.Data(http.StatusOK, "application/json", payload)

	usage := buildUsageFromGeminiResponse(c, info, &geminiResponse)
	return &usage, nil
}
