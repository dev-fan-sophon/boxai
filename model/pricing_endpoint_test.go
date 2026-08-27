package model

import (
	"fmt"
	"testing"

	"github.com/dev-fan-sophon/boxai/common"
	"github.com/dev-fan-sophon/boxai/constant"
	"github.com/dev-fan-sophon/boxai/dto"
	"github.com/stretchr/testify/assert"
	"github.com/stretchr/testify/require"
)

func resetPricingEndpointTestTables(t *testing.T) {
	t.Helper()
	originalMemoryCacheEnabled := common.MemoryCacheEnabled
	common.MemoryCacheEnabled = true
	require.NoError(t, DB.AutoMigrate(&Channel{}, &Ability{}, &Model{}, &Vendor{}))
	for _, table := range []string{"abilities", "channels", "models", "vendors"} {
		require.NoError(t, DB.Exec("DELETE FROM "+table).Error)
	}
	InitChannelCache()
	InvalidatePricingCache()
	t.Cleanup(func() {
		for _, table := range []string{"abilities", "channels", "models", "vendors"} {
			require.NoError(t, DB.Exec("DELETE FROM "+table).Error)
		}
		InitChannelCache()
		InvalidatePricingCache()
		common.MemoryCacheEnabled = originalMemoryCacheEnabled
	})
}

func insertPricingEndpointChannel(t *testing.T, channelID int, channelType int, settings dto.ChannelOtherSettings) {
	t.Helper()
	channel := &Channel{
		Id:     channelID,
		Type:   channelType,
		Key:    fmt.Sprintf("key-%d", channelID),
		Status: common.ChannelStatusEnabled,
		Name:   fmt.Sprintf("channel-%d", channelID),
	}
	if settings.AdvancedCustom != nil {
		channel.SetOtherSettings(settings)
	}
	require.NoError(t, DB.Create(channel).Error)
}

func insertPricingEndpointAbility(t *testing.T, channelID int, modelName string) {
	t.Helper()
	require.NoError(t, DB.Create(&Ability{
		Group:     "default",
		Model:     modelName,
		ChannelId: channelID,
		Enabled:   true,
	}).Error)
}

func pricingEndpointAdvancedCustomConfig(routes ...dto.AdvancedCustomRoute) dto.ChannelOtherSettings {
	return dto.ChannelOtherSettings{
		AdvancedCustom: &dto.AdvancedCustomConfig{
			Routes: routes,
		},
	}
}

func pricingEndpointTypesByModel(t *testing.T) map[string][]constant.EndpointType {
	t.Helper()
	InitChannelCache()
	return pricingEndpointTypesFromPricing(GetPricing())
}

func pricingEndpointTypesFromPricing(pricings []Pricing) map[string][]constant.EndpointType {
	byModel := make(map[string][]constant.EndpointType)
	for _, pricing := range pricings {
		byModel[pricing.ModelName] = pricing.SupportedEndpointTypes
	}
	return byModel
}

func TestGetModelSupportEndpointTypesWarmsPricingCache(t *testing.T) {
	resetPricingEndpointTestTables(t)
	insertPricingEndpointChannel(t, 100, constant.ChannelTypeOpenAI, dto.ChannelOtherSettings{})
	insertPricingEndpointAbility(t, 100, "cold-cache-model")
	InitChannelCache()

	assert.Contains(t, GetModelSupportEndpointTypes("cold-cache-model"), constant.EndpointTypeOpenAI)
}

