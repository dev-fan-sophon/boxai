package codexproxy

import "strings"

var baseModelList = []string{
	"gpt-5.6-sol",
	"gpt-5.6-terra",
	"gpt-5.6-luna",
	"gpt-5.5",
}

var ModelList = ExpandModelList(baseModelList)

const ChannelName = "codex-proxy"

// ExpandModelList keeps only protocols this provider can safely expose and
// de-duplicates the upstream catalog. It deliberately does not synthesize
// aliases for the retired Responses Compact endpoint.
func ExpandModelList(models []string) []string {
	result := make([]string, 0, len(models))
	seen := make(map[string]struct{}, len(models))
	for _, model := range models {
		model = strings.TrimSpace(model)
		if model == "" || unsupportedModel(model) {
			continue
		}
		if _, exists := seen[model]; exists {
			continue
		}
		seen[model] = struct{}{}
		result = append(result, model)
	}
	return result
}

func unsupportedModel(model string) bool {
	normalized := strings.ToLower(strings.TrimSpace(model))
	return normalized == "codex-auto-review" ||
		strings.HasSuffix(normalized, "-openai-compact") ||
		strings.Contains(normalized, "audio") ||
		strings.Contains(normalized, "video") ||
		strings.Contains(normalized, "realtime")
}
