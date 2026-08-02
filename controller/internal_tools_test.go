package controller

import (
	"bytes"
	"encoding/json"
	"net/http"
	"net/http/httptest"
	"testing"

	"github.com/dev-fan-sophon/boxai/common"
	"github.com/dev-fan-sophon/boxai/constant"
	"github.com/dev-fan-sophon/boxai/dto"
	"github.com/dev-fan-sophon/boxai/model"
	"github.com/dev-fan-sophon/boxai/service"
	"github.com/gin-gonic/gin"
	"github.com/glebarez/sqlite"
	"github.com/stretchr/testify/assert"
	"github.com/stretchr/testify/require"
	"gorm.io/gorm"
)

func TestInternalSelectToolModelUsesEnabledDeterministicPriority(t *testing.T) {
	tests := []struct {
		name     string
		models   []string
		action   string
		expected string
	}{
		{"image prefers gpt-image-2 over grok", []string{"grok-imagine-image", "gpt-image-2"}, service.PlaygroundToolImage, "gpt-image-2"},
		{"image prefers bare gpt-image-2 over suffix", []string{"gpt-image-2-mini", "gpt-image-2"}, service.PlaygroundToolImage, "gpt-image-2"},
		{"image accepts vendor-prefixed gpt-image-2", []string{"openai/gpt-image-2"}, service.PlaygroundToolImage, "openai/gpt-image-2"},
		{"image falls back to grok-imagine-image", []string{"flux-pro", "grok-imagine-image", "dall-e-3"}, service.PlaygroundToolImage, "grok-imagine-image"},
		{"image prefers grok pro over base", []string{"grok-imagine-image", "grok-imagine-image-pro"}, service.PlaygroundToolImage, "grok-imagine-image-pro"},
		{"image rejects non GPT-format families", []string{"flux-pro", "dall-e-3", "gpt-image-1", "imagen-3"}, service.PlaygroundToolImage, ""},
		{"video primary", []string{"grok-imagine-video-1.5", "grok-imagine-video"}, service.PlaygroundToolVideo, "grok-imagine-video"},
		{"video skips image-only xAI 1.5", []string{"veo-3", "grok-imagine-video-1.5"}, service.PlaygroundToolVideo, "veo-3"},
		{"video falls back to text-capable seedance", []string{"grok-imagine-video-1.5", "seedance-2-0-fast", "seedance-2-0"}, service.PlaygroundToolVideo, "seedance-2-0"},
		{"video rejects image-only xAI 1.5 alone", []string{"grok-imagine-video-1.5"}, service.PlaygroundToolVideo, ""},
		{"deterministic fallback", []string{"video-z", "video-a"}, service.PlaygroundToolVideo, "video-a"},
		{"no media model", []string{"gpt-5"}, service.PlaygroundToolImage, ""},
		{"search primary", []string{"grok-4.3", "grok-4.5"}, service.PlaygroundToolSearch, "grok-4.5"},
		{"search secondary", []string{"gpt-5", "grok-4.3"}, service.PlaygroundToolSearch, "grok-4.3"},
		{"search deterministic fallback", []string{"grok-4-z", "grok-4-a"}, service.PlaygroundToolSearch, "grok-4-a"},
		{"search excludes media", []string{"grok-4-video", "grok-imagine-image"}, service.PlaygroundToolSearch, ""},
	}
	for _, tt := range tests {
		t.Run(tt.name, func(t *testing.T) {
			assert.Equal(t, tt.expected, selectToolModel(tt.models, tt.action))
		})
	}
}

func TestInternalManagedSearchTerminalResult(t *testing.T) {
	status := json.RawMessage(`"completed"`)
	response := &dto.OpenAIResponsesResponse{
		Status: status,
		Output: []dto.ResponsesOutput{{
			Content: []dto.ResponsesOutputContent{{
				Type: "output_text", Text: " answer ",
				Annotations: []any{
					map[string]any{"url": "https://example.com/a#one", "title": " Example "},
					map[string]any{"url": "https://example.com/a#two"},
					map[string]any{"url": "https://news.example.org/story", "title": "[2]"},
					map[string]any{"url": "javascript:alert(1)"},
				},
			}},
		}},
	}

	result, sources, err := managedSearchTerminalResult(response)

	require.NoError(t, err)
	assert.Equal(t, "answer", result["text"])
	require.Len(t, sources, 2)
	assert.Equal(t, "https://example.com/a", sources[0]["href"])
	assert.Equal(t, "news.example.org", sources[1]["title"])

	response.Output[0].Content[0].Text = ""
	_, _, err = managedSearchTerminalResult(response)
	assert.Error(t, err)
}

func TestPrepareInternalPlaygroundSearchUsesResponsesRelayPath(t *testing.T) {
	db, err := gorm.Open(sqlite.Open("file:"+t.Name()+"?mode=memory&cache=shared"), &gorm.Config{})
	require.NoError(t, err)
	require.NoError(t, db.AutoMigrate(&model.Channel{}, &model.Ability{}))
	oldDB := model.DB
	model.DB = db
	t.Cleanup(func() { model.DB = oldDB })

	channel := &model.Channel{Id: 19, Type: constant.ChannelTypeOpenAI, Name: "grok", Status: common.ChannelStatusEnabled}
	require.NoError(t, db.Create(channel).Error)
	require.NoError(t, db.Create(&model.Ability{Group: "default", Model: "grok-4.5", ChannelId: channel.Id, Enabled: true}).Error)

	observedPath := ""
	router := gin.New()
	router.POST("/pg/internal/search",
		func(c *gin.Context) {
			c.Set("id", 7)
			c.Set("group", "default")
			c.Next()
		},
		PrepareInternalPlaygroundSearch(),
		func(c *gin.Context) {
			observedPath = c.Request.URL.Path
			c.Status(http.StatusNoContent)
		},
	)
	request := httptest.NewRequest(http.MethodPost, "/pg/internal/search", bytes.NewBufferString(`{"query":"latest news","group":"default"}`))
	request.Header.Set("Content-Type", "application/json")
	recorder := httptest.NewRecorder()

	router.ServeHTTP(recorder, request)

	assert.Equal(t, http.StatusNoContent, recorder.Code)
	assert.Equal(t, "/pg/responses", observedPath)
	assert.Equal(t, "/pg/internal/search", request.URL.Path)
}