func TestPricingAdvancedCustomUsesConfiguredEndpointTypes(t *testing.T) {
	resetPricingEndpointTestTables(t)

	insertPricingEndpointChannel(t, 101, constant.ChannelTypeAdvancedCustom, pricingEndpointAdvancedCustomConfig(
		dto.AdvancedCustomRoute{
			IncomingPath: "/v1/chat/completions",
			UpstreamPath: "/v1/chat/completions",
		},
		dto.AdvancedCustomRoute{
			IncomingPath: "/v1/responses",
			UpstreamPath: "/v1beta/models/{model}:generateContent",
			Converter:    "openai_responses_to_gemini_generate_content",
			Models:       []string{"re:^gemini-"},
		},
	))
	insertPricingEndpointAbility(t, 101, "gemini-2.5-flash")
	insertPricingEndpointAbility(t, 101, "gpt-4o")

	byModel := pricingEndpointTypesByModel(t)

	assert.Equal(t, []constant.EndpointType{
		constant.EndpointTypeOpenAI,
		constant.EndpointTypeOpenAIResponse,
	}, byModel["gemini-2.5-flash"])
	assert.Equal(t, []constant.EndpointType{
		constant.EndpointTypeOpenAI,
	}, byModel["gpt-4o"])
}

func TestPricingModelMetadataEndpointsMergeWithAdvancedCustomInference(t *testing.T) {
	resetPricingEndpointTestTables(t)

	insertPricingEndpointChannel(t, 103, constant.ChannelTypeAdvancedCustom, pricingEndpointAdvancedCustomConfig(
		dto.AdvancedCustomRoute{
			IncomingPath: "/v1/responses",
			UpstreamPath: "/v1beta/models/{model}:generateContent",
			Converter:    "openai_responses_to_gemini_generate_content",
			Models:       []string{"re:^gemini-"},
		},
	))
	insertPricingEndpointAbility(t, 103, "gemini-2.5-flash")
	require.NoError(t, DB.Create(&Model{
		ModelName: "gemini-2.5-flash",
		Endpoints: `{
			"openai": "/v1/chat/completions"
		}`,
		Status:   1,
		NameRule: NameRuleExact,
	}).Error)

	byModel := pricingEndpointTypesByModel(t)

	assert.Equal(t, []constant.EndpointType{
		constant.EndpointTypeOpenAIResponse,
		constant.EndpointTypeOpenAI,
	}, byModel["gemini-2.5-flash"])
}

func TestPricingModelMetadataEndpointsCanProvideEndpointWithoutChannelInference(t *testing.T) {
	resetPricingEndpointTestTables(t)

	insertPricingEndpointChannel(t, 104, constant.ChannelTypeAdvancedCustom, pricingEndpointAdvancedCustomConfig(
		dto.AdvancedCustomRoute{
			IncomingPath: "/v1/responses",
			UpstreamPath: "/v1beta/models/{model}:generateContent",
			Converter:    "openai_responses_to_gemini_generate_content",
			Models:       []string{"re:^gemini-"},
		},
	))
	insertPricingEndpointAbility(t, 104, "metadata-only-model")
	require.NoError(t, DB.Create(&Model{
		ModelName: "metadata-only-model",
		Endpoints: `{
			"openai": "/v1/chat/completions"
		}`,
		Status:   1,
		NameRule: NameRuleExact,
	}).Error)

	byModel := pricingEndpointTypesByModel(t)

	assert.Equal(t, []constant.EndpointType{constant.EndpointTypeOpenAI}, byModel["metadata-only-model"])
}

func TestPricingAdvancedCustomMissingConfigFallsBackToChannelType(t *testing.T) {
	resetPricingEndpointTestTables(t)

	insertPricingEndpointChannel(t, 102, constant.ChannelTypeAdvancedCustom, dto.ChannelOtherSettings{})
	insertPricingEndpointAbility(t, 102, "gpt-4o")

	byModel := pricingEndpointTypesByModel(t)

	assert.Equal(t, []constant.EndpointType{
		constant.EndpointTypeOpenAI,
		constant.EndpointTypeOpenAIResponse,
	}, byModel["gpt-4o"])
}

