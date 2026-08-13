package modelsdev

import (
	"encoding/json"
	"fmt"
	"sort"
	"strings"

	"github.com/dev-fan-sophon/boxai/common"
)

const (
	APIURL    = "https://models.dev/api.json"
	ModelsURL = "https://models.dev/models.json"
)

// Provider is one models.dev /api.json vendor bucket.
type Provider struct {
	ID     string           `json:"id"`
	Name   string           `json:"name"`
	Models map[string]Model `json:"models"`
}

// Model is one provider-served model on models.dev.
type Model struct {
	ID               string            `json:"id"`
	Name             string            `json:"name"`
	Description      string            `json:"description"`
	Family           string            `json:"family"`
	Attachment       bool              `json:"attachment"`
	Reasoning        bool              `json:"reasoning"`
	ReasoningOptions []ReasoningOption `json:"reasoning_options"`
	ToolCall         bool              `json:"tool_call"`
	StructuredOutput bool              `json:"structured_output"`
	Temperature      *bool             `json:"temperature"`
	Knowledge        string            `json:"knowledge"`
	ReleaseDate      string            `json:"release_date"`
	LastUpdated      string            `json:"last_updated"`
	OpenWeights      bool              `json:"open_weights"`
	Status           string            `json:"status"`
	Interleaved      json.RawMessage   `json:"interleaved"`
	Modalities       Modalities        `json:"modalities"`
	Limit            Limit             `json:"limit"`
	Cost             Cost              `json:"cost"`
}

type Modalities struct {
	Input  []string `json:"input"`
	Output []string `json:"output"`
}

type Limit struct {
	Context int `json:"context"`
	Input   int `json:"input"`
	Output  int `json:"output"`
}

type Cost struct {
	Input      *float64 `json:"input"`
	Output     *float64 `json:"output"`
	CacheRead  *float64 `json:"cache_read"`
	CacheWrite *float64 `json:"cache_write"`
	Reasoning  *float64 `json:"reasoning"`
}

// ReasoningOption is one models.dev reasoning control.
// type is effort | toggle | budget_tokens.
type ReasoningOption struct {
	Type   string   `json:"type"`
	Values []string `json:"values,omitempty"`
	Min    *int     `json:"min,omitempty"`
	Max    *int     `json:"max,omitempty"`
}

// CatalogEntry is the first-party snapshot we persist and expose.
type CatalogEntry struct {
	ModelName          string
	VendorNamespace    string
	VendorName         string
	DisplayName        string
	Description        string
	Family             string
	KnowledgeCutoff    string
	ReleaseDate        string
	LastUpdated        string
	ContextLength      int
	MaxInputTokens     int
	MaxOutputTokens    int
	InputModalities    []string
	OutputModalities   []string
	Capabilities       []string
	SupportedReasoning bool
	ReasoningEfforts   []string
	ReasoningOptions   []ReasoningOption
	Temperature        *bool
	Attachment         bool
	OpenWeights        bool
	Interleaved        json.RawMessage
	Status             string
}

var vendorDisplayNames = map[string]string{
	"deepreinforce":    "DeepReinforce",
	"deepseek":         "DeepSeek",
	"minimax":          "MiniMax",
	"moonshotai":       "Moonshot AI",
	"nvidia":           "NVIDIA",
	"openai":           "OpenAI",
	"poolside":         "Poolside",
	"sakana":           "Sakana AI",
	"sarvam":           "Sarvam AI",
	"stepfun":          "StepFun",
	"thinkingmachines": "Thinking Machines",
	"xai":              "xAI",
	"zhipuai":          "Zhipu AI",
}

var vendorIconKeys = map[string]string{
	"alibaba":          "Alibaba",
	"anthropic":        "Anthropic",
	"cohere":           "Cohere",
	"deepreinforce":    "ModelProvider",
	"deepseek":         "DeepSeek",
	"google":           "Google",
	"meituan":          "LongCat",
	"meta":             "Meta",
	"microsoft":        "Microsoft",
	"minimax":          "Minimax",
	"mistral":          "Mistral",
	"moonshotai":       "Moonshot",
	"nvidia":           "Nvidia",
	"openai":           "OpenAI",
	"perplexity":       "Perplexity",
	"poolside":         "ModelProvider",
	"sakana":           "ModelProvider",
	"sarvam":           "ModelProvider",
	"stepfun":          "Stepfun",
	"tencent":          "Tencent",
	"thinkingmachines": "ModelProvider",
	"xai":              "XAI",
	"xiaomi":           "XiaomiMiMo",
	"zhipuai":          "Zhipu",
}

