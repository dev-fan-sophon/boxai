package reasoning

import (
	"testing"

	"github.com/stretchr/testify/assert"
	"github.com/stretchr/testify/require"
)

func TestParseModelModifiers(t *testing.T) {
	tests := []struct {
		name      string
		model     string
		base      string
		modifiers ModelModifiers
	}{
		{name: "effort", model: "gpt-5@effort:high", base: "gpt-5", modifiers: ModelModifiers{Effort: "high", Thinking: "on"}},
		{name: "effort max passes through", model: "gpt-5.4@effort:max", base: "gpt-5.4", modifiers: ModelModifiers{Effort: "max", Thinking: "on"}},
		{name: "effort none disables", model: "deepseek-v4-pro@effort:none", base: "deepseek-v4-pro", modifiers: ModelModifiers{Effort: "none", Thinking: "off"}},
		{name: "thinking off", model: "claude-sonnet-4-5@thinking:off", base: "claude-sonnet-4-5", modifiers: ModelModifiers{Effort: "none", Thinking: "off"}},
		{name: "thinking on", model: "gemini-2.5-flash@thinking:on", base: "gemini-2.5-flash", modifiers: ModelModifiers{Thinking: "on"}},
		{name: "rightmost wins", model: "gpt-5@thinking:off@effort:LOW", base: "gpt-5", modifiers: ModelModifiers{Effort: "low", Thinking: "on"}},
		{name: "namespaced base", model: "openai/gpt-5@effort:low", base: "openai/gpt-5", modifiers: ModelModifiers{Effort: "low", Thinking: "on"}},
		{name: "vertex version tag stays", model: "claude-3-5-sonnet@20240620", base: "claude-3-5-sonnet@20240620"},
		{name: "vertex version with modifier", model: "claude-3-5-sonnet@20240620@effort:high", base: "claude-3-5-sonnet@20240620", modifiers: ModelModifiers{Effort: "high", Thinking: "on"}},
		{name: "plain name", model: "gpt-4o", base: "gpt-4o"},
		{name: "empty base is opaque", model: "@effort:high", base: "@effort:high"},
	}
	for _, tt := range tests {
		t.Run(tt.name, func(t *testing.T) {
			base, modifiers, err := ParseModelModifiers(tt.model)
			require.NoError(t, err)
			assert.Equal(t, tt.base, base)
			assert.Equal(t, tt.modifiers, modifiers)
		})
	}
}

func TestParseModelModifiersRejectsInvalid(t *testing.T) {
	for _, model := range []string{"gpt-5@effort:ultra", "gpt-5@thinking:maybe", "gpt-5@temperature:0.2", "gpt-5@effort:"} {
		_, _, err := ParseModelModifiers(model)
		assert.Error(t, err, model)
	}
}

// Legacy model-name suffixes keep their exact behavior next to @ modifiers.
func TestLegacyEffortSuffixesUnchanged(t *testing.T) {
	base, level, ok := TrimEffortSuffix("gemini-3-pro-preview-high")
	assert.True(t, ok)
	assert.Equal(t, "gemini-3-pro-preview", base)
	assert.Equal(t, "high", level)

	effort, base := ParseOpenAIReasoningEffortFromModelSuffix("gpt-5-xhigh")
	assert.Equal(t, "xhigh", effort)
	assert.Equal(t, "gpt-5", base)
	effort, base = ParseOpenAIReasoningEffortFromModelSuffix("gpt-5")
	assert.Empty(t, effort)
	assert.Equal(t, "gpt-5", base)

	// An @ modifier is never mistaken for a legacy suffix.
	_, _, ok = TrimEffortSuffix("gpt-5@effort:high")
	assert.False(t, ok)
}
