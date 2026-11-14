package middleware

import (
	"bytes"
	"io"
	"net/http"
	"net/http/httptest"
	"strings"
	"testing"
	"testing/iotest"

	"github.com/dev-fan-sophon/boxai/common"
	"github.com/dev-fan-sophon/boxai/constant"
	appI18n "github.com/dev-fan-sophon/boxai/i18n"
	"github.com/gin-gonic/gin"
	"github.com/stretchr/testify/assert"
	"github.com/stretchr/testify/require"
)

func TestResponsesCompactSelectsChannelWithRequestedModelName(t *testing.T) {
	gin.SetMode(gin.TestMode)
	ctx, _ := gin.CreateTestContext(httptest.NewRecorder())
	ctx.Request = httptest.NewRequest(
		http.MethodPost,
		"/v1/responses/compact",
		bytes.NewBufferString(`{"model":"gpt-5.4"}`),
	)
	ctx.Request.Header.Set("Content-Type", "application/json")
	t.Cleanup(func() { common.CleanupBodyStorage(ctx) })

	request, shouldSelectChannel, err := getModelRequest(ctx)

	require.NoError(t, err)
	require.NotNil(t, request)
	assert.True(t, shouldSelectChannel)
	assert.Equal(t, "gpt-5.4", request.Model)
}

func TestElevenLabsNativeRoutesSelectCapabilityModel(t *testing.T) {
	gin.SetMode(gin.TestMode)
	tests := []struct {
		name        string
		method      string
		path        string
		contentType string
		body        string
		wantModel   string
	}{
		{
			name:        "canonical JSON route honors explicit model",
			path:        "/elevenlabs/v1/text-to-speech/voice-id/stream",
			contentType: "application/json",
			body:        `{"model_id":"eleven_v3","text":"hello"}`,
			wantModel:   "eleven_v3",
		},
		{
			name:        "bare alias uses endpoint capability model",
			path:        "/v1/sound-generation",
			contentType: "application/json",
			body:        `{"prompt":"rain"}`,
			wantModel:   "eleven_text_to_sound_v2",
		},
		{
			name:        "playground route reads the JSON model",
			path:        "/pg/elevenlabs/v1/music",
			contentType: "application/json",
			body:        `{"model_id":"music_v2","prompt":"lofi"}`,
			wantModel:   "music_v2",
		},
		{
			name:      "playground voice library is free and model-less",
			method:    http.MethodGet,
			path:      "/pg/elevenlabs/v2/voices",
			wantModel: "eleven_v3",
		},
	}
	for _, test := range tests {
		t.Run(test.name, func(t *testing.T) {
			ctx, _ := gin.CreateTestContext(httptest.NewRecorder())
			method := test.method
			if method == "" {
				method = http.MethodPost
			}
			ctx.Request = httptest.NewRequest(method, test.path, bytes.NewBufferString(test.body))
			ctx.Request.Header.Set("Content-Type", test.contentType)
			t.Cleanup(func() { common.CleanupBodyStorage(ctx) })

			request, shouldSelectChannel, err := getModelRequest(ctx)

			require.NoError(t, err)
			require.NotNil(t, request)
			assert.True(t, shouldSelectChannel)
			assert.Equal(t, test.wantModel, request.Model)
		})
	}
}

func TestElevenLabsNativeRoutesRejectNonAllowlistedEndpoint(t *testing.T) {
	gin.SetMode(gin.TestMode)
	ctx, _ := gin.CreateTestContext(httptest.NewRecorder())
	ctx.Request = httptest.NewRequest(http.MethodGet, "/elevenlabs/v1/history", nil)

	request, shouldSelectChannel, err := getModelRequest(ctx)

	require.Error(t, err)
	assert.Nil(t, request)
	assert.False(t, shouldSelectChannel)
}

func TestDistributeReportsRequestBodyFailureCause(t *testing.T) {
	gin.SetMode(gin.TestMode)
	require.NoError(t, appI18n.Init())
	previous := constant.MaxRequestBodyMB
	constant.MaxRequestBodyMB = 1
	t.Cleanup(func() { constant.MaxRequestBodyMB = previous })

	router := gin.New()
	router.POST("/v1/chat/completions", Distribute(), func(c *gin.Context) {
		c.Status(http.StatusNoContent)
	})
	for _, tc := range []struct {
		name    string
		body    io.Reader
		status  int
		message string
	}{
		{
			name:    "oversized body",
			body:    strings.NewReader(`{"model":"gpt-x","input":"` + strings.Repeat("a", 1<<20) + `"}`),
			status:  http.StatusRequestEntityTooLarge,
			message: "Invalid request: request body exceeds 1 MB: request body too large",
		},
		{
			name:    "body cut off mid-upload",
			body:    io.MultiReader(strings.NewReader(`{"model":"gpt-x","input":"`), iotest.ErrReader(io.ErrUnexpectedEOF)),
			status:  http.StatusBadRequest,
			message: "Invalid request: unexpected EOF",
		},
		{
			name:    "invalid JSON is prefixed once",
			body:    strings.NewReader(`{"model":"gpt-x",`),
			status:  http.StatusBadRequest,
			message: "Invalid request: invalid JSON request body",
		},
	} {
		t.Run(tc.name, func(t *testing.T) {
			request := httptest.NewRequest(http.MethodPost, "/v1/chat/completions", tc.body)
			request.Header.Set("Content-Type", "application/json")
			recorder := httptest.NewRecorder()

			router.ServeHTTP(recorder, request)

			assert.Equal(t, tc.status, recorder.Code)
			assert.Contains(t, recorder.Body.String(), `"message":"`+tc.message)
			assert.NotContains(t, recorder.Body.String(), "Invalid request: Invalid request")
		})
	}
}
