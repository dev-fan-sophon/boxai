package model

import (
	"context"
	"fmt"
	"io"
	"math"
	"net/http"
	"sort"
	"strings"
	"sync"
	"time"

	"github.com/dev-fan-sophon/boxai/common"
	"github.com/dev-fan-sophon/boxai/setting/ratio_setting"
)

// Official references for admin pricing: first-party list prices
// from models.dev, never reseller quotes or subscription-plan prices.
// models.dev costs are USD per 1M tokens; converted with the local ratio formula:
//
//	model_ratio = input_usd_per_1M * USD / 1000   (= input / 2 when USD=500)
const officialRatioPresetURL = "https://models.dev/api.json"

// models.dev input cost → local model_ratio divisor (mirrors controller/ratio_sync.go).
const modelsDevInputCostRatioBase = 1000.0

const officialRatioCacheTTL = 6 * time.Hour

type officialRatioSnapshot struct {
	references map[string]OfficialModelPricingReference
	fetchedAt  time.Time
}

type OfficialModelPricingReference struct {
	Currency               string              `json:"currency"`
	SourceURL              string              `json:"source_url"`
	VerifiedAt             string              `json:"verified_at,omitempty"`
	Notes                  string              `json:"notes,omitempty"`
	QuickDiscountSupported bool                `json:"quick_discount_supported"`
	Rates                  []OfficialPriceRate `json:"rates"`
	ModelName              string              `json:"model_name"`
	Provider               string              `json:"provider"`
	InputPrice             float64             `json:"input_price,omitempty"`
	OutputPrice            *float64            `json:"output_price,omitempty"`
	CacheReadPrice         *float64            `json:"cache_read_price,omitempty"`
	ModelRatio             float64             `json:"model_ratio,omitempty"`
	CompletionRatio        *float64            `json:"completion_ratio,omitempty"`
	CacheRatio             *float64            `json:"cache_ratio,omitempty"`
}

var (
	officialRatioMu          sync.RWMutex
	officialRatioCache       *officialRatioSnapshot
	officialRatioLastAttempt time.Time
)

// getOfficialRatioSnapshot returns a cached snapshot of models.dev pricing.
// On fetch failure it keeps the previous snapshot (if any) so pricing still works offline.
func getOfficialRatioSnapshot() *officialRatioSnapshot {
	officialRatioMu.RLock()
	cached := officialRatioCache
	officialRatioMu.RUnlock()
	if cached != nil && time.Since(cached.fetchedAt) < officialRatioCacheTTL {
		return cached
	}

	officialRatioMu.Lock()
	defer officialRatioMu.Unlock()
	if officialRatioCache != nil && time.Since(officialRatioCache.fetchedAt) < officialRatioCacheTTL {
		return officialRatioCache
	}
	if !officialRatioLastAttempt.IsZero() && time.Since(officialRatioLastAttempt) < 15*time.Minute {
		return officialRatioCache
	}

	officialRatioLastAttempt = time.Now()
	next, err := fetchOfficialRatioSnapshot(context.Background())
	if err != nil {
		common.SysLog("models.dev official price fetch failed: " + err.Error())
		return officialRatioCache
	}
	officialRatioCache = next
	return officialRatioCache
}

func fetchOfficialRatioSnapshot(ctx context.Context) (*officialRatioSnapshot, error) {
	reqCtx, cancel := context.WithTimeout(ctx, 12*time.Second)
	defer cancel()

	req, err := http.NewRequestWithContext(reqCtx, http.MethodGet, officialRatioPresetURL, nil)
	if err != nil {
		return nil, err
	}
	req.Header.Set("Accept", "application/json")
	req.Header.Set("User-Agent", "boxai-pricing/1.0")

	resp, err := http.DefaultClient.Do(req)
	if err != nil {
		return nil, err
	}
	defer resp.Body.Close()
	if resp.StatusCode < 200 || resp.StatusCode >= 300 {
		body, _ := io.ReadAll(io.LimitReader(resp.Body, 512))
		return nil, fmt.Errorf("models.dev HTTP %d: %s", resp.StatusCode, string(body))
	}

	body, err := io.ReadAll(io.LimitReader(resp.Body, 32<<20))
	if err != nil {
		return nil, err
	}

	return parseModelsDevSnapshot(body)
}

