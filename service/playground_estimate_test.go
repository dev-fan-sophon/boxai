package service

import (
	"testing"

	"github.com/dev-fan-sophon/boxai/common"
	"github.com/dev-fan-sophon/boxai/setting/ratio_setting"
	"github.com/stretchr/testify/assert"
	"github.com/stretchr/testify/require"
)

func TestEstimatePlaygroundCost_RequiresModel(t *testing.T) {
	result := EstimatePlaygroundCost(PlaygroundEstimateRequest{Modality: "image"})
	assert.Equal(t, "unknown", result.Kind)
	assert.Contains(t, result.Message, "model")
}

func TestEstimatePlaygroundCost_UsesModelPriceWhenConfigured(t *testing.T) {
	err := ratio_setting.UpdateModelPriceByJSONString(`{"pg-test-fixed-price":0.04}`)
	require.NoError(t, err)

	result := EstimatePlaygroundCost(PlaygroundEstimateRequest{
		Modality: "image",
		Model:    "pg-test-fixed-price",
		Group:    "default",
		N:        2,
	})
	assert.Equal(t, "per_request", result.Kind)
	require.NotNil(t, result.Amount)
	assert.InDelta(t, 0.08*result.GroupRatio, *result.Amount, 0.0001)
	require.NotNil(t, result.Quota)
	assert.Greater(t, *result.Quota, 0)
}

func TestEstimatePlaygroundCost_BoundsN(t *testing.T) {
	err := ratio_setting.UpdateModelPriceByJSONString(`{"pg-test-n-bound":0.01}`)
	require.NoError(t, err)
	result := EstimatePlaygroundCost(PlaygroundEstimateRequest{
		Model: "pg-test-n-bound",
		N:     10_000, // should clamp to 128
	})
	assert.Equal(t, "per_request", result.Kind)
	require.NotNil(t, result.Amount)
	assert.InDelta(t, 1.28*result.GroupRatio, *result.Amount, 0.01)
}

func TestEstimatePlaygroundCost_UnknownModelNoInventedPrice(t *testing.T) {
	result := EstimatePlaygroundCost(PlaygroundEstimateRequest{
		Model: "definitely-not-a-configured-model-xyz-999",
	})
	// Must not invent token estimate via self-use 37.5 fallback
	assert.Equal(t, "unknown", result.Kind)
	assert.Nil(t, result.Amount)
	assert.Nil(t, result.Quota)
	assert.Contains(t, result.Message, "not configured")
}

func TestEstimatePlaygroundCost_ConfiguredRatio(t *testing.T) {
	// Use a model that exists in default ratio map if any; else inject via JSON
	err := ratio_setting.UpdateModelRatioByJSONString(`{"pg-test-ratio-model":1.5}`)
	require.NoError(t, err)
	result := EstimatePlaygroundCost(PlaygroundEstimateRequest{
		Model:        "pg-test-ratio-model",
		PromptTokens: 100,
		MaxTokens:    100,
	})
	assert.Equal(t, "token", result.Kind)
	require.NotNil(t, result.ModelRatio)
	assert.Equal(t, 1.5, *result.ModelRatio)
	assert.Contains(t, result.Message, "") // may be empty when prompt_tokens provided
}

func TestEstimatePlaygroundCost_IgnoresLegacyCompactWildcard(t *testing.T) {
	require.NoError(t, ratio_setting.UpdateModelPriceByJSONString(`{"*-openai-compact":0.04}`))

	result := EstimatePlaygroundCost(PlaygroundEstimateRequest{
		Model: "gpt-test-openai-compact",
	})

	assert.Equal(t, "unknown", result.Kind)
	assert.Nil(t, result.ModelPrice)
	assert.Nil(t, result.Amount)
}

func TestEstimatePlaygroundCost_SeedanceVideoUsesDurationAndResolution(t *testing.T) {
	savedPrices := ratio_setting.ModelPrice2JSONString()
	savedRatios := ratio_setting.ModelRatio2JSONString()
	t.Cleanup(func() {
		require.NoError(t, ratio_setting.UpdateModelPriceByJSONString(savedPrices))
		require.NoError(t, ratio_setting.UpdateModelRatioByJSONString(savedRatios))
	})
	require.NoError(t, ratio_setting.UpdateModelPriceByJSONString(`{"dreamina-seedance-2-5":0.20684931506849315}`))
	require.NoError(t, ratio_setting.UpdateModelRatioByJSONString(`{"dreamina-seedance-2-5":4.9}`))

	result := EstimatePlaygroundCost(PlaygroundEstimateRequest{
		Modality: "video",
		Model:    "dreamina-seedance-2-5",
		Group:    "default",
		Size:     "1920x1080",
		Duration: 30,
	})
	assert.Equal(t, "per_request", result.Kind)
	require.NotNil(t, result.Amount)
	// 0.20684931506849315 * 30 * 2.5 = 15.513698630136986, not $183.75
	assert.InDelta(t, 0.20684931506849315*30*2.5, *result.Amount, 1e-6)
	assert.Less(t, *result.Amount, 20.0)
	assert.Greater(t, *result.Amount, 10.0)
}