func TestPricingNativeChatChannelsPublishResponsesCapability(t *testing.T) {
	resetPricingEndpointTestTables(t)

	insertPricingEndpointChannel(t, 201, constant.ChannelTypeOpenAI, dto.ChannelOtherSettings{})
	insertPricingEndpointChannel(t, 202, constant.ChannelTypeGemini, dto.ChannelOtherSettings{})
	insertPricingEndpointChannel(t, 203, constant.ChannelTypeAnthropic, dto.ChannelOtherSettings{})
	insertPricingEndpointAbility(t, 201, "gpt-4o")
	insertPricingEndpointAbility(t, 202, "gemini-2.5-flash")
	insertPricingEndpointAbility(t, 203, "claude-3-5-sonnet")

	byModel := pricingEndpointTypesByModel(t)

	assert.Equal(t, []constant.EndpointType{
		constant.EndpointTypeOpenAI,
		constant.EndpointTypeOpenAIResponse,
	}, byModel["gpt-4o"])
	assert.Equal(t, []constant.EndpointType{
		constant.EndpointTypeGemini,
		constant.EndpointTypeOpenAI,
		constant.EndpointTypeOpenAIResponse,
	}, byModel["gemini-2.5-flash"])
	assert.Equal(t, []constant.EndpointType{
		constant.EndpointTypeAnthropic,
		constant.EndpointTypeOpenAI,
		constant.EndpointTypeOpenAIResponse,
	}, byModel["claude-3-5-sonnet"])
}

func TestPricingElevenLabsPublishesFineGrainedAudioCapabilities(t *testing.T) {
	resetPricingEndpointTestTables(t)
	insertPricingEndpointChannel(t, 262, constant.ChannelTypeElevenLabs, dto.ChannelOtherSettings{})
	want := map[string]constant.EndpointType{
		"eleven_v3":                   constant.EndpointTypeAudioTTS,
		"scribe_v2":                   constant.EndpointTypeAudioSTT,
		"eleven_multilingual_sts_v2":  constant.EndpointTypeAudioSpeechToSpeech,
		"eleven_text_to_sound_v2":     constant.EndpointTypeAudioSFX,
		"music_v2":                    constant.EndpointTypeAudioMusic,
		"elevenlabs-audio-isolation":  constant.EndpointTypeAudioIsolation,
		"elevenlabs-forced-alignment": constant.EndpointTypeAudioAlignment,
	}
	for modelName := range want {
		insertPricingEndpointAbility(t, 262, modelName)
	}
	byModel := pricingEndpointTypesByModel(t)
	for modelName, endpoint := range want {
		assert.Equal(t, []constant.EndpointType{endpoint}, byModel[modelName])
		assert.NotContains(t, byModel[modelName], constant.EndpointTypeOpenAI)
	}
	pricingByModel := make(map[string]Pricing)
	for _, pricing := range GetPricing() {
		pricingByModel[pricing.ModelName] = pricing
	}
	for modelName := range want {
		assert.Equal(t, "ElevenLabs.Avatar", pricingByModel[modelName].Icon)
		assert.NotEmpty(t, pricingByModel[modelName].Description)
	}
}

func TestIntegrationProfileRegistryContract(t *testing.T) {
	seen := make(map[string]struct{})
	profiles := GetIntegrationProfiles()
	require.GreaterOrEqual(t, len(profiles), 12)
	var videoProfile *IntegrationProfile
	for _, profile := range profiles {
		assert.NotEmpty(t, profile.ID)
		assert.NotEmpty(t, profile.GatewayPathTemplate)
		assert.NotEmpty(t, profile.DocsSlug)
		assert.NotEmpty(t, profile.SampleKind)
		assert.NotEmpty(t, profile.AuthScheme)
		_, duplicate := seen[profile.ID]
		assert.False(t, duplicate, profile.ID)
		seen[profile.ID] = struct{}{}
		if profile.ID == "openai.video.create" {
			profileCopy := profile
			videoProfile = &profileCopy
		}
	}
	require.NotNil(t, videoProfile)
	assert.Equal(t, "application/json", videoProfile.ContentType)
}

