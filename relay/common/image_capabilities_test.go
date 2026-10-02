package common

import (
	"bytes"
	"mime/multipart"
	"net/http"
	"net/http/httptest"
	"testing"

	"github.com/dev-fan-sophon/boxai/common"
	"github.com/dev-fan-sophon/boxai/dto"
	"github.com/gin-gonic/gin"
	"github.com/stretchr/testify/assert"
	"github.com/stretchr/testify/require"
)

func TestDefaultImageCapabilitiesProfiles(t *testing.T) {
	tests := []struct {
		model         string
		family        string
		sizeMode      string
		maxReferences int
		maxN          int
		resolutions   []string
		mask          bool
	}{
		{model: "gpt-image-2", family: ImageFamilyGPT, sizeMode: "pixels", maxReferences: 16, maxN: 10, resolutions: []string{}, mask: true},
		{model: "openai/gpt-image-1", family: ImageFamilyGPT, sizeMode: "pixels", maxReferences: 16, maxN: 10, resolutions: []string{}, mask: true},
		{model: "grok-imagine-image-2.0", family: ImageFamilyXAI, sizeMode: "aspect", maxReferences: 5, maxN: 10, resolutions: []string{"1k", "2k"}},
		{model: "gemini-3-pro-image", family: ImageFamilyGemini, sizeMode: "aspect", maxReferences: 14, maxN: 1, resolutions: []string{"1K", "2K", "4K"}},
		{model: "gemini-3.1-flash-image", family: ImageFamilyGemini, sizeMode: "aspect", maxReferences: 14, maxN: 1, resolutions: []string{"1K", "2K", "4K"}},
		{model: "gemini-3.1-flash-lite-image", family: ImageFamilyGemini, sizeMode: "aspect", maxReferences: 14, maxN: 1, resolutions: []string{"1K"}},
		{model: "gemini-2.5-flash-image", family: ImageFamilyGemini, sizeMode: "aspect", maxReferences: 14, maxN: 1, resolutions: []string{}},
	}
	for _, tt := range tests {
		t.Run(tt.model, func(t *testing.T) {
			profile := DefaultImageCapabilities(tt.model)
			require.NotNil(t, profile)
			assert.Equal(t, tt.family, profile.Family)
			assert.Equal(t, tt.sizeMode, profile.SizeMode)
			assert.Equal(t, tt.maxReferences, profile.MaxReferenceImages)
			assert.Equal(t, tt.maxN, profile.MaxN)
			assert.Equal(t, tt.resolutions, profile.Resolutions)
			assert.Equal(t, tt.mask, profile.SupportsMask)
		})
	}
	assert.Nil(t, DefaultImageCapabilities("dall-e-3"))
	assert.Contains(t, DefaultImageCapabilities("gpt-image-2").Sizes, "3840x2160")
	assert.NotContains(t, DefaultImageCapabilities("gpt-image-1").Sizes, "3840x2160")
}

