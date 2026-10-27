package model

import (
	"testing"

	"github.com/stretchr/testify/assert"
	"github.com/stretchr/testify/require"

	"github.com/dev-fan-sophon/boxai/setting/ratio_setting"
)

func TestParseModelsDevSnapshotConvertsUSDPer1M(t *testing.T) {
	// input $0.14/1M → ratio = 0.14 * 500 / 1000 = 0.07
	body := []byte(`{
		"deepseek": {
			"models": {
				"deepseek-v4-flash": { "cost": { "input": 0.14, "output": 0.28, "cache_read": 0.014 } },
				"deepseek-tiered": { "cost": { "input": 1, "output": 2, "tiers": [{"input": 2, "output": 4}] } },
				"free-model": { "cost": { "input": 0, "output": 0 } }
			}
		},
		"openai": {
			"models": {
				"gpt-5.6-sol": { "cost": { "input": 5.0, "output": 30.0 } }
			}
		},
		"other": {
			"models": {
				"gpt-5.6-sol": { "cost": { "input": 4.0, "output": 24.0 } },
				"reseller-only": { "cost": { "input": 1.0, "output": 2.0 } }
			}
		}
	}`)

	snap, err := parseModelsDevSnapshot(body)
	require.NoError(t, err)
	require.NotNil(t, snap)

	// free model skipped
	_, ok := snap.references["free-model"]
	assert.False(t, ok)

	// deepseek: 0.14 * USD / 1000
	wantFlash := 0.14 * float64(ratio_setting.USD) / modelsDevInputCostRatioBase
	assert.InDelta(t, wantFlash, snap.references["deepseek-v4-flash"].ModelRatio, 1e-9)
	flashReference := snap.references["deepseek-v4-flash"]
	assert.Equal(t, "deepseek", flashReference.Provider)
	assert.InDelta(t, 0.14, flashReference.InputPrice, 1e-9)
	require.NotNil(t, flashReference.OutputPrice)
	assert.InDelta(t, 0.28, *flashReference.OutputPrice, 1e-9)
	require.NotNil(t, flashReference.CompletionRatio)
	assert.InDelta(t, 2, *flashReference.CompletionRatio, 1e-9)
	require.NotNil(t, flashReference.CacheReadPrice)
	assert.InDelta(t, 0.014, *flashReference.CacheReadPrice, 1e-9)
	require.NotNil(t, flashReference.CacheRatio)
	assert.InDelta(t, 0.1, *flashReference.CacheRatio, 1e-9)
	assert.Contains(t, snap.references, "deepseek-tiered")
	assert.False(t, snap.references["deepseek-tiered"].QuickDiscountSupported)
	assert.NotContains(t, snap.references, "reseller-only")

	// duplicate gpt-5.6-sol → prefer first-party openai ($5), not cheaper reseller ($4)
	wantSol := 5.0 * float64(ratio_setting.USD) / modelsDevInputCostRatioBase
	assert.InDelta(t, wantSol, snap.references["gpt-5.6-sol"].ModelRatio, 1e-9)
}

func TestLookupOfficialModelPricingReferenceAllowsOnlyMatchingProviderAlias(t *testing.T) {
	snapshot := &officialRatioSnapshot{references: map[string]OfficialModelPricingReference{
		"gpt-test": {ModelName: "gpt-test", Provider: "openai", InputPrice: 5, ModelRatio: 2.5},
	}}

	reference, ok := lookupOfficialModelPricingReference(snapshot, "openai/gpt-test")
	require.True(t, ok)
	assert.Equal(t, "openai/gpt-test", reference.ModelName)

	_, ok = lookupOfficialModelPricingReference(snapshot, "custom/gpt-test")
	assert.False(t, ok)
	_, ok = lookupOfficialModelPricingReference(snapshot, "custom.gpt-test")
	assert.False(t, ok)
}

func TestParseModelsDevSnapshotRejectsEmpty(t *testing.T) {
	_, err := parseModelsDevSnapshot([]byte(`{}`))
	require.Error(t, err)

	_, err = parseModelsDevSnapshot([]byte(`{"p":{"models":{}}}`))
	require.Error(t, err)
	_, err = parseModelsDevSnapshot([]byte(`{"reseller":{"models":{"only-model":{"cost":{"input":10,"output":20}}}}}`))
	require.Error(t, err)
}

