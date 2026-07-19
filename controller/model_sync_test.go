package controller

import (
	"testing"

	"github.com/stretchr/testify/assert"
	"github.com/stretchr/testify/require"
)

func TestParseModelsDevCatalog(t *testing.T) {
	openAIModel := modelsDevCatalogEntry{
		Description:      "Flagship model",
		Family:           "gpt",
		Reasoning:        true,
		ToolCall:         true,
		StructuredOutput: true,
	}
	openAIModel.Modalities.Input = []string{"text", "image"}
	openAIModel.Modalities.Output = []string{"text"}
	catalog := map[string]modelsDevCatalogEntry{
		"openai/gpt-5": openAIModel,
		"moonshotai/kimi-k2": {
			Description: "Kimi model",
			OpenWeights: true,
		},
		"invalid": {},
	}
	models, vendors := parseModelsDevCatalog(catalog)

	require.Len(t, models, 2)
	assert.Equal(t, "kimi-k2", models[0].ModelName)
	assert.Equal(t, "Moonshot AI", models[0].VendorName)
	assert.Equal(t, "open-weights", models[0].Tags)
	assert.Equal(t, "gpt-5", models[1].ModelName)
	assert.Equal(t, "OpenAI", models[1].VendorName)
	assert.Equal(t, "family:gpt,reasoning,tool-call,structured-output,input:text,input:image,output:text", models[1].Tags)

	require.Len(t, vendors, 2)
	assert.Equal(t, "Moonshot AI", vendors[0].Name)
	assert.Equal(t, "OpenAI", vendors[1].Name)
}

func TestParseModelsDevCatalogSkipsAmbiguousShortIDs(t *testing.T) {
	catalog := map[string]modelsDevCatalogEntry{
		"provider-a/shared-model": {Description: "A"},
		"provider-b/shared-model": {Description: "B"},
		"provider-a/unique-model": {Description: "unique"},
	}

	models, vendors := parseModelsDevCatalog(catalog)

	require.Len(t, models, 1)
	assert.Equal(t, "unique-model", models[0].ModelName)
	assert.Equal(t, "Provider-a", models[0].VendorName)
	require.Len(t, vendors, 1)
	assert.Equal(t, "Provider-a", vendors[0].Name)
}
