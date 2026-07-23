package controller

import (
	"testing"

	"github.com/QuantumNous/new-api/service"
	"github.com/stretchr/testify/assert"
)

func TestSelectToolModelUsesEnabledDeterministicPriority(t *testing.T) {
	tests := []struct {
		name     string
		models   []string
		action   string
		expected string
	}{
		{"image primary", []string{"grok-imagine-image", "gpt-image-2"}, service.PlaygroundToolImage, "gpt-image-2"},
		{"image secondary", []string{"flux-pro", "grok-imagine-image"}, service.PlaygroundToolImage, "grok-imagine-image"},
		{"video primary", []string{"grok-imagine-video-1.5", "grok-imagine-video"}, service.PlaygroundToolVideo, "grok-imagine-video"},
		{"video secondary", []string{"veo-3", "grok-imagine-video-1.5"}, service.PlaygroundToolVideo, "grok-imagine-video-1.5"},
		{"deterministic fallback", []string{"video-z", "video-a"}, service.PlaygroundToolVideo, "video-a"},
		{"does not select disabled priority", []string{"flux-pro"}, service.PlaygroundToolImage, "flux-pro"},
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