func TestOfficialPricingAliasesAndFirstPartySources(t *testing.T) {
	snapshot, err := parseModelsDevSnapshot([]byte(`{
		"deepseek":{"models":{"deepseek-flash":{"cost":{"input":0.15,"output":0.6,"cache_read":0.003}}}},
		"xiaomi":{"models":{"mimo-v2.6-pro":{"cost":{"input":1,"output":4}}}},
		"meta":{"models":{"muse-spark-1.3-contributor":{"cost":{"input":1.5,"output":4.5}}}},
		"zai":{"models":{"glm-5.3":{"cost":{"input":1.4,"output":4.4}}}},
		"zhipuai":{"models":{"glm-5.3":{"cost":{"input":1.19,"output":4.18}}}},
		"moonshotai":{"models":{"Kimi-K3":{"cost":{"input":3,"output":15}}}},
		"reseller":{"models":{
			"deepseek-v4.1-flash":{"cost":{"input":0.01,"output":0.02}},
			"mimo-v2.6-pro":{"cost":{"input":0.5,"output":1}},
			"muse-spark-1.3-contributor":{"cost":{"input":0.3,"output":0.9}}
		}}
	}`))
	require.NoError(t, err)
	for _, tc := range []struct {
		name, provider string
		input          float64
	}{
		{"deepseek-v4.1-flash", "deepseek", 0.15},
		{"deepseek/deepseek-v4.1-flash-1017", "deepseek", 0.15},
		{"DeepSeek-V4.1-Flash", "deepseek", 0.15},
		{"mimo-v2.6-pro", "xiaomi", 1},
		{"muse-spark-1.3-contributor", "meta", 1.5},
		{"glm-5.3", "zai", 1.4},
		{"zhipuai/glm-5.3", "zhipuai", 1.19},
		{"moonshotai/Kimi-K3", "moonshotai", 3},
	} {
		t.Run(tc.name, func(t *testing.T) {
			reference, ok := lookupOfficialModelPricingReference(snapshot, tc.name)
			require.True(t, ok)
			assert.Equal(t, tc.provider, reference.Provider)
			assert.Equal(t, tc.name, reference.ModelName)
			assert.Equal(t, tc.input, reference.InputPrice)
			assert.InDelta(t, tc.input/2, reference.ModelRatio, 1e-9)
		})
	}
	for _, name := range []string{"reseller/deepseek-v4.1-flash", "custom.glm-5.3", "deepseek-v4.1-flash-unknown"} {
		_, ok := lookupOfficialModelPricingReference(snapshot, name)
		assert.False(t, ok, name)
	}
}

func TestOfficialReferencesDoNotFlattenMediaPricesOrUseHostedPartnerPrices(t *testing.T) {
	snapshot, err := parseModelsDevSnapshot([]byte(`{
		"google-vertex":{"models":{
			"gemini-text":{"cost":{"input":1,"output":2,"input_audio":1},"modalities":{"output":["text"]}},
			"gemini-image":{"cost":{"input":0.5,"output":60},"modalities":{"output":["text","image"]}},
			"partner-only":{"cost":{"input":10,"output":20}}
		}},
		"openai":{"models":{
			"realtime":{"cost":{"input":4,"output":24,"input_audio":32,"output_audio":64},"modalities":{"output":["text","audio"]}}
		}}
	}`))
	require.NoError(t, err)
	ref, ok := lookupOfficialModelPricingReference(snapshot, "gemini-text")
	require.True(t, ok)
	assert.Equal(t, "google-vertex", ref.Provider)
	assert.Equal(t, 2.0, *ref.OutputPrice)
	for _, name := range []string{"gemini-image", "realtime"} {
		reference, ok := lookupOfficialModelPricingReference(snapshot, name)
		require.True(t, ok, name)
		assert.False(t, reference.QuickDiscountSupported, name)
		assert.NotEmpty(t, reference.Rates, name)
	}
	_, ok = lookupOfficialModelPricingReference(snapshot, "partner-only")
	assert.False(t, ok)
}

