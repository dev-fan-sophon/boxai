package sora

import (
	"io"
	"net/http"
	"net/http/httptest"
	"strings"
	"testing"

	"github.com/dev-fan-sophon/boxai/common"
	"github.com/dev-fan-sophon/boxai/constant"
	relaycommon "github.com/dev-fan-sophon/boxai/relay/common"
	"github.com/gin-gonic/gin"
	"github.com/stretchr/testify/assert"
	"github.com/stretchr/testify/require"
)

const seedance20Upstream = "doubao-seedance-2-0-260128"

func decodeBody(t *testing.T, raw string) map[string]interface{} {
	t.Helper()
	var body map[string]interface{}
	require.NoError(t, common.UnmarshalJsonStr(raw, &body))
	return body
}

func imageContent(url, role string) map[string]interface{} {
	item := map[string]interface{}{
		"type":      "image_url",
		"image_url": map[string]interface{}{"url": url},
	}
	if role != "" {
		item["role"] = role
	}
	return item
}

func TestNormalizeSeedancePassthroughBody(t *testing.T) {
	tests := []struct {
		name         string
		model        string
		body         string
		wantErr      string
		wantSeconds  interface{}
		wantMetadata map[string]interface{}
		removedKeys  []string
	}{
		{
			name:        "duration becomes seconds and size becomes resolution and ratio",
			model:       seedance20Upstream,
			body:        `{"prompt":"a cat","duration":8,"size":"1920x1080"}`,
			wantSeconds: "8",
			wantMetadata: map[string]interface{}{
				"resolution": "1080p",
				"ratio":      "16:9",
			},
		},
		{
			name:        "explicit seconds and metadata win over derived values",
			model:       seedance20Upstream,
			body:        `{"prompt":"a cat","duration":8,"seconds":"5","size":"1280x720","metadata":{"resolution":"480p","ratio":"21:9","generate_audio":false}}`,
			wantSeconds: "5",
			wantMetadata: map[string]interface{}{
				"resolution":     "480p",
				"ratio":          "21:9",
				"generate_audio": false,
			},
		},
		{
			name:  "first and last frame aliases become role content and aliases are stripped",
			model: seedance20Upstream,
			body: `{"prompt":"a cat","first_frame":"https://img/first.png","last_frame":"https://img/last.png",
				"input_reference":"https://img/first.png","image":"https://img/first.png","images":["https://img/first.png","https://img/last.png"]}`,
			wantMetadata: map[string]interface{}{
				"content": []interface{}{
					imageContent("https://img/first.png", "first_frame"),
					imageContent("https://img/last.png", "last_frame"),
				},
			},
			removedKeys: []string{"first_frame", "last_frame", "input_reference", "image", "images"},
		},
		{
			name:  "single first frame keeps the optional role empty",
			model: seedance20Upstream,
			body:  `{"prompt":"a cat","first_frame":"https://img/first.png","images":["https://img/first.png"]}`,
			wantMetadata: map[string]interface{}{
				"content": []interface{}{imageContent("https://img/first.png", "")},
			},
			removedKeys: []string{"first_frame", "images"},
		},
		{
			name:  "plain images are reference images on seedance 2",
			model: seedance20Upstream,
			body:  `{"prompt":"a cat","images":["https://img/a.png","https://img/b.png","https://img/c.png"]}`,
			wantMetadata: map[string]interface{}{
				"content": []interface{}{
					imageContent("https://img/a.png", "reference_image"),
					imageContent("https://img/b.png", "reference_image"),
					imageContent("https://img/c.png", "reference_image"),
				},
			},
			removedKeys: []string{"images"},
		},
		{
			name:  "a lone image on seedance 1.x is the first frame",
			model: "doubao-seedance-1-0-lite-i2v",
			body:  `{"prompt":"a cat","images":["https://img/a.png"]}`,
			wantMetadata: map[string]interface{}{
				"content": []interface{}{imageContent("https://img/a.png", "")},
			},
			removedKeys: []string{"images"},
		},
		{
			name:  "caller supplied metadata content is forwarded untouched and aliases are dropped",
			model: seedance20Upstream,
			body:  `{"prompt":"a cat","images":["https://img/dup.png"],"metadata":{"content":[{"type":"image_url","image_url":{"url":"https://img/dup.png"},"role":"reference_image"}]}}`,
			wantMetadata: map[string]interface{}{
				"content": []interface{}{imageContent("https://img/dup.png", "reference_image")},
			},
			removedKeys: []string{"images"},
		},
		{
			name:    "reference images cannot be combined with frames",
			model:   seedance20Upstream,
			body:    `{"prompt":"a cat","first_frame":"https://img/first.png","images":["https://img/first.png","https://img/ref.png"]}`,
			wantErr: "cannot be combined",
		},
		{
			name:    "seedance 2.0 allows at most nine reference images",
			model:   seedance20Upstream,
			body:    `{"prompt":"a cat","images":["1","2","3","4","5","6","7","8","9","10"]}`,
			wantErr: "at most 9",
		},
		{
			name:  "seedance 2.5 allows more than nine reference images",
			model: "dreamina-seedance-2-5-260628",
			body:  `{"prompt":"a cat","images":["1","2","3","4","5","6","7","8","9","10"]}`,
			wantMetadata: map[string]interface{}{
				"content": []interface{}{
					imageContent("1", "reference_image"), imageContent("2", "reference_image"),
					imageContent("3", "reference_image"), imageContent("4", "reference_image"),
					imageContent("5", "reference_image"), imageContent("6", "reference_image"),
					imageContent("7", "reference_image"), imageContent("8", "reference_image"),
					imageContent("9", "reference_image"), imageContent("10", "reference_image"),
				},
			},
			removedKeys: []string{"images"},
		},
		{
			name:    "last frame without first frame is rejected",
			model:   seedance20Upstream,
			body:    `{"prompt":"a cat","last_frame":"https://img/last.png"}`,
			wantErr: "last_frame requires first_frame",
		},
	}

	for _, tt := range tests {
		t.Run(tt.name, func(t *testing.T) {
			body := decodeBody(t, tt.body)
			err := normalizeSeedancePassthroughBody(body, tt.model)
			if tt.wantErr != "" {
				require.ErrorContains(t, err, tt.wantErr)
				return
			}
			require.NoError(t, err)
			if tt.wantSeconds != nil {
				assert.Equal(t, tt.wantSeconds, body["seconds"])
			}
			assert.Equal(t, tt.wantMetadata, body["metadata"])
			for _, key := range tt.removedKeys {
				assert.NotContains(t, body, key)
			}
		})
	}
}

