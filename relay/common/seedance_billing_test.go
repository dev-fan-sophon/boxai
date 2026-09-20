package common

import (
	"testing"

	"github.com/stretchr/testify/assert"
)

func TestSeedanceOutputFromSize(t *testing.T) {
	resolution, ratio := SeedanceOutputFromSize("1920x1080")
	assert.Equal(t, "1080p", resolution)
	assert.Equal(t, "16:9", ratio)

	resolution, ratio = SeedanceOutputFromSize("720x1280")
	assert.Equal(t, "720p", resolution)
	assert.Equal(t, "9:16", ratio)
}

func TestResolveSeedanceDurationAndResolution(t *testing.T) {
	assert.Equal(t, 30, ResolveSeedanceDurationSeconds("30", 0))
	assert.Equal(t, 8, ResolveSeedanceDurationSeconds("", 8))
	assert.Equal(t, SeedanceDefaultDurationSeconds, ResolveSeedanceDurationSeconds("", 0))
	assert.Equal(t, MaxTaskDurationSeconds, ResolveSeedanceDurationSeconds("99999", 0))

	assert.Equal(t, "1080p", ResolveSeedanceResolution("1080p", "720x1280"))
	assert.Equal(t, "1080p", ResolveSeedanceResolution("", "1920x1080"))
	assert.Equal(t, "720p", ResolveSeedanceResolution("", ""))
}

func TestSeedanceResolutionRatio(t *testing.T) {
	assert.Equal(t, 0.45, SeedanceResolutionRatio("480p"))
	assert.Equal(t, 1.0, SeedanceResolutionRatio("720p"))
	assert.Equal(t, 2.5, SeedanceResolutionRatio("1080p"))
	assert.Equal(t, 1.0, SeedanceResolutionRatio("unknown"))
}

func TestIsSeedanceModel(t *testing.T) {
	assert.True(t, IsSeedanceModel("dreamina-seedance-2-5"))
	assert.True(t, IsSeedanceModel("doubao-seedance-2-0-260128"))
	assert.False(t, IsSeedanceModel("sora-2"))
	assert.True(t, SeedanceRequiresPerSecondPrice("dreamina-seedance-2-5"))
	assert.False(t, SeedanceRequiresPerSecondPrice("sora-2"))
}
