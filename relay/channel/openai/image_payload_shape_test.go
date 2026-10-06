package openai

import (
	"strings"
	"testing"

	"github.com/gin-gonic/gin"
	"github.com/stretchr/testify/assert"
	"github.com/stretchr/testify/require"
)

// TestOpenaiImagePayloadShapesBillDeliveredImages covers object-shaped data,
// payload-less data and mixed url/b64_json arrays for both the JSON handler
// and the JSON-to-SSE fallback. Billing follows delivered image payloads; a
// zero count keeps the pre-consumed requested n.
func TestOpenaiImagePayloadShapesBillDeliveredImages(t *testing.T) {
	oldMode := gin.Mode()
	gin.SetMode(gin.TestMode)
	t.Cleanup(func() { gin.SetMode(oldMode) })

	const (
		urlA = `{"url":"https://example.com/a.png"}`
		urlB = `{"url":"https://example.com/b.png"}`
		b64A = `{"b64_json":"aaaa"}`
		b64B = `{"b64_json":"bbbb"}`
	)
	for _, tc := range []struct {
		name       string
		body       string
		requested  float64
		wantN      float64
		wantEvents int
	}{
		{"object data with url and b64_json is one image", `{"data":{"url":"https://example.com/a.png","b64_json":"aaaa"}}`, 3, 1, 1},
		{"object data without payload keeps requested", `{"data":{"revised_prompt":"cat"}}`, 3, 3, 0},
		{"empty array keeps requested", `{"data":[]}`, 3, 3, 0},
		{"null data keeps requested", `{"data":null}`, 3, 3, 0},
		{"scalar data keeps requested", `{"data":"https://example.com/a.png"}`, 3, 3, 0},
		{"blank and non-string payloads keep requested", `{"data":[{"url":""},{"b64_json":"  "},{"url":7},null]}`, 2, 2, 0},
		{"split url and b64_json beyond request bills one image", `{"data":[` + urlA + `,` + b64A + `]}`, 1, 1, 2},
		{"mixed entries within request are distinct images", `{"data":[` + urlA + `,` + b64B + `]}`, 2, 2, 2},
		{"two split images beyond request bill two", `{"data":[` + urlA + `,` + b64A + `,` + urlB + `,` + b64B + `]}`, 3, 2, 4},
		{"four mixed entries within request bill four", `{"data":[` + urlA + `,` + b64A + `,` + urlB + `,` + b64B + `]}`, 4, 4, 4},
		{"combined entry plus split pair beyond request", `{"data":[{"url":"https://example.com/c.png","b64_json":"cccc"},` + urlA + `,` + b64A + `]}`, 1, 2, 3},
		{"single format beyond request bills actual entries", `{"data":[` + urlA + `,` + urlB + `]}`, 1, 2, 2},
	} {
		for _, stream := range []bool{false, true} {
			name := tc.name + "/json"
			if stream {
				name = tc.name + "/sse_fallback"
			}
			t.Run(name, func(t *testing.T) {
				c, recorder, resp, info := newImageTestContext(t, tc.body, "application/json", stream)
				info.PriceData.UsePrice = true
				info.PriceData.AddOtherRatio("n", tc.requested)
				handler := OpenaiImageHandler
				if stream {
					handler = OpenaiImageStreamHandler
				}

				_, err := handler(c, info, resp)
				require.Nil(t, err)
				assert.Equal(t, tc.wantN, info.PriceData.OtherRatios()["n"])
				out := recorder.Body.String()
				if !stream {
					assert.Equal(t, tc.body, out)
					return
				}
				assert.Equal(t, tc.wantEvents, strings.Count(out, "event: image_generation.completed"))
				assert.Equal(t, tc.wantEvents, info.ReceivedResponseCount)
				assert.True(t, strings.HasSuffix(out, "data: [DONE]\n\n"))
			})
		}
	}
}

func TestOpenaiImageObjectDataForwardedAsSSE(t *testing.T) {
	body := `{"created":1,"data":{"url":"https://example.com/a.png","b64_json":"aaaa","revised_prompt":"cat"}}`
	c, recorder, resp, info := newImageTestContext(t, body, "application/json", true)
	_, err := OpenaiImageStreamHandler(c, info, resp)
	require.Nil(t, err)
	out := recorder.Body.String()
	for _, want := range []string{`"url":"https://example.com/a.png"`, `"b64_json":"aaaa"`, `"revised_prompt":"cat"`, `"created_at":1`} {
		assert.Contains(t, out, want)
	}
}

func TestOpenaiImageMalformedBodyKeepsRequestedCount(t *testing.T) {
	for _, stream := range []bool{false, true} {
		c, _, resp, info := newImageTestContext(t, `{"data":[{"url":"https://example.com/a.png"}`, "application/json", stream)
		info.PriceData.UsePrice = true
		info.PriceData.AddOtherRatio("n", 3)
		handler := OpenaiImageHandler
		if stream {
			handler = OpenaiImageStreamHandler
		}
		_, err := handler(c, info, resp)
		require.NotNil(t, err)
		assert.Equal(t, 3.0, info.PriceData.OtherRatios()["n"])
	}
}