func TestValidateImageRequestOptions(t *testing.T) {
	jsonString := func(value string) []byte {
		encoded, err := common.Marshal(value)
		require.NoError(t, err)
		return encoded
	}
	tests := []struct {
		name           string
		request        dto.ImageRequest
		references     int
		mask           bool
		wantErr        string
		wantAspect     string
		wantResolution string
	}{
		{name: "xai canonicalizes options", request: dto.ImageRequest{Model: "grok-imagine-image-2.0", AspectRatio: "16:9", Resolution: "2K"}, references: 5, wantAspect: "16:9", wantResolution: "2k"},
		{name: "xai rejects sixth reference", request: dto.ImageRequest{Model: "grok-imagine-image-2.0"}, references: 6, wantErr: "at most 5 reference images"},
		{name: "xai bounds n", request: dto.ImageRequest{Model: "grok-imagine-image-2.0", N: common.GetPointer(uint(11))}, wantErr: "between 1 and 10"},
		{name: "xai rejects unknown aspect", request: dto.ImageRequest{Model: "grok-imagine-image-2.0", AspectRatio: "7:3"}, wantErr: "aspect_ratio must be one of"},
		{name: "xai rejects mask", request: dto.ImageRequest{Model: "grok-imagine-image-2.0"}, references: 1, mask: true, wantErr: "mask is not supported"},
		{name: "xai rejects stream", request: dto.ImageRequest{Model: "grok-imagine-image-2.0", Stream: common.GetPointer(true)}, wantErr: "stream is not supported"},
		{name: "gemini accepts 14 references", request: dto.ImageRequest{Model: "gemini-3-pro-image", AspectRatio: "21:9", Resolution: "4k"}, references: 14, wantAspect: "21:9", wantResolution: "4K"},
		{name: "gemini rejects 15 references", request: dto.ImageRequest{Model: "gemini-3-pro-image"}, references: 15, wantErr: "at most 14 reference images"},
		{name: "gemini one image per call", request: dto.ImageRequest{Model: "gemini-3.1-flash-image", N: common.GetPointer(uint(2))}, wantErr: "between 1 and 1"},
		{name: "gemini lite has only 1K", request: dto.ImageRequest{Model: "gemini-3.1-flash-lite-image", Resolution: "2K"}, wantErr: "resolution must be one of 1K"},
		{name: "gemini 2.5 has no resolution", request: dto.ImageRequest{Model: "gemini-2.5-flash-image", Resolution: "1K"}, wantErr: "resolution is not supported"},
		{name: "gpt rejects aspect ratio", request: dto.ImageRequest{Model: "gpt-image-2", AspectRatio: "1:1"}, wantErr: "uses size"},
		{name: "gpt-image-2 accepts 4K landscape", request: dto.ImageRequest{Model: "gpt-image-2", Size: "3840x2160"}},
		{name: "gpt-image-2 rejects non multiple of 16", request: dto.ImageRequest{Model: "gpt-image-2", Size: "1000x1000"}, wantErr: "size must be auto"},
		{name: "gpt-image-2 rejects ratio beyond 3:1", request: dto.ImageRequest{Model: "gpt-image-2", Size: "3840x1024"}, wantErr: "size must be auto"},
		{name: "gpt-image-2 rejects oversize edge", request: dto.ImageRequest{Model: "gpt-image-2", Size: "4096x2048"}, wantErr: "size must be auto"},
		{name: "gpt rejects transparent jpeg", request: dto.ImageRequest{Model: "gpt-image-2", Background: jsonString("transparent"), OutputFormat: jsonString("jpeg")}, wantErr: "transparent background"},
		{name: "gpt rejects unknown background", request: dto.ImageRequest{Model: "gpt-image-2", Background: jsonString("glass")}, wantErr: "background must be one of"},
		{name: "gpt bounds references", request: dto.ImageRequest{Model: "gpt-image-2"}, references: 17, wantErr: "at most 16 reference images"},
		{name: "gpt accepts mask", request: dto.ImageRequest{Model: "gpt-image-2"}, references: 1, mask: true},
		{name: "unmodeled model passes through", request: dto.ImageRequest{Model: "seedream-4", AspectRatio: "anything"}, references: 40, wantAspect: "anything"},
	}
	for _, tt := range tests {
		t.Run(tt.name, func(t *testing.T) {
			request := tt.request
			err := ValidateImageRequestOptions(&request, tt.references, tt.mask)
			if tt.wantErr != "" {
				require.Error(t, err)
				assert.Contains(t, err.Error(), tt.wantErr)
				return
			}
			require.NoError(t, err)
			assert.Equal(t, tt.wantAspect, request.AspectRatio)
			assert.Equal(t, tt.wantResolution, request.Resolution)
		})
	}
}

func TestGeminiImageOutputTokens(t *testing.T) {
	tests := []struct {
		model      string
		resolution string
		want       int
	}{
		{model: "gemini-3.1-flash-image", resolution: "", want: 1120},
		{model: "gemini-3.1-flash-image", resolution: "2K", want: 1680},
		{model: "gemini-3.1-flash-image", resolution: "4k", want: 2520},
		{model: "gemini-3-pro-image", resolution: "2K", want: 1120},
		{model: "gemini-3-pro-image", resolution: "4K", want: 2000},
		{model: "gemini-3.1-flash-lite-image", resolution: "1K", want: 1120},
	}
	for _, tt := range tests {
		assert.Equal(t, tt.want, GeminiImageOutputTokens(tt.model, tt.resolution), tt.model+" "+tt.resolution)
	}
}

