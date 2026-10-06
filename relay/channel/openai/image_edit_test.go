package openai

import (
	"bytes"
	"encoding/json"
	"fmt"
	"io"
	"mime/multipart"
	"net/http"
	"net/http/httptest"
	"testing"

	"github.com/dev-fan-sophon/boxai/common"
	"github.com/dev-fan-sophon/boxai/dto"
	relaycommon "github.com/dev-fan-sophon/boxai/relay/common"
	relayconstant "github.com/dev-fan-sophon/boxai/relay/constant"
	"github.com/gin-gonic/gin"
	"github.com/stretchr/testify/assert"
	"github.com/stretchr/testify/require"
)

func TestGPTImage25OutboundContract(t *testing.T) {
	gin.SetMode(gin.TestMode)
	for _, model := range []string{"gpt-image-2.5-flare", "gpt-image-2.5-sunburst"} {
		for _, mode := range []int{relayconstant.RelayModeImagesGenerations, relayconstant.RelayModeImagesEdits} {
			t.Run(fmt.Sprintf("%s/%d", model, mode), func(t *testing.T) {
				c, _ := gin.CreateTestContext(httptest.NewRecorder())
				c.Request = httptest.NewRequest(http.MethodPost, "/v1/images/edits", nil)
				c.Request.Header.Set("Content-Type", "application/json")
				request := dto.ImageRequest{Model: model, Prompt: "edit", N: common.GetPointer(uint(1)), ResponseFormat: "b64_json", Quality: "max", Size: "1280x720", OutputCompression: json.RawMessage(`0`)}
				if mode == relayconstant.RelayModeImagesEdits {
					request.Image = json.RawMessage(`"https://example.com/a.png"`)
					request.Mask = json.RawMessage(`"https://example.com/mask.png"`)
				}
				converted, err := (&Adaptor{}).ConvertImageRequest(c, &relaycommon.RelayInfo{RelayMode: mode}, request)
				require.NoError(t, err)
				body, err := common.Marshal(converted)
				require.NoError(t, err)
				var wire map[string]json.RawMessage
				require.NoError(t, common.Unmarshal(body, &wire))
				assert.NotContains(t, wire, "n")
				assert.NotContains(t, wire, "response_format")
				assert.NotContains(t, wire, "stream")
				assert.Equal(t, `"max"`, string(wire["quality"]))
				assert.Equal(t, `"1280x720"`, string(wire["size"]))
				assert.Equal(t, `0`, string(wire["output_compression"]))
				assert.Equal(t, uint(1), *request.N, "billing input must not be mutated")
				if mode == relayconstant.RelayModeImagesEdits {
					assert.NotContains(t, wire, "image")
					assert.JSONEq(t, `[{"image_url":"https://example.com/a.png"}]`, string(wire["images"]))
					assert.JSONEq(t, `{"image_url":"https://example.com/mask.png"}`, string(wire["mask"]))
				}
			})
		}
		t.Run(model+"/multipart", func(t *testing.T) {
			var body bytes.Buffer
			writer := multipart.NewWriter(&body)
			for key, value := range map[string]string{"model": model, "prompt": "edit", "n": "1", "response_format": "b64_json", "quality": "xhigh", "size": "720x1280", "output_compression": "0", "stream": "false"} {
				require.NoError(t, writer.WriteField(key, value))
			}
			for _, field := range []string{"image[]", "image[]", "mask"} {
				part, err := writer.CreateFormFile(field, "input.png")
				require.NoError(t, err)
				_, err = part.Write([]byte("reference bytes"))
				require.NoError(t, err)
			}
			require.NoError(t, writer.Close())
			c, _ := gin.CreateTestContext(httptest.NewRecorder())
			c.Request = httptest.NewRequest(http.MethodPost, "/v1/images/edits", &body)
			c.Request.Header.Set("Content-Type", writer.FormDataContentType())
			require.NoError(t, c.Request.ParseMultipartForm(1<<20))
			converted, err := (&Adaptor{}).ConvertImageRequest(c, &relaycommon.RelayInfo{RelayMode: relayconstant.RelayModeImagesEdits}, dto.ImageRequest{Model: model, N: common.GetPointer(uint(1))})
			require.NoError(t, err)
			upstream := httptest.NewRequest(http.MethodPost, "/v1/images/edits", converted.(*bytes.Buffer))
			upstream.Header.Set("Content-Type", c.Request.Header.Get("Content-Type"))
			require.NoError(t, upstream.ParseMultipartForm(1<<20))
			assert.NotContains(t, upstream.PostForm, "n")
			assert.NotContains(t, upstream.PostForm, "response_format")
			assert.NotContains(t, upstream.PostForm, "stream")
			assert.Equal(t, "xhigh", upstream.PostForm.Get("quality"))
			assert.Equal(t, "720x1280", upstream.PostForm.Get("size"))
			assert.Equal(t, "0", upstream.PostForm.Get("output_compression"))
			assert.Len(t, upstream.MultipartForm.File["image[]"], 2)
			require.Len(t, upstream.MultipartForm.File["mask"], 1)
			file, err := upstream.MultipartForm.File["mask"][0].Open()
			require.NoError(t, err)
			defer file.Close()
			data, err := io.ReadAll(file)
			require.NoError(t, err)
			assert.Equal(t, "reference bytes", string(data))
		})
	}
}

