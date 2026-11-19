package relayconvert

import (
	"fmt"
	"strings"

	"github.com/dev-fan-sophon/boxai/common"
	"github.com/dev-fan-sophon/boxai/constant"
	"github.com/dev-fan-sophon/boxai/dto"
	sharedgemini "github.com/dev-fan-sophon/boxai/service/relayconvert/internal/shared/gemini"
	"github.com/dev-fan-sophon/boxai/setting/model_setting"
	"github.com/dev-fan-sophon/boxai/setting/reasoning"
	"github.com/gin-gonic/gin"
)

// ApplyModelModifiers writes the reasoning intent of an explicit
// model@effort:<level> / model@thinking:<on|off> name (parsed by the
// distributor, upstream 7c044d7c5) into the request's own reasoning fields and
// resets the request model to the base name. Modifiers override request
// fields. Effort levels are passed through as sent (upstream 6b659fd61), except
// where a known model accepts only a narrower vocabulary (Claude effort, Gemini
// levels and 2.5 budgets, upstream 036ba376d). Pass-through channels forward
// the raw body and ignore these fields.
func ApplyModelModifiers(c *gin.Context, request dto.Request) error {
	modifiers, ok := common.GetContextKeyType[reasoning.ModelModifiers](c, constant.ContextKeyModelModifiers)
	if !ok || modifiers.IsEmpty() || request == nil {
		return nil
	}
	model := common.GetContextKeyString(c, constant.ContextKeyOriginalModel)
	if model == "" {
		return nil
	}
	request.SetModelName(model)
	off := modifiers.Thinking == "off"
	effort := modifiers.Effort
	if off {
		effort = "none"
	}

	switch req := request.(type) {
	case *dto.GeneralOpenAIRequest:
		if effort != "" {
			req.ReasoningEffort = effort
		}
	case *dto.OpenAIResponsesRequest:
		if effort != "" {
			if req.Reasoning == nil {
				req.Reasoning = &dto.Reasoning{}
			}
			req.Reasoning.Effort = effort
		}
	case *dto.ClaudeRequest:
		return applyClaudeModelModifiers(req, model, off, effort)
	case *dto.GeminiChatRequest:
		applyGeminiModelModifiers(req, model, off, effort)
	}
	return nil
}

// claudeEffortSupport is the output_config.effort vocabulary of a known Claude
// model (platform.claude.com/docs/en/build-with-claude/effort). adaptive marks
// models that think adaptively instead of with a manual budget.
type claudeEffortSupport struct {
	effort, xhigh, max, adaptive bool
}

func claudeEffortSupportFor(model string) claudeEffortSupport {
	model = strings.ToLower(model[strings.LastIndex(model, "/")+1:])
	switch {
	case strings.HasPrefix(model, "claude-opus-5"), strings.HasPrefix(model, "claude-sonnet-5"),
		strings.HasPrefix(model, "claude-haiku-5"), strings.HasPrefix(model, "claude-fable-5"),
		strings.HasPrefix(model, "claude-mythos"),
		strings.HasPrefix(model, "claude-opus-4-8"), strings.HasPrefix(model, "claude-opus-4-7"):
		return claudeEffortSupport{effort: true, xhigh: true, max: true, adaptive: true}
	case strings.HasPrefix(model, "claude-opus-4-6"), strings.HasPrefix(model, "claude-sonnet-4-6"):
		return claudeEffortSupport{effort: true, max: true, adaptive: true}
	case strings.HasPrefix(model, "claude-opus-4-5"):
		return claudeEffortSupport{effort: true}
	}
	return claudeEffortSupport{}
}

// claudeEffortBudgetPercent is the share of max_tokens given to manual
// thinking for an effort on Claude models without effort support.
var claudeEffortBudgetPercent = map[string]int{
	"minimal": 5, "low": 20, "medium": 50, "high": 80, "xhigh": 95, "max": 95,
}

