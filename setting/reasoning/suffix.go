package reasoning

import (
	"fmt"
	"strings"

	"github.com/samber/lo"
)

var EffortSuffixes = []string{"-max", "-xhigh", "-high", "-medium", "-low", "-minimal"}

var OpenAIEffortSuffixes = []string{"-high", "-minimal", "-low", "-medium", "-none", "-xhigh"}

var DeepSeekV4EffortSuffixes = []string{"-none", "-low", "-max"}

// TrimEffortSuffix -> modelName level(low) exists
func TrimEffortSuffix(modelName string) (string, string, bool) {
	return TrimEffortSuffixWithSuffixes(modelName, EffortSuffixes)
}

func TrimEffortSuffixWithSuffixes(modelName string, suffixes []string) (string, string, bool) {
	suffix, found := lo.Find(suffixes, func(s string) bool {
		return strings.HasSuffix(modelName, s)
	})
	if !found {
		return modelName, "", false
	}
	return strings.TrimSuffix(modelName, suffix), strings.TrimPrefix(suffix, "-"), true
}

func ParseOpenAIReasoningEffortFromModelSuffix(modelName string) (string, string) {
	baseModel, effort, ok := TrimEffortSuffixWithSuffixes(modelName, OpenAIEffortSuffixes)
	if !ok {
		return "", modelName
	}
	return effort, baseModel
}

func ParseDeepSeekV4ThinkingSuffix(modelName string) (baseModel string, thinkingType string, effort string, ok bool) {
	baseModel, suffix, ok := TrimEffortSuffixWithSuffixes(modelName, DeepSeekV4EffortSuffixes)
	if !ok || baseModel != "deepseek-flash" && !strings.HasPrefix(baseModel, "deepseek-v4-") {
		return modelName, "", "", false
	}
	switch suffix {
	case "none":
		return baseModel, "disabled", "", true
	case "low", "max":
		// -low and deepseek-flash follow DeepSeek V4.1 (upstream 6cf0d90b5).
		return baseModel, "enabled", suffix, true
	default:
		return modelName, "", "", false
	}
}

// ModelModifiers is the reasoning intent of explicit trailing @key:value
// model-name modifiers (upstream 7c044d7c5), e.g. gpt-5@effort:high or
// claude-sonnet-4-5@thinking:off. Thinking is "on", "off" or empty.
type ModelModifiers struct {
	Effort   string
	Thinking string
}

func (m ModelModifiers) IsEmpty() bool {
	return m.Effort == "" && m.Thinking == ""
}

var modelModifierEfforts = map[string]struct{}{
	"none": {}, "minimal": {}, "low": {}, "medium": {}, "high": {}, "xhigh": {}, "max": {},
}

// ParseModelModifiers removes a contiguous trailing chain of @key:value
// segments and returns the base model name. Other @ characters (for example
// Vertex claude-...@20250514) stay part of the opaque name. Modifiers apply
// left to right, so the rightmost value wins: @thinking:off and @effort:none
// turn thinking off, @effort:<level> turns it on at that level. Effort values
// pass through unchanged; no level is silently remapped (upstream 6b659fd61).
// Unknown keys and invalid values are client errors.
func ParseModelModifiers(modelName string) (string, ModelModifiers, error) {
	parts := strings.Split(modelName, "@")
	first := len(parts)
	for i := len(parts) - 1; i > 0; i-- {
		colon := strings.IndexByte(parts[i], ':')
		if colon <= 0 || !isModifierKey(parts[i][:colon]) {
			break
		}
		first = i
	}
	base := strings.Join(parts[:first], "@")
	if first == len(parts) || base == "" {
		return modelName, ModelModifiers{}, nil
	}

	var modifiers ModelModifiers
	for _, segment := range parts[first:] {
		key, value, _ := strings.Cut(segment, ":")
		value = strings.ToLower(strings.TrimSpace(value))
		switch strings.ToLower(key) {
		case "effort":
			if _, ok := modelModifierEfforts[value]; !ok {
				return "", ModelModifiers{}, fmt.Errorf("invalid effort modifier value %q: must be one of none/minimal/low/medium/high/xhigh/max", value)
			}
			if value == "none" {
				modifiers = ModelModifiers{Effort: "none", Thinking: "off"}
				continue
			}
			modifiers = ModelModifiers{Effort: value, Thinking: "on"}
		case "thinking":
			switch value {
			case "on", "adaptive":
				if modifiers.Effort == "none" {
					modifiers.Effort = ""
				}
				modifiers.Thinking = "on"
			case "off":
				modifiers = ModelModifiers{Effort: "none", Thinking: "off"}
			default:
				return "", ModelModifiers{}, fmt.Errorf("invalid thinking modifier value %q: must be on, adaptive or off", value)
			}
		default:
			return "", ModelModifiers{}, fmt.Errorf("unsupported model modifier %q", key)
		}
	}
	return base, modifiers, nil
}

func isModifierKey(key string) bool {
	for i, r := range key {
		letter := r >= 'a' && r <= 'z' || r >= 'A' && r <= 'Z'
		if i == 0 && !letter || i > 0 && !letter && (r < '0' || r > '9') && r != '_' && r != '-' {
			return false
		}
	}
	return key != ""
}
