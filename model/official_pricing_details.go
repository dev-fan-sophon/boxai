package model

import (
	_ "embed"
	"math"
	"sort"
	"strings"

	"github.com/dev-fan-sophon/boxai/common"
)

// OfficialPriceRate is a reference, not a billing rule. Units and conditions
// must stay attached to amounts; media and tier rows cannot become flat ratios.
type OfficialPriceRate struct {
	Category            string  `json:"category"`
	Unit                string  `json:"unit"`
	Price               float64 `json:"price"`
	Variant             string  `json:"variant,omitempty"`
	Condition           string  `json:"condition,omitempty"`
	ContextMinExclusive *int    `json:"context_min_exclusive,omitempty"`
	ContextMaxInclusive *int    `json:"context_max_inclusive,omitempty"`
}

// These dated, first-party documentation snapshots cover dimensions missing
// from models.dev. They never set sale prices or feed generic discount badges.
//
//go:embed official_media_pricing.json
var documentedOfficialPricingJSON []byte

var documentedOfficialPricingReferences = func() map[string]OfficialModelPricingReference {
	var entries []struct {
		Models []string `json:"models"`
		OfficialModelPricingReference
	}
	if err := common.Unmarshal(documentedOfficialPricingJSON, &entries); err != nil {
		panic("invalid embedded official media pricing: " + err.Error())
	}
	result := make(map[string]OfficialModelPricingReference)
	for _, entry := range entries {
		for _, name := range entry.Models {
			reference := entry.OfficialModelPricingReference
			reference.ModelName = name
			result[name] = reference
			result[reference.Provider+"/"+name] = reference
		}
	}
	return result
}()

func officialProviderPricingURL(provider string) string {
	switch provider {
	case "openai":
		return "https://developers.openai.com/api/docs/pricing"
	case "anthropic":
		return "https://platform.claude.com/docs/en/about-claude/pricing"
	case "google":
		return "https://ai.google.dev/gemini-api/docs/pricing"
	case "google-vertex":
		return "https://cloud.google.com/vertex-ai/generative-ai/pricing"
	case "xai":
		return "https://docs.x.ai/developers/pricing"
	case "deepseek":
		return "https://api-docs.deepseek.com/quick_start/pricing"
	case "zai":
		return "https://docs.z.ai/guides/overview/pricing"
	case "zhipuai":
		return "https://open.bigmodel.cn/pricing"
	case "moonshotai":
		return "https://platform.moonshot.ai/docs/pricing/chat"
	case "moonshotai-cn":
		return "https://platform.moonshot.cn/docs/pricing/chat"
	case "xiaomi":
		return "https://mimo.mi.com/docs/price/pay-as-you-go"
	case "meta":
		return "https://dev.meta.ai/models/muse-spark"
	default:
		return ""
	}
}

func officialTokenPriceRates(cost modelsDevCost, outputModalities []string) []OfficialPriceRate {
	tiers := append([]modelsDevTier(nil), cost.Tiers...)
	// models.dev repeats modern tiers in this legacy field. Use it only when
	// there are no explicit tiers, preserving the documented 200K boundary.
	if len(tiers) == 0 && cost.ContextOver200K != nil {
		tier := modelsDevTier{modelsDevCost: *cost.ContextOver200K}
		tier.Tier.Type, tier.Tier.Size = "context", 200000
		tiers = append(tiers, tier)
	}
	sort.SliceStable(tiers, func(i, j int) bool { return tiers[i].Tier.Size < tiers[j].Tier.Size })
	outputCategory := "text_output"
	for _, modality := range outputModalities {
		if modality == "image" {
			// models.dev's generic output field for image models is image-token
			// pricing, not text output. Documented snapshots supply missing text rates.
			outputCategory = "image_output"
		}
	}
	levels := append([]modelsDevTier{{modelsDevCost: cost}}, tiers...)
	var rates []OfficialPriceRate
	for i, level := range levels {
		var lower, upper *int
		condition := ""
		if i > 0 {
			if level.Tier.Type == "context" && level.Tier.Size > 0 {
				value := level.Tier.Size
				lower = &value
			} else {
				condition = "Tier conditions not supplied by the source; consult official documentation."
			}
		}
		if i+1 < len(levels) && levels[i+1].Tier.Type == "context" && levels[i+1].Tier.Size > 0 {
			value := levels[i+1].Tier.Size
			upper = &value
		}
		for _, field := range []struct {
			category string
			price    *float64
		}{
			{"text_input", level.Input}, {outputCategory, level.Output},
			{"cache_read", level.CacheRead}, {"cache_write", level.CacheWrite},
			{"audio_input", level.InputAudio}, {"audio_output", level.OutputAudio},
		} {
			if field.price == nil || *field.price < 0 || math.IsNaN(*field.price) || math.IsInf(*field.price, 0) {
				continue
			}
			rates = append(rates, OfficialPriceRate{Category: field.category, Unit: "million_tokens", Price: *field.price,
				ContextMinExclusive: lower, ContextMaxInclusive: upper, Condition: strings.TrimSpace(condition)})
		}
	}
	return rates
}
