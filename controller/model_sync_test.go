package controller

import (
	"testing"

	"github.com/dev-fan-sophon/boxai/model"
	"github.com/dev-fan-sophon/boxai/pkg/modelsdev"
	"github.com/stretchr/testify/assert"
	"github.com/stretchr/testify/require"
)

func TestParseModelsDevCatalog(t *testing.T) {
	temperature := false
	entries := []modelsdev.CatalogEntry{
		{
			ModelName:          "gpt-5",
			VendorNamespace:    "openai",
			VendorName:         "OpenAI",
			DisplayName:        "GPT-5",
			Description:        "Flagship model",
			Family:             "gpt",
			SupportedReasoning: true,
			Capabilities:       []string{"tools", "function_calling", "structured_output", "reasoning", "vision"},
			InputModalities:    []string{"text", "image"},
			OutputModalities:   []string{"text"},
			ContextLength:      400000,
			MaxOutputTokens:    128000,
			ReasoningEfforts:   []string{"none", "low", "medium", "high", "xhigh"},
			Temperature:        &temperature,
		},
		{
			ModelName:       "kimi-k2",
			VendorNamespace: "moonshotai",
			VendorName:      "Moonshot AI",
			Description:     "Kimi model",
			OpenWeights:     true,
		},
	}

	models, vendors := parseModelsDevCatalog(entries)

	require.Len(t, models, 2)
	assert.Equal(t, "gpt-5", models[0].ModelName)
	assert.Equal(t, "OpenAI", models[0].VendorName)
	assert.Equal(t, "GPT-5", models[0].DisplayName)
	assert.True(t, models[0].SupportedReasoning)
	assert.Equal(t, 400000, models[0].ContextLength)
	assert.Contains(t, models[0].Tags, "family:gpt")
	assert.Contains(t, models[0].Tags, "reasoning")
	assert.JSONEq(t, `["none","low","medium","high","xhigh"]`, models[0].ReasoningEfforts)
	assert.JSONEq(t, `["tools","function_calling","structured_output","reasoning","vision"]`, models[0].Capabilities)

	assert.Equal(t, "kimi-k2", models[1].ModelName)
	assert.Equal(t, "Moonshot AI", models[1].VendorName)
	assert.Contains(t, models[1].Tags, "open-weights")

	require.Len(t, vendors, 2)
	assert.Equal(t, "Moonshot AI", vendors[0].Name)
	assert.Equal(t, "Moonshot", vendors[0].Icon)
	assert.Equal(t, "OpenAI", vendors[1].Name)
	assert.Equal(t, "OpenAI", vendors[1].Icon)
}

func TestModelsDevVendorsHaveLobeIconKeys(t *testing.T) {
	namespaces := []string{
		"alibaba", "anthropic", "cohere", "deepreinforce", "deepseek", "google",
		"meituan", "meta", "microsoft", "minimax", "mistral", "moonshotai",
		"nvidia", "openai", "perplexity", "poolside", "sakana", "sarvam",
		"stepfun", "tencent", "thinkingmachines", "xai", "xiaomi", "zhipuai",
	}

	for _, namespace := range namespaces {
		assert.NotEmpty(t, modelsdev.VendorIconKey(namespace), namespace)
	}
}

func TestApplyOfficialCatalogFieldsWritesReasoning(t *testing.T) {
	local := modelStub()
	up := catalogEntryToUpstreamModel(modelsdev.CatalogEntry{
		ModelName:          "gpt-5.4",
		VendorName:         "OpenAI",
		DisplayName:        "GPT-5.4",
		Description:        "Agent-ready GPT",
		Family:             "gpt",
		SupportedReasoning: true,
		ContextLength:      1050000,
		MaxInputTokens:     922000,
		MaxOutputTokens:    128000,
		InputModalities:    []string{"text", "image", "pdf"},
		OutputModalities:   []string{"text"},
		Capabilities:       []string{"tools", "reasoning", "vision"},
		ReasoningEfforts:   []string{"none", "low", "medium", "high", "xhigh"},
		ReasoningOptions: []modelsdev.ReasoningOption{{
			Type:   "effort",
			Values: []string{"none", "low", "medium", "high", "xhigh"},
		}},
	})

	require.True(t, applyOfficialCatalogFields(&local, 7, up))
	assert.Equal(t, "GPT-5.4", local.DisplayName)
	assert.Equal(t, "Agent-ready GPT", local.Description)
	assert.True(t, local.SupportedReasoning)
	assert.Equal(t, 1050000, local.ContextLength)
	assert.Equal(t, 922000, local.MaxInputTokens)
	assert.Equal(t, 7, local.VendorID)
	assert.JSONEq(t, `["none","low","medium","high","xhigh"]`, local.ReasoningEfforts)
	assert.JSONEq(t, `[{"type":"effort","values":["none","low","medium","high","xhigh"]}]`, local.ReasoningOptions)
}

func modelStub() model.Model {
	return model.Model{ModelName: "gpt-5.4", Status: 1, SyncOfficial: 1}
}
