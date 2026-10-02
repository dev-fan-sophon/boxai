package service

import (
	"testing"

	"github.com/dev-fan-sophon/boxai/common"
	"github.com/dev-fan-sophon/boxai/constant"
	"github.com/dev-fan-sophon/boxai/dto"
	"github.com/dev-fan-sophon/boxai/model"
	"github.com/glebarez/sqlite"
	"github.com/stretchr/testify/assert"
	"github.com/stretchr/testify/require"
	"gorm.io/gorm"
)

func TestMappedVideoModelChainsAndCycles(t *testing.T) {
	mapped, err := mappedVideoModel(`{"public":"alias","alias":"seedance-2-5"}`, "public")
	require.NoError(t, err)
	assert.Equal(t, "seedance-2-5", mapped)
	_, err = mappedVideoModel(`{"a":"b","b":"a"}`, "a")
	require.Error(t, err)
}

func TestSeedanceModeProfiles(t *testing.T) {
	profiles := profilesForChannel(&model.Channel{Type: constant.ChannelTypeSora}, "seedance-2-5")
	require.Contains(t, profiles, "frames")
	assert.Equal(t, []string{"adaptive"}, profiles["frames"].AspectRatios)
	assert.Contains(t, profiles["references"].AspectRatios, "16:9")
	assert.Equal(t, 30, profiles["references"].MaxReferenceImages)
	assert.Equal(t, 30, profiles["text"].DurationRange.Max)

	mini := profilesForChannel(&model.Channel{Type: constant.ChannelTypeSora}, "seedance-2-0-mini")
	assert.Equal(t, []string{"480p", "720p"}, mini["text"].Resolutions)
	assert.Equal(t, 15, mini["text"].DurationRange.Max)
}

func TestConfiguredVideoProfileOverridesNative(t *testing.T) {
	profile := dto.VideoModelCapabilities{Family: "generic", AspectRatios: []string{"1:1"}, ImageOnlyResolutions: []string{}}
	channel := &model.Channel{Type: constant.ChannelTypeXai}
	channel.SetSetting(dto.ChannelSettings{VideoCapabilities: map[string]map[string]dto.VideoModelCapabilities{"grok-imagine-video": {"text": profile}}})
	profiles := profilesForChannel(channel, "grok-imagine-video")
	assert.Equal(t, profile, profiles["text"])
	assert.NotContains(t, profiles, "frames")
}

func TestIntersectVideoProfileFailsClosedOnIncompatibleFamily(t *testing.T) {
	a := dto.VideoModelCapabilities{Family: "xai"}
	b := dto.VideoModelCapabilities{Family: "seedance-2"}
	_, ok := intersectVideoProfile(a, b)
	assert.False(t, ok)
}

func TestXaiVideoProfilesFollowModelVersion(t *testing.T) {
	channel := &model.Channel{Type: constant.ChannelTypeXai}
	allRatios := []string{"16:9", "9:16", "1:1", "4:3", "3:4", "3:2", "2:3"}

	legacy := profilesForChannel(channel, "grok-imagine-video")
	require.Contains(t, legacy, "text")
	assert.NotContains(t, legacy, "references")
	assert.Equal(t, []string{"480p", "720p"}, legacy["frames"].Resolutions)
	assert.Equal(t, allRatios, legacy["text"].AspectRatios)
	assert.False(t, legacy["frames"].SupportsLastFrame)
	assert.False(t, legacy["text"].SupportsAudioToggle)

	current := profilesForChannel(channel, "grok-imagine-video-1.5")
	require.Contains(t, current, "references")
	for _, mode := range []string{"text", "frames"} {
		assert.Equal(t, []string{"480p", "720p", "1080p"}, current[mode].Resolutions, mode)
		assert.Equal(t, allRatios, current[mode].AspectRatios, mode)
		assert.True(t, current[mode].SupportsAudioToggle, mode)
		assert.False(t, current[mode].RequiresImage, mode)
	}
	assert.True(t, current["frames"].SupportsLastFrame)
	references := current["references"]
	assert.Equal(t, 7, references.MaxReferenceImages)
	assert.Equal(t, []string{"480p", "720p"}, references.Resolutions, "reference-to-video is capped at 720p")
	assert.Zero(t, references.MaxReferenceVideos)
	assert.Zero(t, references.MaxReferenceAudios)
	assert.False(t, references.SupportsSeed)

	settings := dto.ChannelSettings{VideoCapabilities: map[string]map[string]dto.VideoModelCapabilities{"grok-imagine-video-1.5": current}}
	require.NoError(t, settings.ValidateVideoCapabilities(), "built-in xAI profiles must pass admin validation")
}

