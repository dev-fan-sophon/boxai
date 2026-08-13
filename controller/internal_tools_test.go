package controller

import (
	"testing"

	"github.com/dev-fan-sophon/boxai/service"
	"github.com/stretchr/testify/assert"
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
	}
	for _, tt := range tests {
		t.Run(tt.name, func(t *testing.T) {
			assert.Equal(t, tt.expected, selectToolModel(tt.models, tt.action))
		})
	}
}