// models.dev JSON: { "<provider>": { "models": { "<id>": { "cost": { "input", "output", ... } } } } }
type modelsDevProvider struct {
	Models map[string]modelsDevModel `json:"models"`
}

type modelsDevModel struct {
	Cost       modelsDevCost `json:"cost"`
	Modalities struct {
		Output []string `json:"output"`
	} `json:"modalities"`
}

type modelsDevCost struct {
	Input           *float64        `json:"input"`
	Output          *float64        `json:"output"`
	CacheRead       *float64        `json:"cache_read"`
	CacheWrite      *float64        `json:"cache_write"`
	InputAudio      *float64        `json:"input_audio"`
	OutputAudio     *float64        `json:"output_audio"`
	Tiers           []modelsDevTier `json:"tiers"`
	ContextOver200K *modelsDevCost  `json:"context_over_200k"`
}

type modelsDevTier struct {
	modelsDevCost
	Tier struct {
		Type string `json:"type"`
		Size int    `json:"size"`
	} `json:"tier"`
}

type modelsDevCandidate struct {
	provider         string
	input            float64 // USD per 1M tokens
	output           *float64
	cacheRead        *float64
	tiered           bool
	multimodal       bool
	cost             modelsDevCost
	outputModalities []string
}

func parseModelsDevSnapshot(body []byte) (*officialRatioSnapshot, error) {
	var upstream map[string]modelsDevProvider
	if err := common.Unmarshal(body, &upstream); err != nil {
		return nil, fmt.Errorf("decode models.dev: %w", err)
	}
	if len(upstream) == 0 {
		return nil, fmt.Errorf("empty models.dev response")
	}

	providers := make([]string, 0, len(upstream))
	for provider := range upstream {
		providers = append(providers, provider)
	}
	sort.Strings(providers)

	// Sorted providers prefer international official endpoints (moonshotai before
	// moonshotai-cn, zai before zhipuai). Keep regional namespaced quotes separate.
	selected := make(map[string]modelsDevCandidate)
	for _, provider := range providers {
		if !isFirstPartyModelsDevProvider(provider) {
			continue
		}
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
			// Vertex also hosts partner models; only Google's own Gemini prices
			// are first-party list prices for this source.
			if provider == "google-vertex" && !strings.HasPrefix(modelName, "gemini-") {
				continue
			}
			model := providerData.Models[modelName]
			cost := model.Cost
			if cost.Input == nil {
				continue
			}
			input := *cost.Input
			if math.IsNaN(input) || math.IsInf(input, 0) || input < 0 {
				continue
			}
			// input=0 with positive output cannot become a local ratio baseline.
			if input == 0 {
				if cost.Output != nil && *cost.Output > 0 {
					continue
				}
				// pure free models are not useful as discount baselines
				continue
			}

			var output *float64
			if cost.Output != nil && *cost.Output >= 0 && !math.IsNaN(*cost.Output) && !math.IsInf(*cost.Output, 0) {
				value := *cost.Output
				output = &value
			}
			var cacheRead *float64
			if cost.CacheRead != nil && *cost.CacheRead >= 0 && !math.IsNaN(*cost.CacheRead) && !math.IsInf(*cost.CacheRead, 0) {
				value := *cost.CacheRead
				cacheRead = &value
			}
			multimodal := cost.InputAudio != nil && *cost.InputAudio != input || cost.OutputAudio != nil
			for _, modality := range model.Modalities.Output {
				if modality != "text" {
					multimodal = true
				}
			}
			next := modelsDevCandidate{
				provider:         provider,
				input:            input,
				output:           output,
				cacheRead:        cacheRead,
				tiered:           len(cost.Tiers) > 0 || cost.ContextOver200K != nil,
				multimodal:       multimodal,
				cost:             cost,
				outputModalities: model.Modalities.Output,
			}
			name := strings.ToLower(modelName)
			selected[provider+"/"+name] = next
			if _, exists := selected[name]; !exists {
				selected[name] = next
			}
		}
	}

	if len(selected) == 0 {
		return nil, fmt.Errorf("no valid models.dev pricing entries found")
	}

	references := make(map[string]OfficialModelPricingReference, len(selected))
	for modelName, candidate := range selected {
		// model_ratio = input_usd_per_1M * USD / 1000
		ratio := candidate.input * float64(ratio_setting.USD) / modelsDevInputCostRatioBase
		if ratio <= 0 || math.IsNaN(ratio) || math.IsInf(ratio, 0) {
			continue
		}
		reference := OfficialModelPricingReference{
			Currency:               "USD",
			SourceURL:              officialProviderPricingURL(candidate.provider),
			QuickDiscountSupported: !candidate.tiered && !candidate.multimodal,
			Rates:                  officialTokenPriceRates(candidate.cost, candidate.outputModalities),
			ModelName:              modelName,
			Provider:               candidate.provider,
			InputPrice:             candidate.input,
			OutputPrice:            candidate.output,
			CacheReadPrice:         candidate.cacheRead,
			ModelRatio:             ratio,
		}
		if candidate.output != nil {
			completionRatio := *candidate.output / candidate.input
			reference.CompletionRatio = &completionRatio
		}
		if candidate.cacheRead != nil {
			cacheRatio := *candidate.cacheRead / candidate.input
			reference.CacheRatio = &cacheRatio
		}
		references[modelName] = reference
	}

	if len(references) == 0 {
		return nil, fmt.Errorf("no convertible models.dev ratios")
	}

	return &officialRatioSnapshot{
		references: references,
		fetchedAt:  time.Now(),
	}, nil
}