func TestNormalizeModelIntegrationsRejectsUnknownAndCanonicalizesAssignments(t *testing.T) {
	_, err := NormalizeModelIntegrations(`[{"profile_id":"unknown.operation","groups":["default"]}]`)
	assert.ErrorContains(t, err, "unknown integration profile_id")
	_, err = NormalizeModelIntegrations(`[{"profile_id":"openai.responses","groups":[]}]`)
	assert.ErrorContains(t, err, "at least one group")

	normalized, err := NormalizeModelIntegrations(`[
		{"profile_id":"openai.responses","groups":["premium","default","premium"]},
		{"profile_id":"openai.responses","groups":["default"]}
	]`)
	require.NoError(t, err)
	assert.JSONEq(t, `[{"profile_id":"openai.responses","groups":["default","premium"],"verified":true,"source":"explicit"}]`, normalized)
}

func TestPricingIntegrationsPreserveGroupsAndExplicitAssignmentsTakePrecedence(t *testing.T) {
	resetPricingEndpointTestTables(t)
	insertPricingEndpointChannel(t, 210, constant.ChannelTypeOpenAI, dto.ChannelOtherSettings{})
	insertPricingEndpointChannel(t, 211, constant.ChannelTypeAdvancedCustom, pricingEndpointAdvancedCustomConfig(dto.AdvancedCustomRoute{
		IncomingPath: "/v1beta/models/{model}:generateContent", UpstreamPath: "/v1beta/models/{model}:generateContent",
	}))
	require.NoError(t, DB.Create(&Ability{Group: "default", Model: "grouped-model", ChannelId: 210, Enabled: true}).Error)
	require.NoError(t, DB.Create(&Ability{Group: "premium", Model: "grouped-model", ChannelId: 211, Enabled: true}).Error)
	InitChannelCache()

	var pricing Pricing
	for _, item := range GetPricing() {
		if item.ModelName == "grouped-model" {
			pricing = item
		}
	}
	assert.Contains(t, pricing.Integrations, ModelIntegration{ProfileID: "openai.chat_completions", Groups: []string{"default"}, Source: "inferred"})
	assert.Contains(t, pricing.Integrations, ModelIntegration{ProfileID: "gemini.generate_content", Groups: []string{"premium"}, Source: "inferred"})

	stored, err := NormalizeModelIntegrations(`[{"profile_id":"openai.responses","groups":["default","stale"]}]`)
	require.NoError(t, err)
	require.NoError(t, DB.Create(&Model{ModelName: "grouped-model", Integrations: stored, Status: 1, NameRule: NameRuleExact}).Error)
	InvalidatePricingCache()
	for _, item := range GetPricing() {
		if item.ModelName == "grouped-model" {
			pricing = item
		}
	}
	assert.Equal(t, []ModelIntegration{{ProfileID: "openai.responses", Groups: []string{"default"}, Verified: true, Source: "explicit"}}, pricing.Integrations)
}

func TestPricingExplicitIntegrationSupportsGlobalModelGroup(t *testing.T) {
	resetPricingEndpointTestTables(t)
	insertPricingEndpointChannel(t, 212, constant.ChannelTypeOpenAI, dto.ChannelOtherSettings{})
	require.NoError(t, DB.Create(&Ability{Group: "all", Model: "global-model", ChannelId: 212, Enabled: true}).Error)

	stored, err := NormalizeModelIntegrations(`[{"profile_id":"openai.chat_completions","groups":["all"]}]`)
	require.NoError(t, err)
	require.NoError(t, DB.Create(&Model{ModelName: "global-model", Integrations: stored, Status: 1, NameRule: NameRuleExact}).Error)
	InvalidatePricingCache()

	for _, item := range GetPricing() {
		if item.ModelName == "global-model" {
			assert.Equal(t, []ModelIntegration{{ProfileID: "openai.chat_completions", Groups: []string{"all"}, Verified: true, Source: "explicit"}}, item.Integrations)
			return
		}
	}
	t.Fatal("global-model pricing not found")
}