// firstPartyProviders are vendor list-price sources on models.dev.
var firstPartyProviders = map[string]struct{}{
	"openai":        {},
	"anthropic":     {},
	"google":        {},
	"xai":           {},
	"deepseek":      {},
	"zhipuai":       {},
	"moonshotai":    {},
	"moonshotai-cn": {},
}

var effortOrder = map[string]int{
	"none":    0,
	"minimal": 1,
	"low":     2,
	"medium":  3,
	"high":    4,
	"xhigh":   5,
	"max":     6,
}

// VendorDisplayName returns the BoxAI vendor label for a models.dev namespace.
func VendorDisplayName(namespace string) string {
	namespace = strings.ToLower(strings.TrimSpace(namespace))
	if name := vendorDisplayNames[namespace]; name != "" {
		return name
	}
	if namespace == "" {
		return ""
	}
	return strings.ToUpper(namespace[:1]) + namespace[1:]
}

// VendorIconKey returns the Lobe icon key for a models.dev namespace.
func VendorIconKey(namespace string) string {
	return vendorIconKeys[strings.ToLower(strings.TrimSpace(namespace))]
}

// IsFirstPartyProvider reports whether provider is a first-party models.dev lab.
func IsFirstPartyProvider(provider string) bool {
	_, ok := firstPartyProviders[strings.ToLower(strings.TrimSpace(provider))]
	return ok
}

// ParseAPICatalog converts models.dev /api.json into one CatalogEntry per
// unique model id. First-party providers win over reseller mirrors.
func ParseAPICatalog(body []byte) ([]CatalogEntry, error) {
	var upstream map[string]Provider
	if err := common.Unmarshal(body, &upstream); err != nil {
		return nil, fmt.Errorf("decode models.dev api.json: %w", err)
	}
	if len(upstream) == 0 {
		return nil, fmt.Errorf("empty models.dev api.json")
	}

	providers := make([]string, 0, len(upstream))
	for provider := range upstream {
		providers = append(providers, provider)
	}
	sort.Strings(providers)

	selected := make(map[string]CatalogEntry)
	selectedProvider := make(map[string]string)
	for _, provider := range providers {
		providerData := upstream[provider]
		if len(providerData.Models) == 0 {
			continue
		}
		modelNames := make([]string, 0, len(providerData.Models))
		for modelName := range providerData.Models {
			modelNames = append(modelNames, modelName)
		}
		sort.Strings(modelNames)
		for _, modelName := range modelNames {
			entry, ok := catalogEntryFromProviderModel(provider, providerData.Models[modelName])
			if !ok {
				continue
			}
			currentProvider, exists := selectedProvider[entry.ModelName]
			if !exists || shouldReplaceCatalogEntry(currentProvider, provider) {
				selected[entry.ModelName] = entry
				selectedProvider[entry.ModelName] = provider
			}
		}
	}

	if len(selected) == 0 {
		return nil, fmt.Errorf("no valid models.dev catalog entries found")
	}

	names := make([]string, 0, len(selected))
	for name := range selected {
		names = append(names, name)
	}
	sort.Strings(names)
	entries := make([]CatalogEntry, 0, len(names))
	for _, name := range names {
		entries = append(entries, selected[name])
	}
	return entries, nil
}

func catalogEntryFromProviderModel(provider string, item Model) (CatalogEntry, bool) {
	modelName := strings.TrimSpace(item.ID)
	if modelName == "" {
		modelName = strings.TrimSpace(provider)
	}
	if slash := strings.LastIndex(modelName, "/"); slash >= 0 && slash+1 < len(modelName) {
		modelName = modelName[slash+1:]
	}
	if modelName == "" {
		return CatalogEntry{}, false
	}

	namespace := strings.ToLower(strings.TrimSpace(provider))
	entry := CatalogEntry{
		ModelName:          modelName,
		VendorNamespace:    namespace,
		VendorName:         VendorDisplayName(namespace),
		DisplayName:        strings.TrimSpace(item.Name),
		Description:        strings.TrimSpace(item.Description),
		Family:             strings.TrimSpace(item.Family),
		KnowledgeCutoff:    strings.TrimSpace(item.Knowledge),
		ReleaseDate:        strings.TrimSpace(item.ReleaseDate),
		LastUpdated:        strings.TrimSpace(item.LastUpdated),
		ContextLength:      item.Limit.Context,
		MaxInputTokens:     item.Limit.Input,
		MaxOutputTokens:    item.Limit.Output,
		InputModalities:    normalizeStringList(item.Modalities.Input),
		OutputModalities:   normalizeStringList(item.Modalities.Output),
		Capabilities:       capabilitiesFromModel(item),
		SupportedReasoning: item.Reasoning,
		ReasoningEfforts:   effortValuesFromOptions(item.ReasoningOptions),
		ReasoningOptions:   cloneReasoningOptions(item.ReasoningOptions),
		Temperature:        item.Temperature,
		Attachment:         item.Attachment,
		OpenWeights:        item.OpenWeights,
		Interleaved:        append(json.RawMessage(nil), item.Interleaved...),
		Status:             strings.TrimSpace(item.Status),
	}
	return entry, true
}

