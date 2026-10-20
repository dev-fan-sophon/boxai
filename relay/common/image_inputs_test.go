package common

import (
	"bytes"
	"encoding/base64"
	"image"
	"image/png"
	"mime/multipart"
	"net/http/httptest"
	"testing"

	"github.com/dev-fan-sophon/boxai/common"
	"github.com/dev-fan-sophon/boxai/dto"
	"github.com/gin-gonic/gin"
	"github.com/stretchr/testify/assert"
	"github.com/stretchr/testify/require"
)

func TestImageDiagnosticsPreserveDimensionsWithoutRetainingContent(t *testing.T) {
	var imageBytes bytes.Buffer
	require.NoError(t, png.Encode(&imageBytes, image.NewNRGBA(image.Rect(0, 0, 7, 11))))
	dataURL := "data:image/png;base64," + base64.StdEncoding.EncodeToString(imageBytes.Bytes())
	for _, multipartInput := range []bool{false, true} {
		c, _ := gin.CreateTestContext(httptest.NewRecorder())
		request := dto.ImageRequest{Prompt: "private-prompt"}
		if multipartInput {
			var body bytes.Buffer
			writer := multipart.NewWriter(&body)
			file, err := writer.CreateFormFile("image[]", "private-filename.png")
			require.NoError(t, err)
			_, err = file.Write(imageBytes.Bytes())
			require.NoError(t, err)
			require.NoError(t, writer.Close())
			c.Request = httptest.NewRequest("POST", "/v1/images/edits", &body)
			c.Request.Header.Set("Content-Type", writer.FormDataContentType())
			require.NoError(t, c.Request.ParseMultipartForm(1<<20))
			t.Cleanup(func() { _ = c.Request.MultipartForm.RemoveAll() })
		} else {
			var err error
			request.Images, err = common.Marshal([]string{dataURL, "https://private.invalid/image?secret=token"})
			require.NoError(t, err)
			c.Request = httptest.NewRequest("POST", "/v1/images/edits", nil)
			c.Request.Header.Set("Content-Type", "application/json")
		}
		metadata := ImageRequestMetadata(c, request)
		references := metadata["references"].([]map[string]any)
		require.NotEmpty(t, references)
		assert.Equal(t, 7, references[0]["width"])
		assert.Equal(t, 11, references[0]["height"])
		assert.EqualValues(t, imageBytes.Len(), references[0]["bytes"])
		if !multipartInput {
			assert.Equal(t, 2, metadata["reference_count"])
			assert.Equal(t, map[string]any{"source": "url"}, references[1], "remote size remains unknown, never fetched")
		}
		encoded, err := common.Marshal(metadata)
		require.NoError(t, err)
		for _, secret := range []string{"private", "token", dataURL, "base64"} {
			assert.NotContains(t, string(encoded), secret)
		}
	}
}
