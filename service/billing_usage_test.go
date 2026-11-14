package service

import (
	"testing"

	"github.com/dev-fan-sophon/boxai/dto"
	"github.com/stretchr/testify/assert"
	"github.com/stretchr/testify/require"
)

func TestEffectiveBillingUsageClampsNegativeGeminiCompletion(t *testing.T) {
	usage := effectiveBillingUsage(&dto.Usage{BillingUsage: dto.NewGeminiChatBillingUsage(&dto.GeminiUsageMetadata{
		PromptTokenCount: 50,
		TotalTokenCount:  30,
	})})
	assert.Equal(t, 50, usage.PromptTokens)
	assert.Zero(t, usage.CompletionTokens)
}

func TestEffectiveBillingUsageNormalizesGeminiModalityKeys(t *testing.T) {
	for _, modality := range []string{"audio", " AUDIO ", "AUDIO"} {
		t.Run(modality, func(t *testing.T) {
			usage := effectiveBillingUsage(&dto.Usage{BillingUsage: dto.NewGeminiChatBillingUsage(&dto.GeminiUsageMetadata{
				PromptTokenCount:     100,
				CandidatesTokenCount: 30,
				TotalTokenCount:      130,
				PromptTokensDetails: []dto.GeminiPromptTokensDetails{
					{Modality: modality, TokenCount: 40},
					{Modality: "text", TokenCount: 60},
				},
				CandidatesTokensDetails: []dto.GeminiPromptTokensDetails{
					{Modality: modality, TokenCount: 30},
				},
			})})
			assert.Equal(t, 40, usage.PromptTokensDetails.AudioTokens)
			assert.Equal(t, 60, usage.PromptTokensDetails.TextTokens)
			assert.Equal(t, 30, usage.CompletionTokenDetails.AudioTokens)
		})
	}

	duplicated := effectiveBillingUsage(&dto.Usage{BillingUsage: dto.NewGeminiChatBillingUsage(&dto.GeminiUsageMetadata{
		PromptTokenCount: 25,
		PromptTokensDetails: []dto.GeminiPromptTokensDetails{
			{Modality: "AUDIO", TokenCount: 10},
			{Modality: "audio", TokenCount: 15},
		},
	})})
	assert.Equal(t, 25, duplicated.PromptTokensDetails.AudioTokens)
}

func TestEffectiveBillingUsageClaudeCacheCreationSubObjectWins(t *testing.T) {
	t.Run("zeroed sub-object does not revive flat 1h", func(t *testing.T) {
		usage := effectiveBillingUsage(&dto.Usage{BillingUsage: dto.NewClaudeMessagesBillingUsage(&dto.ClaudeUsage{
			InputTokens:                 10,
			CacheCreationInputTokens:    1000,
			ClaudeCacheCreation1hTokens: 1000,
			CacheCreation:               &dto.ClaudeCacheCreationUsage{Ephemeral5mInputTokens: 1000},
		})})
		assert.Equal(t, 1000, usage.ClaudeCacheCreation5mTokens)
		assert.Zero(t, usage.ClaudeCacheCreation1hTokens)
	})
	t.Run("flat fields settle without a sub-object", func(t *testing.T) {
		usage := effectiveBillingUsage(&dto.Usage{BillingUsage: dto.NewClaudeMessagesBillingUsage(&dto.ClaudeUsage{
			InputTokens:                 10,
			ClaudeCacheCreation1hTokens: 1000,
		})})
		assert.Zero(t, usage.ClaudeCacheCreation5mTokens)
		assert.Equal(t, 1000, usage.ClaudeCacheCreation1hTokens)
	})
}

func TestEffectiveBillingUsageMergesOpenAIInputTokenDetailsFieldwise(t *testing.T) {
	usage := effectiveBillingUsage(&dto.Usage{BillingUsage: dto.NewOpenAIResponsesBillingUsage(&dto.Usage{
		PromptTokens: 10,
		PromptTokensDetails: dto.InputTokenDetails{
			CachedTokens: 8,
			TextTokens:   12,
			ImageTokens:  4,
			AudioTokens:  3,
		},
		InputTokensDetails: &dto.InputTokenDetails{
			CachedTokens:             5,
			CachedCreationTokens:     7,
			TextTokens:               2,
			CacheCreationInputTokens: 6,
		},
	})})
	require.NotNil(t, usage)
	assert.Equal(t, 8, usage.PromptTokensDetails.CachedTokens)
	assert.Equal(t, 12, usage.PromptTokensDetails.TextTokens)
	assert.Equal(t, 4, usage.PromptTokensDetails.ImageTokens)
	assert.Equal(t, 3, usage.PromptTokensDetails.AudioTokens)
	assert.Equal(t, 7, usage.PromptTokensDetails.CachedCreationTokens)
	assert.Equal(t, 6, usage.PromptTokensDetails.CacheCreationInputTokens)
}