func TestSeedanceOutputFromSize(t *testing.T) {
	tests := []struct {
		size           string
		wantResolution string
		wantRatio      string
	}{
		{"1280x720", "720p", "16:9"},
		{"720x1280", "720p", "9:16"},
		{"1920x1080", "1080p", "16:9"},
		{"1080x1920", "1080p", "9:16"},
		{"864x480", "480p", "16:9"},
		{"960x720", "720p", "4:3"},
		{"720x960", "720p", "3:4"},
		{"1080x1080", "1080p", "1:1"},
		{"1680x720", "720p", "21:9"},
		{"", "", ""},
		{"auto", "", ""},
	}
	for _, tt := range tests {
		t.Run(tt.size, func(t *testing.T) {
			resolution, ratio := seedanceOutputFromSize(tt.size)
			assert.Equal(t, tt.wantResolution, resolution)
			assert.Equal(t, tt.wantRatio, ratio)
		})
	}
}

func TestEstimateBillingAddsSeedanceResolutionRatio(t *testing.T) {
	gin.SetMode(gin.TestMode)
	tests := []struct {
		name  string
		model string
		req   relaycommon.TaskSubmitReq
		want  map[string]float64
	}{
		{
			name:  "720p seedance keeps the per-second base price",
			model: seedance20Upstream,
			req:   relaycommon.TaskSubmitReq{Seconds: "5", Metadata: map[string]interface{}{"resolution": "720p"}},
			want:  map[string]float64{"seconds": 5, "size": 1},
		},
		{
			name:  "1080p seedance is surcharged",
			model: seedance20Upstream,
			req:   relaycommon.TaskSubmitReq{Duration: 10, Metadata: map[string]interface{}{"resolution": "1080p"}},
			want:  map[string]float64{"seconds": 10, "size": 1, "resolution": 2.5},
		},
		{
			name:  "480p seedance is discounted",
			model: seedance20Upstream,
			req:   relaycommon.TaskSubmitReq{Duration: 5, Metadata: map[string]interface{}{"resolution": "480p"}},
			want:  map[string]float64{"seconds": 5, "size": 1, "resolution": 0.45},
		},
		{
			name:  "resolution is derived from size when metadata is absent",
			model: seedance20Upstream,
			req:   relaycommon.TaskSubmitReq{Duration: 5, Size: "1920x1080"},
			want:  map[string]float64{"seconds": 5, "size": 1, "resolution": 2.5},
		},
		{
			name:  "non seedance models ignore resolution metadata",
			model: "sora-2",
			req:   relaycommon.TaskSubmitReq{Duration: 5, Size: "1280x720", Metadata: map[string]interface{}{"resolution": "1080p"}},
			want:  map[string]float64{"seconds": 5, "size": 1},
		},
	}
	for _, tt := range tests {
		t.Run(tt.name, func(t *testing.T) {
			c, _ := gin.CreateTestContext(httptest.NewRecorder())
			c.Set("task_request", tt.req)
			info := &relaycommon.RelayInfo{
				TaskRelayInfo: &relaycommon.TaskRelayInfo{Action: constant.TaskActionGenerate},
				ChannelMeta:   &relaycommon.ChannelMeta{UpstreamModelName: tt.model},
			}
			assert.Equal(t, tt.want, (&TaskAdaptor{}).EstimateBilling(c, info))
		})
	}
}

