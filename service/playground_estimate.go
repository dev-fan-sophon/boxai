package service

import (
	"fmt"
	"math"
	"strings"

	"github.com/QuantumNous/new-api/common"
	relaycommon "github.com/QuantumNous/new-api/relay/common"
	"github.com/QuantumNous/new-api/setting/ratio_setting"
)

// PlaygroundEstimateRequest is the estimate API body.
type PlaygroundEstimateRequest struct {
	Modality     string  `json:"modality"` // chat | image | video | audio
	Model        string  `json:"model"`
	Group        string  `json:"group"`
	N            int     `json:"n"`
	Size         string  `json:"size"`
	Duration     float64 `json:"duration"`
	HasReference bool    `json:"has_reference"`
	MaxTokens    int     `json:"max_tokens"`
	PromptTokens int     `json:"prompt_tokens"` // optional hint
}

// PlaygroundEstimateResult is a structured, non-invented price estimate.
type PlaygroundEstimateResult struct {
	Kind        string   `json:"kind"` // per_request | token | unknown
	Quota       *int     `json:"quota,omitempty"`
	Amount      *float64 `json:"amount,omitempty"` // USD-equivalent using QuotaPerUnit
	AmountLabel string   `json:"amount_label,omitempty"`
	GroupRatio  float64  `json:"group_ratio"`
	ModelPrice  *float64 `json:"model_price,omitempty"`
	ModelRatio  *float64 `json:"model_ratio,omitempty"`
	Message     string   `json:"message,omitempty"`
}

// EstimatePlaygroundCost reuses site model_price / model_ratio / group_ratio.
// It never invents prices when neither price nor ratio is configured.
// Unlike billing, it does NOT use the self-use 37.5 fallback for unknown models.
func EstimatePlaygroundCost(req PlaygroundEstimateRequest) PlaygroundEstimateResult {
	modelName := strings.TrimSpace(req.Model)
	group := strings.TrimSpace(req.Group)
	if group == "" {
		group = "default"
	}
	groupRatio := ratio_setting.GetGroupRatio(group)
	if groupRatio <= 0 || math.IsNaN(groupRatio) || math.IsInf(groupRatio, 0) {
		groupRatio = 1
	}

	result := PlaygroundEstimateResult{
		Kind:       "unknown",
		GroupRatio: groupRatio,
	}
	if modelName == "" {
		result.Message = "model is required"
		return result
	}

	n := req.N
	if n <= 0 {
		n = 1
	}
	if n > 128 {
		n = 128
	}

	// Fixed price: only when explicitly present in model_price map
	price, usePrice := ratio_setting.GetModelPrice(modelName, false)
	if usePrice && price >= 0 {
		amount := price * float64(n) * groupRatio
		if amount < 0 {
			amount = 0
		}
		quotaVal, err := common.QuotaFromFloatStrict(amount * common.QuotaPerUnit)
		if err != nil {
			quotaVal = common.QuotaFromFloat(amount * common.QuotaPerUnit)
		}
		result.Kind = "per_request"
		result.ModelPrice = &price
		result.Amount = &amount
		result.Quota = &quotaVal
		result.AmountLabel = formatAmountLabel(amount)
		if req.HasReference {
			result.Message = "reference media may use edit/i2v routes; estimate uses base model price"
		}
		return result
	}

	// Token ratio: only when model is explicitly in the ratio map (no self-use default)
	modelRatio, ok := configuredModelRatio(modelName)
	if !ok {
		result.Message = "model price/ratio not configured"
		return result
	}

	promptTokens := req.PromptTokens
	assumedPrompt := false
	if promptTokens <= 0 {
		promptTokens = 500
		if req.Modality == "image" || req.Modality == "video" || req.Modality == "audio" {
			promptTokens = 1000
		}
		assumedPrompt = true
	}
	maxTokens := req.MaxTokens
	if maxTokens < 0 {
		maxTokens = 0
	}
	if maxTokens > 128000 {
		maxTokens = 128000
	}

	duration := req.Duration
	if duration < 0 {
		duration = 0
	}
	if duration > float64(relaycommon.MaxTaskDurationSeconds) {
		duration = float64(relaycommon.MaxTaskDurationSeconds)
	}

	tokens := float64(promptTokens + maxTokens)
	if req.Modality == "video" && duration > 0 {
		tokens = tokens * math.Max(1, duration/5)
	}
	quotaFloat := tokens * modelRatio * groupRatio
	quotaVal := common.QuotaFromFloat(quotaFloat)
	amount := float64(quotaVal) / common.QuotaPerUnit
	result.Kind = "token"
	result.ModelRatio = &modelRatio
	result.Quota = &quotaVal
	result.Amount = &amount
	result.AmountLabel = formatAmountLabel(amount)
	if assumedPrompt {
		result.Message = fmt.Sprintf("assumed ~%d prompt tokens for display; not a billable quote", promptTokens)
	}
	return result
}

// configuredModelRatio returns the ratio only if the model is present in the
// configured map (or compact wildcard). It never returns the self-use 37.5 default.
func configuredModelRatio(name string) (float64, bool) {
	name = ratio_setting.FormatMatchingModelName(name)
	copyMap := ratio_setting.GetModelRatioCopy()
	if r, ok := copyMap[name]; ok {
		return r, true
	}
	// compact suffix wildcard (same as GetModelRatio, but without self-use fallback)
	if strings.HasSuffix(name, ratio_setting.CompactModelSuffix) {
		if r, ok := copyMap[ratio_setting.CompactWildcardModelKey]; ok {
			return r, true
		}
	}
	return 0, false
}

func formatAmountLabel(amount float64) string {
	if amount <= 0 {
		return "$0"
	}
	if amount >= 1 {
		return fmt.Sprintf("$%.4f", amount)
	}
	if amount >= 0.01 {
		return fmt.Sprintf("$%.4f", amount)
	}
	return fmt.Sprintf("$%.6f", amount)
}
