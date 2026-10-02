package common

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
	"github.com/gin-gonic/gin"
)

// ImageEditInputs returns the reference images (data URLs or http(s) URLs)
// and the optional mask of an image edit request, whether it arrived as
// multipart form data or as JSON (`image`, `images`, `mask` accept a URL
// string, an `{url}`/`{image_url}` object, or an array of either).
func ImageEditInputs(c *gin.Context, request dto.ImageRequest) ([]string, string, error) {
	if c != nil && c.Request != nil && strings.Contains(c.GetHeader("Content-Type"), "multipart/form-data") {
		form := c.Request.MultipartForm
		if form == nil {
			var err error
			form, err = common.ParseMultipartFormReusable(c)
			if err != nil {
				return nil, "", fmt.Errorf("parse image edit form: %w", err)
			}
			c.Request.MultipartForm = form
		}
		headers := MultipartImageHeaders(form)
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

	images, err := JSONImageReferences(request)
	if err != nil {
		return nil, "", err
	}
	var mask string
	if len(request.Mask) > 0 {
		var masks []string
		if err := appendImageURLsFromRaw(&masks, request.Mask); err != nil {
			return nil, "", fmt.Errorf("decode image mask: %w", err)
		}
		if len(masks) > 1 {
			return nil, "", errors.New("image edit supports exactly one mask")
		}
		if len(masks) == 1 {
			mask = masks[0]
		}
	}
	return images, mask, nil
}

// JSONImageReferences flattens the `image` and `images` fields of a JSON
// image request into URL strings without fetching or decoding them.
func JSONImageReferences(request dto.ImageRequest) ([]string, error) {
	var images []string
	for _, raw := range []json.RawMessage{request.Image, request.Images} {
		if err := appendImageURLsFromRaw(&images, raw); err != nil {
			return nil, err
		}
	}
	return images, nil
}

func appendImageURLsFromRaw(images *[]string, raw json.RawMessage) error {
	trimmed := strings.TrimSpace(string(raw))
	if trimmed == "" || trimmed == "null" {
		return nil
	}
	var value any
	if err := common.Unmarshal(raw, &value); err != nil {
		return fmt.Errorf("decode image input: %w", err)
	}
	return appendImageURLs(images, value)
}

func appendImageURLs(images *[]string, value any) error {
	switch value := value.(type) {
	case nil:
		return nil
	case string:
		if strings.TrimSpace(value) == "" {
			return errors.New("image URL is empty")
		}
		*images = append(*images, value)
		return nil
	case []any:
		for _, item := range value {
			if err := appendImageURLs(images, item); err != nil {
				return err
			}
		}
		return nil
	case map[string]any:
		for _, key := range []string{"url", "image_url"} {
			if nested, ok := value[key]; ok {
				return appendImageURLs(images, nested)
			}
		}
		return errors.New("image object must contain url or image_url")
	default:
		return errors.New("image must be a URL, image object, or array")
	}
}

// MultipartImageHeaders returns the uploaded reference files of an image edit
// form in a stable order: `image`, `image[]`, then indexed `image[n]` keys.
func MultipartImageHeaders(form *multipart.Form) []*multipart.FileHeader {
	if form == nil {
		return nil
	}
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
