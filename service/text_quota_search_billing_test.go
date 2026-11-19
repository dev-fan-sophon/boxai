package service

import (
	"testing"

	"github.com/dev-fan-sophon/boxai/common"
	"github.com/dev-fan-sophon/boxai/dto"
	relaycommon "github.com/dev-fan-sophon/boxai/relay/common"
	"github.com/dev-fan-sophon/boxai/setting/operation_setting"
	"github.com/dev-fan-sophon/boxai/types"

	"github.com/gin-gonic/gin"
	"github.com/shopspring/decimal"
	"github.com/stretchr/testify/assert"
	"github.com/stretchr/testify/require"
)

func groundedInfo(model string, queries int) *relaycommon.RelayInfo {
	info := &relaycommon.RelayInfo{OriginModelName: model}
	info.SetBillableToolCount(dto.BuildInToolGoogleSearch, queries)
	info.SetBillableToolCount(relaycommon.GoogleSearchGroundedPromptTool, 1)
	return info
}

// Gemini grounding records both the unique query count and one grounded
// prompt; the built-in price table prices exactly one of them per model.
func TestGeminiGroundingBillsQueriesOrGroundedPromptNeverBoth(t *testing.T) {
	operation_setting.LoadToolPricesFromJSONString(`{}`)
	ctx, _ := gin.CreateTestContext(nil)
	perThousand := func(price float64, count int64) decimal.Decimal {
		return decimal.NewFromFloat(price).Mul(decimal.NewFromInt(count)).Div(decimal.NewFromInt(1000)).Mul(decimal.NewFromFloat(common.QuotaPerUnit))
	}

	tests := []struct {
		model     string
		queries   int
		expected  decimal.Decimal
		itemName  string
		itemCount int
	}{
		{model: "gemini-3-pro-preview", queries: 3, expected: perThousand(14, 3), itemName: dto.BuildInToolGoogleSearch, itemCount: 3},
		{model: "gemini-2.5-flash", queries: 3, expected: perThousand(35, 1), itemName: relaycommon.GoogleSearchGroundedPromptTool, itemCount: 1},
		{model: "gemini-2.0-flash", queries: 1, expected: perThousand(35, 1), itemName: relaycommon.GoogleSearchGroundedPromptTool, itemCount: 1},
	}
	for _, tt := range tests {
		t.Run(tt.model, func(t *testing.T) {
			summary := &textQuotaSummary{ModelName: tt.model, GroupRatio: 1}
			surcharge := calculateTextToolCallSurcharge(ctx, groundedInfo(tt.model, tt.queries), summary)
			assert.True(t, tt.expected.Equal(surcharge), "got %s want %s", surcharge, tt.expected)
			require.Len(t, summary.ToolSurchargeItems, 1, "grounding must bill under one key only")
			assert.Equal(t, tt.itemName, summary.ToolSurchargeItems[0].Name)
			assert.Equal(t, tt.itemCount, summary.ToolSurchargeItems[0].Count)
		})
	}
}

// Vendor-reported counts are upstream-controlled and must be bounded before
// they multiply a tool price.
func TestVendorReportedToolCountIsBoundedAtSettlement(t *testing.T) {
	operation_setting.LoadToolPricesFromJSONString(`{}`)
	ctx, _ := gin.CreateTestContext(nil)
	info := &relaycommon.RelayInfo{OriginModelName: "claude-sonnet-4-5"}
	info.RecordClaudeServerToolUse(&dto.ClaudeServerToolUse{WebSearchRequests: 2_000_000_000})

	summary := &textQuotaSummary{ModelName: info.OriginModelName, GroupRatio: 1}
	surcharge := calculateTextToolCallSurcharge(ctx, info, summary)

	require.Len(t, summary.ToolSurchargeItems, 1)
	assert.Equal(t, relaycommon.MaxBillableToolCallCount, summary.ToolSurchargeItems[0].Count)
	expected := decimal.NewFromFloat(10).Mul(decimal.NewFromInt(relaycommon.MaxBillableToolCallCount)).Div(decimal.NewFromInt(1000)).Mul(decimal.NewFromFloat(common.QuotaPerUnit))
	assert.True(t, expected.Equal(surcharge), "got %s want %s", surcharge, expected)
}

// A vendor count replaces the per-item count for the same key instead of
// adding to it, so a Claude search is never billed twice.
func TestClaudeServerToolUseReplacesCountedSearchItems(t *testing.T) {
	operation_setting.LoadToolPricesFromJSONString(`{}`)
	ctx, _ := gin.CreateTestContext(nil)
	info := &relaycommon.RelayInfo{
		OriginModelName: "claude-sonnet-4-5",
		ResponsesUsageInfo: &relaycommon.ResponsesUsageInfo{BuiltInTools: map[string]*relaycommon.BuildInToolInfo{
			dto.BuildInToolWebSearch: {ToolName: dto.BuildInToolWebSearch},
		}},
	}
	info.CountBillableToolCall(dto.BuildInCallWebSearchCall, "")
	info.CountBillableToolCall(dto.BuildInCallWebSearchCall, "")
	info.RecordClaudeServerToolUse(&dto.ClaudeServerToolUse{WebSearchRequests: 3})
	info.RecordClaudeServerToolUse(&dto.ClaudeServerToolUse{WebSearchRequests: 3})

	summary := &textQuotaSummary{ModelName: info.OriginModelName, GroupRatio: 1}
	calculateTextToolCallSurcharge(ctx, info, summary)

	require.Len(t, summary.ToolSurchargeItems, 1)
	assert.Equal(t, dto.BuildInToolWebSearch, summary.ToolSurchargeItems[0].Name)
	assert.Equal(t, 3, summary.ToolSurchargeItems[0].Count)
}

// /v1/tools/search and /v1/tools/fetch report no tokens; a successful call
// still settles at the routing model's per-request price.
func TestDeepSeekToolsCallBillsFixedPriceWithoutTokens(t *testing.T) {
	ctx, _ := gin.CreateTestContext(nil)
	info := &relaycommon.RelayInfo{
		OriginModelName: "deepseek-search",
		RelayFormat:     types.RelayFormatDeepSeekTools,
		PriceData: types.PriceData{
			UsePrice:       true,
			ModelPrice:     0.002,
			GroupRatioInfo: types.GroupRatioInfo{GroupRatio: 1},
		},
	}
	summary := calculateTextQuotaSummary(ctx, info, &dto.Usage{})
	assert.Equal(t, common.QuotaRound(0.002*common.QuotaPerUnit), summary.Quota)

	info.RelayFormat = types.RelayFormatOpenAI
	summary = calculateTextQuotaSummary(ctx, info, &dto.Usage{})
	assert.Zero(t, summary.Quota, "other zero-usage responses stay free")
}
