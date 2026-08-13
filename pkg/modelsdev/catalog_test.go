package modelsdev

import (
	"testing"

	"github.com/stretchr/testify/assert"
	"github.com/stretchr/testify/require"
)

func TestParseAPICatalogPrefersFirstPartyAndKeepsReasoning(t *testing.T) {
	body := []byte(`{
		"openrouter": {
			"id": "openrouter",
			"name": "OpenRouter",
			"models": {
				"gpt-5.4": {
					"id": "gpt-5.4",
					"name": "GPT-5.4 Mirror",
					"description": "reseller",
					"reasoning": true,
					"reasoning_options": [{"type":"effort","values":["low","high"]}],
					"tool_call": true,
					"limit": {"context": 1000, "output": 100},
					"modalities": {"input": ["text"], "output": ["text"]}
				}
			}
		},
		"openai": {
			"id": "openai",
			"name": "OpenAI",
			"models": {
				"gpt-5.4": {
					"id": "gpt-5.4",
					"name": "GPT-5.4",
					"description": "Agent-ready GPT",
					"family": "gpt",
					"attachment": true,
					"reasoning": true,
					"reasoning_options": [{"type":"effort","values":["none","low","medium","high","xhigh"]}],
					"tool_call": true,
					"structured_output": true,
					"temperature": false,
					"knowledge": "2025-08-31",
					"release_date": "2026-03-05",
					"last_updated": "2026-03-05",
					"modalities": {"input": ["text", "image", "pdf"], "output": ["text"]},
					"open_weights": false,
					"limit": {"context": 1050000, "input": 922000, "output": 128000}
				}
			}
		},
		"anthropic": {
			"id": "anthropic",
			"name": "Anthropic",
			"models": {
				"claude-opus-4-6": {
					"id": "claude-opus-4-6",
					"name": "Claude Opus 4.6",
					"reasoning": true,
					"reasoning_options": [
						{"type":"effort","values":["low","medium","high","max"]},
						{"type":"budget_tokens","min":1024}
					],
					"tool_call": true,
					"limit": {"context": 1000000, "output": 128000},
					"modalities": {"input": ["text"], "output": ["text"]}
				}
			}
		}
	}`)

	entries, err := ParseAPICatalog(body)
	require.NoError(t, err)
	require.Len(t, entries, 2)

	byName := map[string]CatalogEntry{}
	for _, entry := range entries {
		byName[entry.ModelName] = entry
	}

	gpt := byName["gpt-5.4"]
	assert.Equal(t, "OpenAI", gpt.VendorName)
	assert.Equal(t, "openai", gpt.VendorNamespace)
	assert.Equal(t, "GPT-5.4", gpt.DisplayName)
	assert.Equal(t, "Agent-ready GPT", gpt.Description)
	assert.Equal(t, 1050000, gpt.ContextLength)
	assert.Equal(t, 922000, gpt.MaxInputTokens)
	assert.Equal(t, 128000, gpt.MaxOutputTokens)
	assert.Equal(t, []string{"text", "image", "pdf"}, gpt.InputModalities)
	assert.True(t, gpt.SupportedReasoning)
	assert.Equal(t, []string{"none", "low", "medium", "high", "xhigh"}, gpt.ReasoningEfforts)
	assert.Contains(t, gpt.Capabilities, "reasoning")
	assert.Contains(t, gpt.Capabilities, "tools")
	assert.Contains(t, gpt.Capabilities, "vision")
	assert.Contains(t, gpt.Capabilities, "structured_output")
	require.NotNil(t, gpt.Temperature)
	assert.False(t, *gpt.Temperature)

	claude := byName["claude-opus-4-6"]
	assert.Equal(t, "Anthropic", claude.VendorName)
	assert.Equal(t, []string{"low", "medium", "high", "max"}, claude.ReasoningEfforts)
	require.Len(t, claude.ReasoningOptions, 2)
	assert.Equal(t, "effort", claude.ReasoningOptions[0].Type)
	assert.Equal(t, "budget_tokens", claude.ReasoningOptions[1].Type)
	require.NotNil(t, claude.ReasoningOptions[1].Min)
	assert.Equal(t, 1024, *claude.ReasoningOptions[1].Min)
}

func TestParseAPICatalogRejectsEmpty(t *testing.T) {
	_, err := ParseAPICatalog([]byte(`{}`))
	require.Error(t, err)
	_, err = ParseAPICatalog([]byte(`{"p":{"models":{}}}`))
	require.Error(t, err)
}