func TestBuildXAIImageRequest(t *testing.T) {
	gin.SetMode(gin.TestMode)
	jsonContext := func() *gin.Context {
		c, _ := gin.CreateTestContext(httptest.NewRecorder())
		c.Request = httptest.NewRequest(http.MethodPost, "/v1/images/edits", nil)
		c.Request.Header.Set("Content-Type", "application/json")
		return c
	}
	images, err := common.Marshal([]any{"data:image/png;base64,AAAA", map[string]string{"image_url": "https://example.com/b.png"}})
	require.NoError(t, err)

	t.Run("multi-image edit forwards every source in xAI shape", func(t *testing.T) {
		request := dto.ImageRequest{Model: "grok-imagine-image-2.0", Prompt: "merge", Images: images, Size: "1536x1024", Quality: "high", N: common.GetPointer(uint(2))}
		built, err := BuildXAIImageRequest(jsonContext(), request, true)
		require.NoError(t, err)
		body, err := common.Marshal(built)
		require.NoError(t, err)
		assert.JSONEq(t, `{"model":"grok-imagine-image-2.0","prompt":"merge","n":2,"aspect_ratio":"3:2","quality":"medium","images":[{"url":"data:image/png;base64,AAAA","type":"image_url"},{"url":"https://example.com/b.png","type":"image_url"}]}`, string(body))
	})

	t.Run("single source uses image object and keeps explicit options", func(t *testing.T) {
		single, err := common.Marshal("https://example.com/a.png")
		require.NoError(t, err)
		request := dto.ImageRequest{Model: "grok-imagine-image-2.0", Prompt: "sketch", Image: single, AspectRatio: "auto", Resolution: "2k", Quality: "auto"}
		built, err := BuildXAIImageRequest(jsonContext(), request, true)
		require.NoError(t, err)
		body, err := common.Marshal(built)
		require.NoError(t, err)
		assert.JSONEq(t, `{"model":"grok-imagine-image-2.0","prompt":"sketch","aspect_ratio":"auto","resolution":"2k","image":{"url":"https://example.com/a.png","type":"image_url"}}`, string(body))
	})

	t.Run("edit without source image is rejected", func(t *testing.T) {
		_, err := BuildXAIImageRequest(jsonContext(), dto.ImageRequest{Model: "grok-imagine-image-2.0", Prompt: "x"}, true)
		require.ErrorContains(t, err, "image is required")
	})

	t.Run("more than five sources are rejected", func(t *testing.T) {
		many, err := common.Marshal([]string{"https://e/1", "https://e/2", "https://e/3", "https://e/4", "https://e/5", "https://e/6"})
		require.NoError(t, err)
		_, err = BuildXAIImageRequest(jsonContext(), dto.ImageRequest{Model: "grok-imagine-image-2.0", Prompt: "x", Images: many}, true)
		require.ErrorContains(t, err, "at most 5")
	})

	t.Run("multipart edit files become data URIs", func(t *testing.T) {
		var body bytes.Buffer
		writer := multipart.NewWriter(&body)
		for _, name := range []string{"image[]", "image[]"} {
			part, err := writer.CreateFormFile(name, "in.png")
			require.NoError(t, err)
			_, err = part.Write([]byte("\x89PNG\r\n\x1a\nfake"))
			require.NoError(t, err)
		}
		require.NoError(t, writer.Close())
		c, _ := gin.CreateTestContext(httptest.NewRecorder())
		c.Request = httptest.NewRequest(http.MethodPost, "/v1/images/edits", &body)
		c.Request.Header.Set("Content-Type", writer.FormDataContentType())

		built, err := BuildXAIImageRequest(c, dto.ImageRequest{Model: "grok-imagine-image-2.0", Prompt: "x"}, true)
		require.NoError(t, err)
		require.Len(t, built.Images, 2)
		assert.Contains(t, built.Images[0].URL, "data:")
		assert.Contains(t, built.Images[0].URL, ";base64,")
		assert.Nil(t, built.Image)
	})

	t.Run("generation ignores references and drops size", func(t *testing.T) {
		built, err := BuildXAIImageRequest(jsonContext(), dto.ImageRequest{Model: "grok-imagine-image-2.0", Prompt: "x", Images: images, Size: "auto"}, false)
		require.NoError(t, err)
		body, err := common.Marshal(built)
		require.NoError(t, err)
		assert.JSONEq(t, `{"model":"grok-imagine-image-2.0","prompt":"x"}`, string(body))
	})
}
