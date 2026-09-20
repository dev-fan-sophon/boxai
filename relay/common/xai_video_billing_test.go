package common

import (
	"testing"

	"github.com/stretchr/testify/assert"
)

func TestIsGrokImagineVideoModel(t *testing.T) {
	assert.True(t, IsGrokImagineVideoModel("grok-imagine-video"))
	assert.True(t, IsGrokImagineVideoModel("grok-imagine-video-1.5"))
	assert.True(t, IsGrokImagineVideoModel("Grok-Imagine-Video-1.5"))
	assert.False(t, IsGrokImagineVideoModel("grok-imagine-image-2.0"))
	assert.False(t, IsGrokImagineVideoModel("grok-4.6"))
}

func TestGrokImagineResolutionFromSize(t *testing.T) {
	assert.Equal(t, "720p", GrokImagineResolutionFromSize(""))
	assert.Equal(t, "720p", GrokImagineResolutionFromSize("1280x720"))
	assert.Equal(t, "720p", GrokImagineResolutionFromSize("720x1280"))
	assert.Equal(t, "1080p", GrokImagineResolutionFromSize("1920x1080"))
	assert.Equal(t, "1080p", GrokImagineResolutionFromSize("1080x1920"))
	assert.Equal(t, "", GrokImagineResolutionFromSize("1024x1024"))
}

func TestGrokImagineResolutionRatio(t *testing.T) {
	assert.Equal(t, 1.75, GrokImagineResolutionRatio("grok-imagine-video-1.5", "720p"))
	assert.Equal(t, 3.125, GrokImagineResolutionRatio("grok-imagine-video-1.5", "1080p"))
	assert.Equal(t, 1.0, GrokImagineResolutionRatio("grok-imagine-video-1.5", "480p"))
	assert.Equal(t, 1.4, GrokImagineResolutionRatio("grok-imagine-video", "720p"))
	assert.Equal(t, 1.0, GrokImagineResolutionRatio("grok-imagine-video", "480p"))
	assert.Equal(t, 1.0, GrokImagineResolutionRatio("grok-4.6", "720p"))
}
