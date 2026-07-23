package service

import (
	"github.com/QuantumNous/new-api/common"
	"github.com/QuantumNous/new-api/setting/operation_setting"
	"github.com/shopspring/decimal"
)

// ManagedXAISearchReservationQuota reserves a conservative platform-owned
// tool-call allowance. Some OpenAI-compatible xAI upstreams do not enforce
// max_turns, so reservation must not assume turns equal actual calls.
func ManagedXAISearchReservationQuota(modelName string, reservedCalls int, groupRatio float64) (int, *common.QuotaClamp) {
	if reservedCalls <= 0 || groupRatio <= 0 {
		return 0, nil
	}
	webPrice := operation_setting.GetToolPriceForModel("xai_web_search", modelName)
	xPrice := operation_setting.GetToolPriceForModel("xai_x_search", modelName)
	maxPrice := decimal.NewFromFloat(webPrice)
	if decimal.NewFromFloat(xPrice).GreaterThan(maxPrice) {
		maxPrice = decimal.NewFromFloat(xPrice)
	}
	quota := maxPrice.
		Mul(decimal.NewFromInt(int64(reservedCalls))).
		Div(decimal.NewFromInt(1000)).
		Mul(decimal.NewFromFloat(common.QuotaPerUnit)).
		Mul(decimal.NewFromFloat(groupRatio))
	return common.QuotaFromDecimalChecked(quota)
}

// ToolCallUsage captures all tool call counts from a single request.
type ToolCallUsage struct {
	ModelName              string
	WebSearchCalls         int
	WebSearchToolName      string // "web_search_preview", "web_search", etc.
	FileSearchCalls        int
	ImageGenerationCall    bool
	ImageGenerationQuality string
	ImageGenerationSize    string
}

// ToolCallItem represents a single billed tool usage line.
type ToolCallItem struct {
	Name       string  `json:"name"`
	CallCount  int     `json:"call_count"`
	PricePer1K float64 `json:"price_per_1k"`
	TotalPrice float64 `json:"total_price"`
	Quota      int     `json:"quota"`
}

// ToolCallResult holds the aggregated tool call billing for a request.
type ToolCallResult struct {
	TotalQuota int            `json:"total_quota"`
	Items      []ToolCallItem `json:"items,omitempty"`
}

// ComputeToolCallQuota calculates the total quota for all tool calls in a
// request. Tool prices are resolved via GetToolPriceForModel which supports
// model-prefix overrides. groupRatio is applied.
func ComputeToolCallQuota(usage ToolCallUsage, groupRatio float64) ToolCallResult {
	var items []ToolCallItem
	totalQuota := 0

	addItem := func(toolName string, count int) {
		if count <= 0 {
			return
		}
		pricePer1K := operation_setting.GetToolPriceForModel(toolName, usage.ModelName)
		if pricePer1K <= 0 {
			return
		}
		totalPrice := pricePer1K * float64(count) / 1000
		quota := common.QuotaRound(totalPrice * common.QuotaPerUnit * groupRatio)
		items = append(items, ToolCallItem{
			Name:       toolName,
			CallCount:  count,
			PricePer1K: pricePer1K,
			TotalPrice: totalPrice,
			Quota:      quota,
		})
		totalQuota += quota
	}

	if usage.WebSearchCalls > 0 && usage.WebSearchToolName != "" {
		addItem(usage.WebSearchToolName, usage.WebSearchCalls)
	}

	if usage.FileSearchCalls > 0 {
		addItem("file_search", usage.FileSearchCalls)
	}

	if usage.ImageGenerationCall {
		price := operation_setting.GetGPTImage1PriceOnceCall(usage.ImageGenerationQuality, usage.ImageGenerationSize)
		quota := common.QuotaRound(price * common.QuotaPerUnit * groupRatio)
		items = append(items, ToolCallItem{
			Name:       "image_generation",
			CallCount:  1,
			PricePer1K: price,
			TotalPrice: price,
			Quota:      quota,
		})
		totalQuota += quota
	}

	return ToolCallResult{
		TotalQuota: totalQuota,
		Items:      items,
	}
}