// TestConvertImageEditRequestMultipart verifies that ConvertImageRequest
// re-serializes multipart image edit requests with all fields (including
// stream) and the file intact, both when the form was already parsed and when
// it must be re-parsed from the reusable body.
func TestConvertImageEditRequestMultipart(t *testing.T) {
	gin.SetMode(gin.TestMode)

	newMultipartContext := func(t *testing.T, prompt string) *gin.Context {
		var body bytes.Buffer
		writer := multipart.NewWriter(&body)
		require.NoError(t, writer.WriteField("model", "gpt-image-1"))
		require.NoError(t, writer.WriteField("prompt", prompt))
		require.NoError(t, writer.WriteField("stream", "true"))
		require.NoError(t, writer.WriteField("partial_images", "3"))
		part, err := writer.CreateFormFile("image", "input.png")
		require.NoError(t, err)
		_, err = part.Write([]byte("fake image"))
		require.NoError(t, err)
		require.NoError(t, writer.Close())

		c, _ := gin.CreateTestContext(httptest.NewRecorder())
		c.Request = httptest.NewRequest(http.MethodPost, "/v1/images/edits", &body)
		c.Request.Header.Set("Content-Type", writer.FormDataContentType())
		return c
	}

	convertAndReplay := func(t *testing.T, c *gin.Context, prompt string) {
		info := &relaycommon.RelayInfo{
			RelayMode: relayconstant.RelayModeImagesEdits,
		}
		request := dto.ImageRequest{
			Model:  "gpt-image-1",
			Prompt: prompt,
			Stream: common.GetPointer(true),
		}

		converted, err := (&Adaptor{}).ConvertImageRequest(c, info, request)
		require.NoError(t, err)
		convertedBody, ok := converted.(*bytes.Buffer)
		require.True(t, ok)

		replayedRequest := httptest.NewRequest(http.MethodPost, "/v1/images/edits", bytes.NewReader(convertedBody.Bytes()))
		replayedRequest.Header.Set("Content-Type", c.Request.Header.Get("Content-Type"))
		require.NoError(t, replayedRequest.ParseMultipartForm(32<<20))

		require.Equal(t, "gpt-image-1", replayedRequest.PostForm.Get("model"))
		require.Equal(t, prompt, replayedRequest.PostForm.Get("prompt"))
		require.Equal(t, "true", replayedRequest.PostForm.Get("stream"))
		require.Equal(t, "3", replayedRequest.PostForm.Get("partial_images"))
		require.Len(t, replayedRequest.MultipartForm.File["image"], 1)

		file, err := replayedRequest.MultipartForm.File["image"][0].Open()
		require.NoError(t, err)
		defer file.Close()
		fileBytes, err := io.ReadAll(file)
		require.NoError(t, err)
		require.Equal(t, []byte("fake image"), fileBytes)
	}

	t.Run("with pre-parsed form", func(t *testing.T) {
		prompt := "edit this image"
		c := newMultipartContext(t, prompt)
		require.NoError(t, c.Request.ParseMultipartForm(32<<20))

		convertAndReplay(t, c, prompt)
	})

	t.Run("re-parses reusable body when form is missing", func(t *testing.T) {
		prompt := "edit without pre-parsed form"
		c := newMultipartContext(t, prompt)

		storage, err := common.GetBodyStorage(c)
		require.NoError(t, err)
		c.Request.Body = io.NopCloser(storage)
		c.Request.MultipartForm = nil
		c.Request.PostForm = nil

		convertAndReplay(t, c, prompt)
	})
}

// TestConvertImageEditRequestJSONReferences verifies that JSON image edit
// requests carry references as `{"image_url": ...}` objects when forwarded
// upstream: plain string entries get wrapped, object entries pass through,
// and a singular `image` string is folded into `images` when the array is
// absent. JSON-edits upstreams reject bare string entries with
// "images[].image_url is required".
func TestConvertImageEditRequestJSONReferences(t *testing.T) {
	gin.SetMode(gin.TestMode)

	newJSONContext := func(t *testing.T) *gin.Context {
		c, _ := gin.CreateTestContext(httptest.NewRecorder())
		c.Request = httptest.NewRequest(http.MethodPost, "/v1/images/edits", bytes.NewReader(nil))
		c.Request.Header.Set("Content-Type", "application/json")
		return c
	}

	convert := func(t *testing.T, request dto.ImageRequest) dto.ImageRequest {
		info := &relaycommon.RelayInfo{RelayMode: relayconstant.RelayModeImagesEdits}
		converted, err := (&Adaptor{}).ConvertImageRequest(newJSONContext(t), info, request)
		require.NoError(t, err)
		result, ok := converted.(dto.ImageRequest)
		require.True(t, ok)
		return result
	}

	t.Run("wraps string entries and keeps object entries", func(t *testing.T) {
		result := convert(t, dto.ImageRequest{
			Model:  "gpt-image-2",
			Prompt: "make it red",
			Image:  json.RawMessage(`"data:image/png;base64,AAA"`),
			Images: json.RawMessage(`["data:image/png;base64,AAA",{"image_url":"https://example.com/b.png"},""]`),
		})
		require.JSONEq(t,
			`[{"image_url":"data:image/png;base64,AAA"},{"image_url":"https://example.com/b.png"}]`,
			string(result.Images))
	})

	t.Run("folds singular image string into images", func(t *testing.T) {
		result := convert(t, dto.ImageRequest{
			Model:  "gpt-image-2",
			Prompt: "make it red",
			Image:  json.RawMessage(`"https://example.com/a.png"`),
		})
		require.JSONEq(t,
			`[{"image_url":"https://example.com/a.png"}]`,
			string(result.Images))
	})

	t.Run("leaves reference-free requests untouched", func(t *testing.T) {
		result := convert(t, dto.ImageRequest{
			Model:  "gpt-image-2",
			Prompt: "generate",
		})
		require.Empty(t, result.Images)
		require.Empty(t, result.Image)
	})
}