func TestPricingParsesRichModelMetadata(t *testing.T) {
	resetPricingEndpointTestTables(t)
	insertPricingEndpointChannel(t, 220, constant.ChannelTypeOpenAI, dto.ChannelOtherSettings{})
	insertPricingEndpointAbility(t, 220, "documented-model")
	officialDiscount := 88.88
	require.NoError(t, DB.Create(&Model{ModelName: "documented-model", Status: 1, NameRule: NameRuleExact,
		DisplayName: "Documented Model", OfficialDiscount: &officialDiscount, ContextLength: 128000, MaxInputTokens: 272000, MaxOutputTokens: 8192,
		InputModalities: `["text","image"]`, OutputModalities: `["text"]`, Capabilities: `["tools"]`,
		SupportedReasoning: true, ReasoningEfforts: `["low","high"]`,
		ReasoningOptions: `[{"type":"effort","values":["low","high"]}]`, UsageNotes: "Use for analysis.",
	}).Error)

	var pricing Pricing
	for _, item := range GetPricing() {
		if item.ModelName == "documented-model" {
			pricing = item
		}
	}
	assert.Equal(t, "Documented Model", pricing.DisplayName)
	assert.Equal(t, 88.88, pricing.OfficialDiscount)
	assert.Equal(t, 128000, pricing.ContextLength)
	assert.Equal(t, 8192, pricing.MaxOutputTokens)
	assert.Equal(t, []string{"text", "image"}, pricing.InputModalities)
	assert.Equal(t, []string{"tools"}, pricing.Capabilities)
	assert.Equal(t, []string{"low", "high"}, pricing.ReasoningEfforts)
	assert.True(t, pricing.SupportedReasoning)
	assert.Equal(t, 272000, pricing.MaxInputTokens)
	require.Len(t, pricing.ReasoningOptions, 1)
	assert.Equal(t, "effort", pricing.ReasoningOptions[0].Type)
}

func TestModelUpdatePreservesOmittedOfficialDiscountAndAllowsClearing(t *testing.T) {
	resetPricingEndpointTestTables(t)
	officialDiscount := 88.88
	stored := Model{ModelName: "discounted-model", OfficialDiscount: &officialDiscount, Status: 1}
	require.NoError(t, stored.Insert())

	require.NoError(t, (&Model{Id: stored.Id, ModelName: stored.ModelName, Status: 1}).Update())
	require.NoError(t, DB.First(&stored, stored.Id).Error)
	require.NotNil(t, stored.OfficialDiscount)
	assert.Equal(t, 88.88, *stored.OfficialDiscount)

	cleared := 0.0
	require.NoError(t, (&Model{Id: stored.Id, ModelName: stored.ModelName, OfficialDiscount: &cleared, Status: 1}).Update())
	require.NoError(t, DB.First(&stored, stored.Id).Error)
	require.NotNil(t, stored.OfficialDiscount)
	assert.Zero(t, *stored.OfficialDiscount)
}

