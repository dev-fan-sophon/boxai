package service

import (
	"testing"

	"github.com/QuantumNous/new-api/setting/ratio_setting"
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
