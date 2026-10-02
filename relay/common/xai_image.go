package common

import (
	"errors"
	"fmt"
	"strings"

	"github.com/dev-fan-sophon/boxai/common"
	"github.com/dev-fan-sophon/boxai/dto"
	"github.com/gin-gonic/gin"
)

// XAIImageRef is one xAI image input: a public URL or a base64 data URI.
type XAIImageRef struct {
	URL  string `json:"url"`
	Type string `json:"type"`
}

// XAIImageRequest is the xAI Images API body for generations and edits
// (docs.x.ai/developers/rest-api-reference/inference/images). xAI rejects
// size, mask and the OpenAI-only options, so they are never sent.
type XAIImageRequest struct {
	Model          string        `json:"model"`
	Prompt         string        `json:"prompt"`
	N              *int          `json:"n,omitempty"`
	AspectRatio    string        `json:"aspect_ratio,omitempty"`
	Resolution     string        `json:"resolution,omitempty"`
	Quality        string        `json:"quality,omitempty"`
	ResponseFormat string        `json:"response_format,omitempty"`
	User           string        `json:"user,omitempty"`
	Image          *XAIImageRef  `json:"image,omitempty"`
	Images         []XAIImageRef `json:"images,omitempty"`
}

// XAIImageQuality maps OpenAI quality spellings onto xAI's low|medium|auto.
// xAI has no "high" tier, so high/hd degrade to medium; auto is the provider
// default and is omitted.
func XAIImageQuality(quality string) string {
	switch strings.ToLower(strings.TrimSpace(quality)) {
	case "low":
		return "low"
	case "medium", "standard", "high", "hd":
		return "medium"
	}
	return ""
}

// BuildXAIImageRequest converts a validated OpenAI-shaped image request into
// the xAI body. Edits carry 1–5 source images as `image` (one) or `images`.
func BuildXAIImageRequest(c *gin.Context, request dto.ImageRequest, edit bool) (*XAIImageRequest, error) {
	result := &XAIImageRequest{
		Model:          request.Model,
		Prompt:         request.Prompt,
		Resolution:     strings.ToLower(request.Resolution),
		Quality:        XAIImageQuality(request.Quality),
		ResponseFormat: request.ResponseFormat,
		AspectRatio:    request.AspectRatio,
	}
	if request.N != nil && *request.N > 0 {
		if *request.N > XAIImageMaxN {
			return nil, fmt.Errorf("n must be an integer between 1 and %d", XAIImageMaxN)
		}
		result.N = common.GetPointer(int(*request.N))
	}
	if result.AspectRatio == "" {
		if ratio := AspectRatioFromImageSize(request.Size); common.StringsContains(xaiImageAspectRatios, ratio) {
			result.AspectRatio = ratio
		}
	}
	if user, ok := rawJSONString(request.User); ok {
		result.User = user
	}
	if !edit {
		return result, nil
	}

	images, mask, err := ImageEditInputs(c, request)
	if err != nil {
		return nil, err
	}
	if mask != "" {
		return nil, errors.New("xAI image editing does not support mask")
	}
	if len(images) == 0 {
		return nil, errors.New("image is required")
	}
	if len(images) > XAIImageMaxReferenceImages {
		return nil, fmt.Errorf("xAI image editing accepts at most %d source images", XAIImageMaxReferenceImages)
	}
	refs := make([]XAIImageRef, 0, len(images))
	for _, image := range images {
		refs = append(refs, XAIImageRef{URL: image, Type: "image_url"})
	}
	if len(refs) == 1 {
		result.Image = &refs[0]
	} else {
		result.Images = refs
	}
	return result, nil
}