func applyClaudeModelModifiers(req *dto.ClaudeRequest, model string, off bool, effort string) error {
	outputConfig := make(map[string]any)
	if len(req.OutputConfig) > 0 && common.GetJsonType(req.OutputConfig) == "object" {
		if err := common.Unmarshal(req.OutputConfig, &outputConfig); err != nil {
			return fmt.Errorf("invalid output_config: %w", err)
		}
	}
	delete(outputConfig, "effort")

	isClaude := strings.HasPrefix(strings.ToLower(model[strings.LastIndex(model, "/")+1:]), "claude-")
	support := claudeEffortSupportFor(model)
	switch {
	case off:
		req.Thinking = &dto.Thinking{Type: "disabled"}
	case !isClaude:
		// Anthropic-compatible upstreams (e.g. DeepSeek) take the level as sent.
		if effort != "" {
			outputConfig["effort"] = effort
		}
	case support.effort && effort != "":
		switch effort {
		case "minimal":
			effort = "low"
		case "xhigh":
			if !support.xhigh {
				effort = "high"
				if support.max {
					effort = "max"
				}
			}
		case "max":
			if !support.max {
				effort = "high"
			}
		}
		outputConfig["effort"] = effort
		if support.adaptive && req.Thinking == nil {
			req.Thinking = &dto.Thinking{Type: "adaptive"}
		}
	case support.adaptive:
		if req.Thinking == nil {
			req.Thinking = &dto.Thinking{Type: "adaptive"}
		}
	default:
		// Manual extended thinking: budget from the effort, or the adapter
		// percentage for a bare @thinking:on.
		maxTokens := uint(model_setting.GetClaudeSettings().GetDefaultMaxTokens(model))
		if req.MaxTokens != nil && *req.MaxTokens > 0 {
			maxTokens = *req.MaxTokens
		}
		if maxTokens < 1280 {
			maxTokens = 1280
		}
		budget := int(float64(maxTokens) * model_setting.GetClaudeSettings().ThinkingAdapterBudgetTokensPercentage)
		if percent, ok := claudeEffortBudgetPercent[effort]; ok {
			budget = int(maxTokens) * percent / 100
		}
		budget = min(max(budget, 1024), int(maxTokens)-1)
		req.MaxTokens = &maxTokens
		req.Thinking = &dto.Thinking{Type: "enabled", BudgetTokens: &budget}
		req.TopP = nil
		req.TopK = nil
		req.Temperature = common.GetPointer[float64](1.0)
	}

	req.OutputConfig = nil
	if len(outputConfig) > 0 {
		encoded, err := common.Marshal(outputConfig)
		if err != nil {
			return err
		}
		req.OutputConfig = encoded
	}
	return nil
}

func applyGeminiModelModifiers(req *dto.GeminiChatRequest, model string, off bool, effort string) {
	bare := strings.ToLower(model[strings.LastIndex(model, "/")+1:])
	switch {
	case strings.HasPrefix(bare, "gemini-2.5-"):
		// Gemini 2.5 takes a per-model token budget; 2.5 Pro cannot disable
		// thinking, so off becomes its minimum budget.
		config := &dto.GeminiThinkingConfig{IncludeThoughts: !off}
		switch {
		case off:
			config.ThinkingBudget = common.GetPointer(sharedgemini.ClampThinkingBudget(bare, 0))
		case effort != "":
			config.ThinkingBudget = common.GetPointer(sharedgemini.ClampThinkingBudgetByEffort(bare, effort))
		default:
			config.ThinkingBudget = common.GetPointer(-1)
		}
		req.GenerationConfig.ThinkingConfig = config
	case strings.HasPrefix(bare, "gemini-3"), strings.HasSuffix(bare, "-latest") && strings.HasPrefix(bare, "gemini-"):
		// Gemini 3 takes thinkingLevel minimal/low/medium/high and cannot
		// fully disable thinking; Pro has no minimal level.
		level := effort
		switch level {
		case "none":
			level = "minimal"
		case "xhigh", "max":
			level = "high"
		}
		if level == "minimal" && strings.Contains(bare, "-pro") {
			level = "low"
		}
		req.GenerationConfig.ThinkingConfig = &dto.GeminiThinkingConfig{IncludeThoughts: !off, ThinkingLevel: level}
	}
}