func shouldReplaceCatalogEntry(currentProvider, nextProvider string) bool {
	curOfficial := IsFirstPartyProvider(currentProvider)
	nextOfficial := IsFirstPartyProvider(nextProvider)
	if curOfficial != nextOfficial {
		return nextOfficial
	}
	return nextProvider < currentProvider
}

func capabilitiesFromModel(item Model) []string {
	caps := make([]string, 0, 8)
	if item.ToolCall {
		caps = append(caps, "tools", "function_calling")
	}
	if item.StructuredOutput {
		caps = append(caps, "structured_output")
	}
	if item.Reasoning {
		caps = append(caps, "reasoning")
	}
	if item.Attachment {
		caps = append(caps, "attachment")
	}
	if item.OpenWeights {
		caps = append(caps, "open_weights")
	}
	if item.Temperature != nil && *item.Temperature {
		caps = append(caps, "temperature")
	}
	if hasModality(item.Modalities.Input, "image") {
		caps = append(caps, "vision")
	}
	return normalizeStringList(caps)
}

func effortValuesFromOptions(options []ReasoningOption) []string {
	seen := make(map[string]struct{})
	values := make([]string, 0)
	for _, option := range options {
		if strings.TrimSpace(option.Type) != "effort" {
			continue
		}
		for _, value := range option.Values {
			value = strings.ToLower(strings.TrimSpace(value))
			if value == "" {
				continue
			}
			if _, ok := seen[value]; ok {
				continue
			}
			seen[value] = struct{}{}
			values = append(values, value)
		}
	}
	sort.Slice(values, func(i, j int) bool {
		left, leftOK := effortOrder[values[i]]
		right, rightOK := effortOrder[values[j]]
		if leftOK && rightOK {
			return left < right
		}
		if leftOK != rightOK {
			return leftOK
		}
		return values[i] < values[j]
	})
	return values
}

func cloneReasoningOptions(options []ReasoningOption) []ReasoningOption {
	if len(options) == 0 {
		return nil
	}
	cloned := make([]ReasoningOption, 0, len(options))
	for _, option := range options {
		next := ReasoningOption{
			Type: strings.TrimSpace(option.Type),
		}
		if len(option.Values) > 0 {
			next.Values = append([]string(nil), option.Values...)
		}
		if option.Min != nil {
			value := *option.Min
			next.Min = &value
		}
		if option.Max != nil {
			value := *option.Max
			next.Max = &value
		}
		if next.Type == "" && len(next.Values) == 0 && next.Min == nil && next.Max == nil {
			continue
		}
		cloned = append(cloned, next)
	}
	return cloned
}

func hasModality(values []string, want string) bool {
	for _, value := range values {
		if strings.EqualFold(strings.TrimSpace(value), want) {
			return true
		}
	}
	return false
}

func normalizeStringList(values []string) []string {
	seen := make(map[string]struct{}, len(values))
	normalized := make([]string, 0, len(values))
	for _, value := range values {
		value = strings.TrimSpace(value)
		if value == "" {
			continue
		}
		if _, ok := seen[value]; ok {
			continue
		}
		seen[value] = struct{}{}
		normalized = append(normalized, value)
	}
	return normalized
}

// MarshalJSONList encodes a string slice as compact JSON, or "" when empty.
func MarshalJSONList(values []string) string {
	if len(values) == 0 {
		return ""
	}
	encoded, err := common.Marshal(values)
	if err != nil {
		return ""
	}
	return string(encoded)
}

// MarshalJSONValue encodes v as compact JSON, or "" when empty.
func MarshalJSONValue(v any) string {
	if v == nil {
		return ""
	}
	encoded, err := common.Marshal(v)
	if err != nil {
		return ""
	}
	if len(encoded) == 0 || string(encoded) == "null" || string(encoded) == "[]" || string(encoded) == "{}" {
		return ""
	}
	return string(encoded)
}
