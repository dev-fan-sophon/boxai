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
	profile := dto.VideoModelCapabilities{Family: "generic", AspectRatios: []string{"1:1"}}
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
