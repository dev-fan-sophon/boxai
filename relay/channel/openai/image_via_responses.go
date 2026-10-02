package openai

import (
	"encoding/json"
	"errors"
	"fmt"
	"strings"

	"github.com/dev-fan-sophon/boxai/common"
	"github.com/dev-fan-sophon/boxai/dto"
	relaycommon "github.com/dev-fan-sophon/boxai/relay/common"
	relayconstant "github.com/dev-fan-sophon/boxai/relay/constant"
	"github.com/gin-gonic/gin"
)

func ImageGenerationViaResponsesEnabled(info *relaycommon.RelayInfo) bool {
	return info != nil && info.ChannelMeta != nil &&
		strings.TrimSpace(info.ChannelSetting.ImageGenerationViaResponsesModel) != ""
}

// ConvertImageGenerationViaResponses adapts the OpenAI Images generation
// contract to a synchronous Responses image_generation tool call.
func ConvertImageGenerationViaResponses(info *relaycommon.RelayInfo, request dto.ImageRequest) (dto.OpenAIResponsesRequest, error) {
	return convertImageViaResponses(info, request, request.Prompt)
}

// ConvertImageEditViaResponses adapts an OpenAI multipart or JSON image edit
// request to a Responses image_generation tool call with input_image parts.
func ConvertImageEditViaResponses(c *gin.Context, info *relaycommon.RelayInfo, request dto.ImageRequest) (dto.OpenAIResponsesRequest, error) {
	images, mask, err := relaycommon.ImageEditInputs(c, request)
	if err != nil {
		return dto.OpenAIResponsesRequest{}, err
	}
	if len(images) == 0 {
		return dto.OpenAIResponsesRequest{}, errors.New("image is required")
	}
	if len(images) > relaycommon.GPTImageMaxReferenceImages {
		return dto.OpenAIResponsesRequest{}, fmt.Errorf("Codex Responses image editing supports at most %d images", relaycommon.GPTImageMaxReferenceImages)
	}
	if mask != "" {
		request.Mask, err = common.Marshal(map[string]any{"image_url": mask})
		if err != nil {
			return dto.OpenAIResponsesRequest{}, fmt.Errorf("marshal Responses image mask: %w", err)
		}
	}
	content := make([]map[string]any, 0, len(images)+1)
	content = append(content, map[string]any{"type": "input_text", "text": request.Prompt})
	for _, imageURL := range images {
		content = append(content, map[string]any{"type": "input_image", "image_url": imageURL})
	}
	return convertImageViaResponses(info, request, content)
}

func convertImageViaResponses(info *relaycommon.RelayInfo, request dto.ImageRequest, content any) (dto.OpenAIResponsesRequest, error) {
	if !ImageGenerationViaResponsesEnabled(info) {
		return dto.OpenAIResponsesRequest{}, errors.New("image generation via Responses is not configured")
	}
	imageN := uint(1)
	if request.N != nil {
		imageN = *request.N
	}
	if imageN != 1 {
		return dto.OpenAIResponsesRequest{}, errors.New("image generation via Responses supports exactly one image per request")
	}

	input, err := common.Marshal([]map[string]any{{
		"role":    "user",
		"content": content,
	}})
	if err != nil {
		return dto.OpenAIResponsesRequest{}, fmt.Errorf("marshal Responses image input: %w", err)
	}
	tool := map[string]any{
		"type":           "image_generation",
		"size":           "1024x1024",
		"output_format":  "png",
		"background":     "auto",
		"moderation":     "auto",
		"partial_images": 0,
	}
	if info.RelayMode == relayconstant.RelayModeImagesEdits {
		tool["action"] = "edit"
	}
	if request.Size != "" {
		tool["size"] = request.Size
	}
	if request.Quality != "" {
		tool["quality"] = request.Quality
	}
	for name, value := range map[string]json.RawMessage{
		"background":         request.Background,
		"input_fidelity":     request.InputFidelity,
		"input_image_mask":   request.Mask,
		"moderation":         request.Moderation,
		"output_format":      request.OutputFormat,
		"output_compression": request.OutputCompression,
	} {
		if len(value) > 0 {
			tool[name] = value
		}
	}
	tools, err := common.Marshal([]map[string]any{tool})
	if err != nil {
		return dto.OpenAIResponsesRequest{}, fmt.Errorf("marshal Responses image tool: %w", err)
	}

	upstreamModel := strings.TrimSpace(info.ChannelSetting.ImageGenerationViaResponsesModel)
	info.UpstreamModelName = upstreamModel
	stream := false
	return dto.OpenAIResponsesRequest{
		Model:  upstreamModel,
		Input:  input,
		Stream: &stream,
		Tools:  tools,
		User:   request.User,
	}, nil
}