func GetOfficialModelPricingReference(modelName string) (*OfficialModelPricingReference, bool) {
	if reference, ok := documentedOfficialPricingReferences[officialPricingModelName(modelName)]; ok {
		reference.ModelName = modelName
		return &reference, true
	}
	snapshot := getOfficialRatioSnapshot()
	if snapshot == nil || time.Since(snapshot.fetchedAt) > officialRatioCacheTTL {
		return nil, false
	}
	return lookupOfficialModelPricingReference(snapshot, modelName)
}

func lookupOfficialModelPricingReference(snapshot *officialRatioSnapshot, modelName string) (*OfficialModelPricingReference, bool) {
	name := officialPricingModelName(modelName)
	reference, ok := snapshot.references[name]
	if !ok && strings.Count(name, "/") == 1 {
		provider, leaf, _ := strings.Cut(name, "/")
		reference, ok = snapshot.references[leaf]
		ok = ok && provider == reference.Provider
	}
	if !ok {
		return nil, false
	}
	reference.ModelName = modelName
	return &reference, true
}

// firstPartyModelsDevProviders are vendor list-price sources on models.dev.
var firstPartyModelsDevProviders = map[string]struct{}{
	"openai":        {},
	"anthropic":     {},
	"google":        {},
	"google-vertex": {},
	"xai":           {},
	"deepseek":      {},
	"zhipuai":       {},
	"zai":           {},
	"moonshotai":    {},
	"moonshotai-cn": {},
	"xiaomi":        {},
	"meta":          {},
}

func isFirstPartyModelsDevProvider(provider string) bool {
	_, ok := firstPartyModelsDevProviders[provider]
	return ok
}

// Official product aliases are independent of channel routing. DeepSeek's docs
// identify deepseek-flash as V4.1 Flash: https://api-docs.deepseek.com/ .
func officialPricingModelName(modelName string) string {
	name := strings.ToLower(strings.TrimSpace(modelName))
	switch name {
	case "deepseek-v4.1-flash", "deepseek-v4.1-flash-1017":
		return "deepseek-flash"
	case "deepseek/deepseek-v4.1-flash", "deepseek/deepseek-v4.1-flash-1017":
		return "deepseek/deepseek-flash"
	default:
		return name
	}
}