func TestSeedanceReferenceMediaProfiles(t *testing.T) {
	tests := []struct {
		model                       string
		images, videos, audios, max int
		audioNeedsVisual            bool
		resolutions                 []string
	}{
		{"seedance-2-0", 9, 3, 3, 15, true, []string{"480p", "720p", "1080p"}},
		{"seedance-2-0-fast", 9, 3, 3, 15, true, []string{"480p", "720p"}},
		{"seedance-2-0-mini", 9, 3, 3, 15, true, []string{"480p", "720p"}},
		{"dreamina-seedance-2-5", 30, 10, 10, 30, false, []string{"480p", "720p", "1080p"}},
	}
	for _, tt := range tests {
		t.Run(tt.model, func(t *testing.T) {
			for _, channelType := range []int{constant.ChannelTypeSora, constant.ChannelTypeDoubaoVideo} {
				profiles := profilesForChannel(&model.Channel{Type: channelType}, tt.model)
				references := profiles["references"]
				assert.Equal(t, tt.images, references.MaxReferenceImages)
				assert.Equal(t, tt.videos, references.MaxReferenceVideos)
				assert.Equal(t, tt.audios, references.MaxReferenceAudios)
				assert.Equal(t, tt.audioNeedsVisual, references.AudioReferenceRequiresVisual)
				for _, mode := range []string{"text", "frames"} {
					assert.Zero(t, profiles[mode].MaxReferenceVideos, mode)
					assert.Zero(t, profiles[mode].MaxReferenceAudios, mode)
				}
				for _, mode := range []string{"text", "frames", "references"} {
					p := profiles[mode]
					assert.Equal(t, dto.VideoDurationRange{Min: 4, Max: tt.max}, p.DurationRange, mode)
					assert.Equal(t, tt.resolutions, p.Resolutions, mode)
					assert.True(t, p.SupportsSeed && p.SupportsWatermark, mode)
					assert.False(t, p.ReturnsLastFrame, "relays may reject return_last_frame; channels opt in")
				}
				settings := dto.ChannelSettings{VideoCapabilities: map[string]map[string]dto.VideoModelCapabilities{tt.model: profiles}}
				require.NoError(t, settings.ValidateVideoCapabilities())
			}
		})
	}
}

func TestIntersectVideoProfileKeepsStricterReferenceMediaLimits(t *testing.T) {
	a := seedanceVideoProfiles("seedance-2-5")["references"]
	b := seedanceVideoProfiles("seedance-2-0")["references"]
	b.Family = a.Family
	b.SupportsSeed = false
	a.ReturnsLastFrame, b.ReturnsLastFrame = true, true
	merged, ok := intersectVideoProfile(a, b)
	require.True(t, ok)
	assert.Equal(t, 9, merged.MaxReferenceImages)
	assert.Equal(t, 3, merged.MaxReferenceVideos)
	assert.Equal(t, 3, merged.MaxReferenceAudios)
	assert.True(t, merged.AudioReferenceRequiresVisual)
	assert.False(t, merged.SupportsSeed)
	assert.True(t, merged.ReturnsLastFrame)
}

func TestResolveVideoCapabilitiesFromSQLiteRoutingCandidates(t *testing.T) {
	db, err := gorm.Open(sqlite.Open("file:"+t.Name()+"?mode=memory&cache=shared"), &gorm.Config{})
	require.NoError(t, err)
	require.NoError(t, db.AutoMigrate(&model.Channel{}, &model.Ability{}))
	oldDB := model.DB
	model.DB = db
	t.Cleanup(func() { model.DB = oldDB })
	mapping := `{"public-video":"doubao-seedance-2-5-260628"}`
	channels := []model.Channel{
		{Id: 1, Type: constant.ChannelTypeDoubaoVideo, Status: common.ChannelStatusEnabled, Key: "must-not-be-read", ModelMapping: &mapping},
		{Id: 2, Type: constant.ChannelTypeSora, Status: common.ChannelStatusEnabled, Key: "must-not-be-read", ModelMapping: &mapping},
		{Id: 3, Type: constant.ChannelTypeDoubaoVideo, Status: common.ChannelStatusManuallyDisabled, Key: "disabled", ModelMapping: &mapping},
	}
	require.NoError(t, db.Create(&channels).Error)
	require.NoError(t, db.Create(&[]model.Ability{
		{Group: "a", Model: "public-video", ChannelId: 1, Enabled: true},
		{Group: "b", Model: "public-video", ChannelId: 1, Enabled: true}, // same source through two groups
		{Group: "a", Model: "public-video", ChannelId: 2, Enabled: true},
		{Group: "a", Model: "public-video", ChannelId: 3, Enabled: true},
	}).Error)

	profiles, err := ResolveVideoCapabilities([]string{"b", "a"}, "public-video")
	require.NoError(t, err)
	require.Contains(t, profiles, "frames")
	assert.Equal(t, []string{"adaptive"}, profiles["frames"].AspectRatios)
	assert.NotNil(t, profiles["frames"].ImageOnlyResolutions)

	unknown := "unknown-upstream-version"
	require.NoError(t, db.Create(&model.Channel{Id: 4, Type: constant.ChannelTypeDoubaoVideo, Status: common.ChannelStatusEnabled, Key: "unknown", ModelMapping: &unknown}).Error)
	require.NoError(t, db.Create(&model.Ability{Group: "a", Model: "unknown-upstream-version", ChannelId: 4, Enabled: true}).Error)
	empty, err := ResolveVideoCapabilities([]string{"a"}, "unknown-upstream-version")
	require.NoError(t, err)
	assert.Empty(t, empty)
}

func TestIntersectVideoProfileUnionsRestrictionsAndFiltersDurations(t *testing.T) {
	a := dto.VideoModelCapabilities{Family: "same", AspectRatios: []string{"16:9"}, Resolutions: []string{"720p", "1080p"}, ImageOnlyResolutions: []string{"1080p"}, Durations: []int{3, 5, 10}, DurationRange: dto.VideoDurationRange{Min: 1, Max: 10}, Defaults: dto.VideoDefaults{AspectRatio: "16:9", Resolution: "720p", Duration: 5}}
	b := a
	b.ImageOnlyResolutions = []string{"720p"}
	b.DurationRange = dto.VideoDurationRange{Min: 4, Max: 8}
	merged, ok := intersectVideoProfile(a, b)
	require.True(t, ok)
	assert.ElementsMatch(t, []string{"720p", "1080p"}, merged.ImageOnlyResolutions)
	assert.Equal(t, []int{5}, merged.Durations)
}
