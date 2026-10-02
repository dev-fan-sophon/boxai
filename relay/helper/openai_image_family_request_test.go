package helper

import (
	"bytes"
	"mime/multipart"
	"net/http"
	"net/http/httptest"
	"testing"

	relayconstant "github.com/dev-fan-sophon/boxai/relay/constant"
	"github.com/gin-gonic/gin"
	"github.com/stretchr/testify/assert"
	"github.com/stretchr/testify/require"
)

// TestImageFamilyOptionsAreValidatedOnJSON locks the per-family contract on
// the JSON images path: reference and n bounds are 400s before any upstream
// call, and accepted options are canonicalized for the adaptors.
func TestImageFamilyOptionsAreValidatedOnJSON(t *testing.T) {
	gin.SetMode(gin.TestMode)
	tests := []struct {
		name           string
		mode           int
		body           string
		wantErr        string
		wantAspect     string
		wantResolution string
	}{
		{
			name:           "grok edit with five references",
			mode:           relayconstant.RelayModeImagesEdits,
			body:           `{"model":"grok-imagine-image-2.0","prompt":"p","images":["https://e/1","https://e/2","https://e/3","https://e/4","https://e/5"],"aspect_ratio":"9:16","resolution":"2K"}`,
			wantAspect:     "9:16",
			wantResolution: "2k",
		},
		{
			name:    "grok edit with six references",
			mode:    relayconstant.RelayModeImagesEdits,
			body:    `{"model":"grok-imagine-image-2.0","prompt":"p","images":["https://e/1","https://e/2","https://e/3","https://e/4","https://e/5","https://e/6"]}`,
			wantErr: "at most 5 reference images",
		},
		{
			name:    "grok edit without a source image",
			mode:    relayconstant.RelayModeImagesEdits,
			body:    `{"model":"grok-imagine-image-2.0","prompt":"p"}`,
			wantErr: "image is required",
		},
		{
			name:    "gemini rejects n above one",
			mode:    relayconstant.RelayModeImagesGenerations,
			body:    `{"model":"gemini-3-pro-image","prompt":"p","n":4}`,
			wantErr: "between 1 and 1",
		},
		{
			name:    "gpt-image rejects aspect ratio",
			mode:    relayconstant.RelayModeImagesGenerations,
			body:    `{"model":"gpt-image-2","prompt":"p","aspect_ratio":"16:9"}`,
			wantErr: "uses size",
		},
	}
	for _, tt := range tests {
		t.Run(tt.name, func(t *testing.T) {
			c, _ := gin.CreateTestContext(httptest.NewRecorder())
			c.Request = httptest.NewRequest(http.MethodPost, "/v1/images/generations", bytes.NewBufferString(tt.body))
			c.Request.Header.Set("Content-Type", "application/json")
			req, err := GetAndValidOpenAIImageRequest(c, tt.mode)
			if tt.wantErr != "" {
				require.ErrorContains(t, err, tt.wantErr)
				return
			}
			require.NoError(t, err)
			assert.Equal(t, tt.wantAspect, req.AspectRatio)
			assert.Equal(t, tt.wantResolution, req.Resolution)
		})
	}
}

func TestImageFamilyOptionsAreValidatedOnMultipart(t *testing.T) {
	gin.SetMode(gin.TestMode)
	newContext := func(t *testing.T, model string, files int, fields map[string]string, mask bool) *gin.Context {
		var body bytes.Buffer
		writer := multipart.NewWriter(&body)
		require.NoError(t, writer.WriteField("model", model))
		require.NoError(t, writer.WriteField("prompt", "edit"))
		for key, value := range fields {
			require.NoError(t, writer.WriteField(key, value))
		}
		for i := 0; i < files; i++ {
			part, err := writer.CreateFormFile("image[]", "in.png")
			require.NoError(t, err)
			_, err = part.Write([]byte("img"))
			require.NoError(t, err)
		}
		if mask {
			part, err := writer.CreateFormFile("mask", "mask.png")
			require.NoError(t, err)
			_, err = part.Write([]byte("mask"))
			require.NoError(t, err)
		}
		require.NoError(t, writer.Close())
		c, _ := gin.CreateTestContext(httptest.NewRecorder())
		c.Request = httptest.NewRequest(http.MethodPost, "/v1/images/edits", &body)
		c.Request.Header.Set("Content-Type", writer.FormDataContentType())
		return c
	}

	req, err := GetAndValidOpenAIImageRequest(newContext(t, "gemini-3.1-flash-lite-image", 14, map[string]string{"aspect_ratio": "3:4", "resolution": "1k"}, false), relayconstant.RelayModeImagesEdits)
	require.NoError(t, err)
	assert.Equal(t, "3:4", req.AspectRatio)
	assert.Equal(t, "1K", req.Resolution)

	_, err = GetAndValidOpenAIImageRequest(newContext(t, "gemini-3.1-flash-lite-image", 15, nil, false), relayconstant.RelayModeImagesEdits)
	require.ErrorContains(t, err, "at most 14 reference images")

	_, err = GetAndValidOpenAIImageRequest(newContext(t, "grok-imagine-image-2.0", 1, nil, true), relayconstant.RelayModeImagesEdits)
	require.ErrorContains(t, err, "mask is not supported")

	req, err = GetAndValidOpenAIImageRequest(newContext(t, "gpt-image-2", 1, map[string]string{"background": "transparent", "output_format": "webp"}, true), relayconstant.RelayModeImagesEdits)
	require.NoError(t, err)
	assert.JSONEq(t, `"transparent"`, string(req.Background))

	_, err = GetAndValidOpenAIImageRequest(newContext(t, "gpt-image-2", 1, map[string]string{"background": "transparent", "output_format": "jpeg"}, false), relayconstant.RelayModeImagesEdits)
	require.ErrorContains(t, err, "transparent background")
}