func TestOfficialContextTiersKeepBoundariesAndMissingRates(t *testing.T) {
	snapshot, err := parseModelsDevSnapshot([]byte(`{"openai":{"models":{
		"tier-model":{"cost":{"input":2,"output":10,"cache_read":0.2,
			"tiers":[
				{"input":8,"output":30,"tier":{"type":"context","size":500000}},
				{"input":4,"output":15,"cache_read":0,"tier":{"type":"context","size":272000}}
			],"context_over_200k":{"input":99,"output":99}}},
		"legacy-model":{"cost":{"input":1,"output":3,"context_over_200k":{"input":2,"output":6}}}
	}}}`))
	require.NoError(t, err)
	reference, ok := lookupOfficialModelPricingReference(snapshot, "tier-model")
	require.True(t, ok)
	assert.False(t, reference.QuickDiscountSupported)
	require.Len(t, reference.Rates, 8, "do not duplicate the legacy tier or invent absent cache prices")
	assert.Equal(t, 2.0, reference.Rates[0].Price)
	assert.Nil(t, reference.Rates[0].ContextMinExclusive)
	require.NotNil(t, reference.Rates[0].ContextMaxInclusive)
	assert.Equal(t, 272000, *reference.Rates[0].ContextMaxInclusive)
	assert.Equal(t, 4.0, reference.Rates[3].Price)
	assert.Equal(t, 272000, *reference.Rates[3].ContextMinExclusive)
	assert.Equal(t, 500000, *reference.Rates[3].ContextMaxInclusive)
	assert.Zero(t, reference.Rates[5].Price, "explicit free cache rate remains a numeric zero")
	assert.Equal(t, 8.0, reference.Rates[6].Price)
	assert.Equal(t, 500000, *reference.Rates[6].ContextMinExclusive)
	assert.Nil(t, reference.Rates[6].ContextMaxInclusive)
	legacy, ok := lookupOfficialModelPricingReference(snapshot, "legacy-model")
	require.True(t, ok)
	require.Len(t, legacy.Rates, 4)
	assert.Equal(t, 200000, *legacy.Rates[2].ContextMinExclusive)
}

func TestDocumentedOfficialReferencesPreserveMediaUnitsAndVariants(t *testing.T) {
	for _, tc := range []struct {
		name, category, unit string
		price                float64
	}{
		{"eleven_v3", "speech", "thousand_characters", 0.08},
		{"scribe_v2", "transcription", "hour", 0.22},
		{"gpt-live-transcribe", "transcription", "minute", 0.017},
		{"grok-imagine-video-1.5", "video_output", "second", 0.08},
		{"dreamina-seedance-2-5", "video_output", "million_video_tokens", 10.7},
	} {
		t.Run(tc.name, func(t *testing.T) {
			reference, ok := GetOfficialModelPricingReference(tc.name)
			require.True(t, ok)
			assert.False(t, reference.QuickDiscountSupported)
			assert.Zero(t, reference.ModelRatio)
			assert.Equal(t, "USD", reference.Currency)
			assert.NotEmpty(t, reference.SourceURL)
			assert.NotEmpty(t, reference.VerifiedAt)
			require.NotEmpty(t, reference.Rates)
			assert.Equal(t, tc.category, reference.Rates[0].Category)
			assert.Equal(t, tc.unit, reference.Rates[0].Unit)
			assert.Equal(t, tc.price, reference.Rates[0].Price)
		})
	}
	image, ok := GetOfficialModelPricingReference("gemini-3.1-flash-image")
	require.True(t, ok)
	assert.Contains(t, image.Rates, OfficialPriceRate{Category: "text_output", Unit: "million_tokens", Price: 3})
	assert.Contains(t, image.Rates, OfficialPriceRate{Category: "image_output", Unit: "million_tokens", Price: 60})
	seedream, ok := GetOfficialModelPricingReference("seedream-5.0")
	require.True(t, ok)
	require.Len(t, seedream.Rates, 10)
	assert.Zero(t, seedream.Rates[0].Price)
	assert.NotEqual(t, seedream.Rates[0].Variant, seedream.Rates[6].Variant)
	assert.NotEqual(t, seedream.Rates[6].Variant, seedream.Rates[8].Variant)
}