func TestInitChannelCacheInvalidatesPricingCache(t *testing.T) {
	resetPricingEndpointTestTables(t)

	insertPricingEndpointChannel(t, 301, constant.ChannelTypeAdvancedCustom, pricingEndpointAdvancedCustomConfig(
		dto.AdvancedCustomRoute{
			IncomingPath: "/v1/chat/completions",
			UpstreamPath: "/v1/chat/completions",
		},
	))
	insertPricingEndpointAbility(t, 301, "gemini-3.5-flash")
	InitChannelCache()

	initial := pricingEndpointTypesByModel(t)
	require.Equal(t, []constant.EndpointType{constant.EndpointTypeOpenAI}, initial["gemini-3.5-flash"])

	var channel Channel
	require.NoError(t, DB.First(&channel, "id = ?", 301).Error)
	channel.SetOtherSettings(pricingEndpointAdvancedCustomConfig(
		dto.AdvancedCustomRoute{
			IncomingPath: "/v1/chat/completions",
			UpstreamPath: "/v1/chat/completions",
		},
		dto.AdvancedCustomRoute{
			IncomingPath: "/v1/responses",
			UpstreamPath: "/v1beta/models/{model}:generateContent",
			Converter:    "openai_responses_to_gemini_generate_content",
			Models:       []string{"re:^gemini-"},
		},
	))
	require.NoError(t, DB.Model(&Channel{}).Where("id = ?", 301).Update("settings", channel.OtherSettings).Error)
	InitChannelCache()

	updated := pricingEndpointTypesByModel(t)
	assert.Equal(t, []constant.EndpointType{
		constant.EndpointTypeOpenAI,
		constant.EndpointTypeOpenAIResponse,
	}, updated["gemini-3.5-flash"])
}

func TestInitChannelCacheInvalidatesStartupPricingBuiltBeforeChannelCache(t *testing.T) {
	resetPricingEndpointTestTables(t)

	insertPricingEndpointChannel(t, 302, constant.ChannelTypeAdvancedCustom, pricingEndpointAdvancedCustomConfig(
		dto.AdvancedCustomRoute{
			IncomingPath: "/v1/responses",
			UpstreamPath: "/v1beta/models/{model}:generateContent",
			Converter:    "openai_responses_to_gemini_generate_content",
			Models:       []string{"re:^gemini-"},
		},
	))
	insertPricingEndpointAbility(t, 302, "gemini-3.5-flash")

	staleByModel := pricingEndpointTypesFromPricing(GetPricing())
	require.Equal(t, []constant.EndpointType{
		constant.EndpointTypeOpenAI,
		constant.EndpointTypeOpenAIResponse,
	}, staleByModel["gemini-3.5-flash"])

	InitChannelCache()

	rebuiltByModel := pricingEndpointTypesFromPricing(GetPricing())
	assert.Equal(t, []constant.EndpointType{constant.EndpointTypeOpenAIResponse}, rebuiltByModel["gemini-3.5-flash"])
}

func TestCacheUpdateChannelSyncsAdvancedCustomConfig(t *testing.T) {
	resetPricingEndpointTestTables(t)

	channel := &Channel{
		Id:     401,
		Type:   constant.ChannelTypeAdvancedCustom,
		Key:    "key-401",
		Status: common.ChannelStatusEnabled,
		Name:   "channel-401",
	}
	channel.SetOtherSettings(pricingEndpointAdvancedCustomConfig(dto.AdvancedCustomRoute{
		IncomingPath: "/v1/responses",
		UpstreamPath: "/v1beta/models/{model}:generateContent",
		Converter:    "openai_responses_to_gemini_generate_content",
	}))
	CacheUpdateChannel(channel)

	require.NotNil(t, channel2advancedCustomConfig[401])
	assert.Equal(t, []constant.EndpointType{constant.EndpointTypeOpenAIResponse}, channel2advancedCustomConfig[401].SupportedEndpointTypesForModel("gemini-3.5-flash"))

	channel.SetOtherSettings(pricingEndpointAdvancedCustomConfig(dto.AdvancedCustomRoute{
		IncomingPath: "/v1/chat/completions",
		UpstreamPath: "/v1/chat/completions",
	}))
	CacheUpdateChannel(channel)

	require.NotNil(t, channel2advancedCustomConfig[401])
	assert.Equal(t, []constant.EndpointType{constant.EndpointTypeOpenAI}, channel2advancedCustomConfig[401].SupportedEndpointTypesForModel("gemini-3.5-flash"))

	channel.Type = constant.ChannelTypeOpenAI
	CacheUpdateChannel(channel)

	assert.Nil(t, channel2advancedCustomConfig[401])
}
