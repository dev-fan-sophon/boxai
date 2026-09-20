package service

import (
	"testing"

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

func TestEstimatePlaygroundCost_SeedanceDoesNotFallBackToTokenRatio(t *testing.T) {
	savedPrices := ratio_setting.ModelPrice2JSONString()
	savedRatios := ratio_setting.ModelRatio2JSONString()
	t.Cleanup(func() {
		require.NoError(t, ratio_setting.UpdateModelPriceByJSONString(savedPrices))
		require.NoError(t, ratio_setting.UpdateModelRatioByJSONString(savedRatios))
	})
	require.NoError(t, ratio_setting.UpdateModelPriceByJSONString(`{}`))
	require.NoError(t, ratio_setting.UpdateModelRatioByJSONString(`{"unknown-seedance-9-9":4.9}`))

	result := EstimatePlaygroundCost(PlaygroundEstimateRequest{
		Modality: "video",
		Model:    "unknown-seedance-9-9",
		Duration: 30,
		Size:     "1920x1080",
	})
	assert.Equal(t, "unknown", result.Kind)
	assert.Nil(t, result.Amount)
	assert.Contains(t, result.Message, "not configured")
}
