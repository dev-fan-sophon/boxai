package openai

import (
	"encoding/base64"
	"encoding/json"
	"errors"
	"fmt"
	"io"
	"mime/multipart"
	"net/http"
	"sort"
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
	images, mask, err := responsesImageEditInputs(c, request)
	if err != nil {
		return dto.OpenAIResponsesRequest{}, err
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

func responsesImageEditInputs(c *gin.Context, request dto.ImageRequest) ([]string, string, error) {
	if c != nil && strings.Contains(c.GetHeader("Content-Type"), "multipart/form-data") {
		form := c.Request.MultipartForm
		if form == nil {
			var err error
			form, err = common.ParseMultipartFormReusable(c)
			if err != nil {
				return nil, "", fmt.Errorf("parse Responses image edit form: %w", err)
			}
			c.Request.MultipartForm = form
		}
		headers := multipartImageHeaders(form)
		if len(headers) == 0 {
			return nil, "", errors.New("image is required")
		}
		if len(headers) > 16 {
			return nil, "", errors.New("Codex Responses image editing supports at most 16 images")
		}
		images := make([]string, 0, len(headers))
		for _, header := range headers {
			imageURL, err := multipartImageDataURL(header)
			if err != nil {
				return nil, "", fmt.Errorf("encode image %q: %w", header.Filename, err)
			}
			images = append(images, imageURL)
		}
		var mask string
		if masks := form.File["mask"]; len(masks) > 0 {
			if len(masks) > 1 {
				return nil, "", errors.New("image edit supports exactly one mask")
			}
			var err error
			mask, err = multipartImageDataURL(masks[0])
			if err != nil {
				return nil, "", fmt.Errorf("encode image mask %q: %w", masks[0].Filename, err)
			}
		}
		return images, mask, nil
	}

	var images []string
	for _, raw := range []json.RawMessage{request.Image, request.Images} {
		if len(raw) == 0 {
			continue
		}
		var value any
		if err := common.Unmarshal(raw, &value); err != nil {
			return nil, "", fmt.Errorf("decode image input: %w", err)
		}
		if err := appendResponsesImageURLs(&images, value); err != nil {
			return nil, "", err
		}
	}
	if len(images) == 0 {
		return nil, "", errors.New("image is required")
	}
	if len(images) > 16 {
		return nil, "", errors.New("Codex Responses image editing supports at most 16 images")
	}
	return images, "", nil
}

func multipartImageHeaders(form *multipart.Form) []*multipart.FileHeader {
	headers := append([]*multipart.FileHeader{}, form.File["image"]...)
	headers = append(headers, form.File["image[]"]...)
	keys := make([]string, 0)
	for key := range form.File {
		if key != "image[]" && strings.HasPrefix(key, "image[") {
			keys = append(keys, key)
		}
	}
	sort.Strings(keys)
	for _, key := range keys {
		headers = append(headers, form.File[key]...)
	}
	return headers
}

func multipartImageDataURL(header *multipart.FileHeader) (string, error) {
	file, err := header.Open()
	if err != nil {
		return "", err
	}
	defer func() { _ = file.Close() }()
	mimeType := strings.TrimSpace(header.Header.Get("Content-Type"))
	if mimeType == "" || mimeType == "application/octet-stream" {
		prefix := make([]byte, 512)
		n, readErr := io.ReadFull(file, prefix)
		if readErr != nil && !errors.Is(readErr, io.EOF) && !errors.Is(readErr, io.ErrUnexpectedEOF) {
			return "", readErr
		}
		mimeType = http.DetectContentType(prefix[:n])
		if _, err := file.Seek(0, io.SeekStart); err != nil {
			return "", err
		}
	}
	var encoded strings.Builder
	encoded.WriteString("data:")
	encoded.WriteString(mimeType)
	encoded.WriteString(";base64,")
	encoder := base64.NewEncoder(base64.StdEncoding, &encoded)
	if _, err := io.Copy(encoder, file); err != nil {
		_ = encoder.Close()
		return "", err
	}
	if err := encoder.Close(); err != nil {
		return "", err
	}
	return encoded.String(), nil
}

func appendResponsesImageURLs(images *[]string, value any) error {
	switch value := value.(type) {
	case string:
		if strings.TrimSpace(value) == "" {
			return errors.New("image URL is empty")
		}
		*images = append(*images, value)
		return nil
	case []any:
		for _, item := range value {
			if err := appendResponsesImageURLs(images, item); err != nil {
				return err
			}
		}
		return nil
	case map[string]any:
		for _, key := range []string{"url", "image_url"} {
			if nested, ok := value[key]; ok {
				return appendResponsesImageURLs(images, nested)
			}
		}
		return errors.New("image object must contain url or image_url")
	default:
		return errors.New("image must be a URL, image object, or array")
	}
}