func newJSONTaskContext(t *testing.T, body string) *gin.Context {
	t.Helper()
	request := httptest.NewRequest(http.MethodPost, "/v1/videos", strings.NewReader(body))
	request.Header.Set("Content-Type", "application/json")
	c, _ := gin.CreateTestContext(httptest.NewRecorder())
	c.Request = request
	storage, err := common.CreateBodyStorage([]byte(body))
	require.NoError(t, err)
	c.Set(common.KeyBodyStorage, storage)
	return c
}

func TestValidateMappedRequestRejectsInvalidSeedanceReferences(t *testing.T) {
	gin.SetMode(gin.TestMode)
	c := newJSONTaskContext(t, `{"model":"seedance-2-0","prompt":"a cat","first_frame":"https://img/first.png","images":["https://img/first.png","https://img/ref.png"]}`)
	info := &relaycommon.RelayInfo{
		TaskRelayInfo: &relaycommon.TaskRelayInfo{Action: constant.TaskActionGenerate},
		ChannelMeta:   &relaycommon.ChannelMeta{UpstreamModelName: seedance20Upstream},
	}

	taskErr := (&TaskAdaptor{}).ValidateMappedRequest(c, info)

	require.NotNil(t, taskErr)
	assert.Equal(t, http.StatusBadRequest, taskErr.StatusCode)
	assert.True(t, taskErr.LocalError)

	info.ChannelMeta.UpstreamModelName = "sora-2"
	assert.Nil(t, (&TaskAdaptor{}).ValidateMappedRequest(c, info), "non seedance models are not validated")
}

func TestBuildRequestBodyRewritesSeedancePassthrough(t *testing.T) {
	gin.SetMode(gin.TestMode)
	c := newJSONTaskContext(t, `{"model":"seedance-2-0","group":"default","prompt":"a cat","duration":5,"size":"720x1280",
		"images":["https://img/a.png","https://img/b.png"],"metadata":{"generate_audio":true}}`)
	info := &relaycommon.RelayInfo{
		TaskRelayInfo: &relaycommon.TaskRelayInfo{Action: constant.TaskActionGenerate},
		ChannelMeta:   &relaycommon.ChannelMeta{UpstreamModelName: seedance20Upstream},
	}

	reader, err := (&TaskAdaptor{}).BuildRequestBody(c, info)
	require.NoError(t, err)
	raw, err := io.ReadAll(reader)
	require.NoError(t, err)
	body := decodeBody(t, string(raw))

	assert.Equal(t, seedance20Upstream, body["model"])
	assert.Equal(t, "5", body["seconds"])
	assert.NotContains(t, body, "images")
	assert.Equal(t, map[string]interface{}{
		"generate_audio": true,
		"resolution":     "720p",
		"ratio":          "9:16",
		"content": []interface{}{
			imageContent("https://img/a.png", "reference_image"),
			imageContent("https://img/b.png", "reference_image"),
		},
	}, body["metadata"])
}

func TestBuildRequestBodyLeavesNonSeedancePassthroughUntouched(t *testing.T) {
	gin.SetMode(gin.TestMode)
	c := newJSONTaskContext(t, `{"model":"sora-2","prompt":"a cat","seconds":"4","size":"1280x720","input_reference":"https://img/a.png"}`)
	info := &relaycommon.RelayInfo{
		TaskRelayInfo: &relaycommon.TaskRelayInfo{Action: constant.TaskActionGenerate},
		ChannelMeta:   &relaycommon.ChannelMeta{UpstreamModelName: "sora-2"},
	}

	reader, err := (&TaskAdaptor{}).BuildRequestBody(c, info)
	require.NoError(t, err)
	raw, err := io.ReadAll(reader)
	require.NoError(t, err)
	body := decodeBody(t, string(raw))

	assert.Equal(t, "https://img/a.png", body["input_reference"])
	assert.NotContains(t, body, "metadata")
}
