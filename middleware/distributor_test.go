package middleware

import (
	"bytes"
	"net/http"
	"net/http/httptest"
	"testing"

	"github.com/dev-fan-sophon/boxai/common"
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
	}
	for _, test := range tests {
		t.Run(test.name, func(t *testing.T) {
			ctx, _ := gin.CreateTestContext(httptest.NewRecorder())
			ctx.Request = httptest.NewRequest(http.MethodPost, test.path, bytes.NewBufferString(test.body))
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