func TestEstimatePlaygroundCost_GrokImagineVideoUsesDurationAndResolution(t *testing.T) {
	savedPrices := ratio_setting.ModelPrice2JSONString()
	savedRatios := ratio_setting.ModelRatio2JSONString()
	t.Cleanup(func() {
		require.NoError(t, ratio_setting.UpdateModelPriceByJSONString(savedPrices))
		require.NoError(t, ratio_setting.UpdateModelRatioByJSONString(savedRatios))
	})
	require.NoError(t, ratio_setting.UpdateModelPriceByJSONString(`{"grok-imagine-video-1.5":0.003}`))
	require.NoError(t, ratio_setting.UpdateModelRatioByJSONString(`{}`))

	result := EstimatePlaygroundCost(PlaygroundEstimateRequest{
		Modality: "video",
		Model:    "grok-imagine-video-1.5",
		Group:    "default",
		Size:     "1280x720",
		Duration: 5,
	})
	assert.Equal(t, "per_request", result.Kind)
	require.NotNil(t, result.Amount)
	// 0.003 USD/s × 5s × 1.75 (720p) = 0.02625, not the catalog $0.003 "per request"
	assert.InDelta(t, 0.003*5*1.75, *result.Amount, 1e-9)
}

// Token-billed Seedance quotes Ark's video-token usage (the amount relay
// pre-consume reserves), never the compiled per-second default price.
func TestEstimatePlaygroundCost_TokenSeedanceQuotesVideoTokens(t *testing.T) {
	savedPrices := ratio_setting.ModelPrice2JSONString()
	savedRatios := ratio_setting.ModelRatio2JSONString()
	t.Cleanup(func() {
		require.NoError(t, ratio_setting.UpdateModelPriceByJSONString(savedPrices))
		require.NoError(t, ratio_setting.UpdateModelRatioByJSONString(savedRatios))
	})
	require.NoError(t, ratio_setting.UpdateModelPriceByJSONString(`{}`))
	require.NoError(t, ratio_setting.UpdateModelRatioByJSONString(`{"doubao-seedance-2-0-mini-260615":1.456323,"dreamina-seedance-2-5":4.432287}`))

	for _, tt := range []struct {
		name   string
		req    PlaygroundEstimateRequest
		tokens float64
		ratio  float64
		tier   float64
	}{
		// 1920×1080 × (24×30+1) / 1024; production billed exactly 1460025.
		{"1080p text", PlaygroundEstimateRequest{Modality: "video", Model: "doubao-seedance-2-0-mini-260615", Duration: 30, Size: "1920x1080"}, 1460025, 1.456323, 1},
		// 720×1280 × (97 output + 361 assumed reference frames) / 1024, at
		// the 2.5 video-input price 42/70.
		{"720p video reference", PlaygroundEstimateRequest{Modality: "video", Model: "dreamina-seedance-2-5", Duration: 4, Resolution: "720p", AspectRatio: "9:16", HasVideoReference: true}, 412200, 4.432287, 42.0 / 70.0},
	} {
		t.Run(tt.name, func(t *testing.T) {
			result := EstimatePlaygroundCost(tt.req)
			assert.Equal(t, "token", result.Kind)
			require.NotNil(t, result.Quota)
			expected := common.QuotaFromFloat(tt.tokens * tt.ratio * result.GroupRatio * tt.tier * 1.05)
			assert.Equal(t, expected, *result.Quota)
		})
	}
}

func TestEstimatePlaygroundCost_GeminiImageIncludesPerImageOutput(t *testing.T) {
	require.NoError(t, ratio_setting.UpdateModelRatioByJSONString(`{"gemini-3.1-flash-image":0.25}`))
	require.NoError(t, ratio_setting.UpdateCompletionRatioByJSONString(`{"gemini-3.1-flash-image":240}`))

	one := EstimatePlaygroundCost(PlaygroundEstimateRequest{Modality: "image", Model: "gemini-3.1-flash-image", N: 1})
	two := EstimatePlaygroundCost(PlaygroundEstimateRequest{Modality: "image", Model: "gemini-3.1-flash-image", N: 2})
	require.NotNil(t, one.Quota)
	require.NotNil(t, two.Quota)
	// 1000 assumed prompt tokens + 1120 output tokens per 1K image at the
	// completion ratio, all at the model ratio.
	expected := common.QuotaFromFloat((1000 + 1120*240) * 0.25 * one.GroupRatio)
	assert.Equal(t, expected, *one.Quota)
	assert.Greater(t, *two.Quota, *one.Quota)
}
