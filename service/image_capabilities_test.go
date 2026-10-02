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

func TestResolveImageCapabilitiesFromRoutingCandidates(t *testing.T) {
	db, err := gorm.Open(sqlite.Open("file:"+t.Name()+"?mode=memory&cache=shared"), &gorm.Config{})
	require.NoError(t, err)
	require.NoError(t, db.AutoMigrate(&model.Channel{}, &model.Ability{}))
	oldDB := model.DB
	model.DB = db
	t.Cleanup(func() { model.DB = oldDB })

	codex := &model.Channel{Id: 1, Type: constant.ChannelTypeCodexProxy, Status: common.ChannelStatusEnabled, Key: "k"}
	codex.SetSetting(dto.ChannelSettings{ImageGenerationViaResponsesModel: "gpt-5.6-luna"})
	native := &model.Channel{Id: 2, Type: constant.ChannelTypeOpenAI, Status: common.ChannelStatusEnabled, Key: "k"}
	grokMapping := `{"grok-image":"grok-imagine-image-2.0","gemini-alias":"gemini-3-pro-image"}`
	grok := &model.Channel{Id: 3, Type: constant.ChannelTypeOpenAI, Status: common.ChannelStatusEnabled, Key: "k", ModelMapping: &grokMapping}
	gemini := &model.Channel{Id: 4, Type: constant.ChannelTypeOpenAI, Status: common.ChannelStatusEnabled, Key: "k"}
	require.NoError(t, db.Create([]*model.Channel{codex, native, grok, gemini}).Error)
	require.NoError(t, db.Create(&[]model.Ability{
		{Group: "default", Model: "gpt-image-2", ChannelId: 1, Enabled: true},
		{Group: "default", Model: "gpt-image-2", ChannelId: 2, Enabled: true},
		{Group: "default", Model: "grok-image", ChannelId: 3, Enabled: true},
		{Group: "default", Model: "gemini-3.1-flash-lite-image", ChannelId: 4, Enabled: true},
		{Group: "default", Model: "gemini-alias", ChannelId: 3, Enabled: true},
		{Group: "default", Model: "gemini-alias", ChannelId: 4, Enabled: true},
		{Group: "default", Model: "dall-e-3", ChannelId: 2, Enabled: true},
	}).Error)

	gpt, err := ResolveImageCapabilities([]string{"default"}, "gpt-image-2")
	require.NoError(t, err)
	require.NotNil(t, gpt)
	assert.Equal(t, "gpt-image", gpt.Family)
	assert.Equal(t, 1, gpt.MaxN, "the Responses-backed channel returns one image per call")
	assert.Equal(t, 16, gpt.MaxReferenceImages)
	assert.True(t, gpt.SupportsMask)

	xai, err := ResolveImageCapabilities([]string{"default"}, "grok-image")
	require.NoError(t, err)
	require.NotNil(t, xai)
	assert.Equal(t, "xai", xai.Family)
	assert.Equal(t, 5, xai.MaxReferenceImages)
	assert.Equal(t, []string{"1k", "2k"}, xai.Resolutions)

	lite, err := ResolveImageCapabilities([]string{"default"}, "gemini-3.1-flash-lite-image")
	require.NoError(t, err)
	require.NotNil(t, lite)
	assert.Equal(t, 14, lite.MaxReferenceImages)
	assert.Equal(t, []string{"1K"}, lite.Resolutions)

	// Channel 4 serves the alias unmapped (an unmodeled id), so the merged
	// contract fails closed.
	mixed, err := ResolveImageCapabilities([]string{"default"}, "gemini-alias")
	require.NoError(t, err)
	assert.Nil(t, mixed)

	unmodeled, err := ResolveImageCapabilities([]string{"default"}, "dall-e-3")
	require.NoError(t, err)
	assert.Nil(t, unmodeled)

	missing, err := ResolveImageCapabilities([]string{"default"}, "nobody-serves-this")
	require.NoError(t, err)
	assert.Nil(t, missing)
}

func TestIntersectImageProfileRejectsFamilyMismatchAndRepairsDefaults(t *testing.T) {
	_, ok := intersectImageProfile(dto.ImageModelCapabilities{Family: "xai", SizeMode: "aspect"}, dto.ImageModelCapabilities{Family: "gemini", SizeMode: "aspect"})
	assert.False(t, ok)

	a := dto.ImageModelCapabilities{Family: "gemini", SizeMode: "aspect", Modes: []string{"generate", "edit"}, Resolutions: []string{"1K", "2K", "4K"}, MaxN: 1, MaxReferenceImages: 14, Defaults: dto.ImageModelDefaults{Resolution: "2K"}}
	b := a
	b.Resolutions = []string{"1K"}
	b.MaxReferenceImages = 6
	merged, ok := intersectImageProfile(a, b)
	require.True(t, ok)
	assert.Equal(t, []string{"1K"}, merged.Resolutions)
	assert.Equal(t, "1K", merged.Defaults.Resolution)
	assert.Equal(t, 6, merged.MaxReferenceImages)
}
