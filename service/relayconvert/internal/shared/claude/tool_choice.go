package claude

import "github.com/dev-fan-sophon/boxai/dto"

func MapOpenAIToolChoice(toolChoice any, parallelToolCalls *bool) *dto.ClaudeToolChoice {
	var claudeToolChoice *dto.ClaudeToolChoice

	if toolChoiceStr, ok := toolChoice.(string); ok {
		switch toolChoiceStr {
		case "auto":
			claudeToolChoice = &dto.ClaudeToolChoice{
				Type: "auto",
			}
		case "required":
			claudeToolChoice = &dto.ClaudeToolChoice{
				Type: "any",
			}
		case "none":
			claudeToolChoice = &dto.ClaudeToolChoice{
				Type: "none",
			}
		}
	} else if toolChoiceMap, ok := toolChoice.(map[string]interface{}); ok {
		if function, ok := toolChoiceMap["function"].(map[string]interface{}); ok {
			if toolName, ok := function["name"].(string); ok {
				claudeToolChoice = &dto.ClaudeToolChoice{
					Type: "tool",
					Name: toolName,
				}
			}
		}
	}

	if parallelToolCalls != nil {
		if claudeToolChoice == nil {
			claudeToolChoice = &dto.ClaudeToolChoice{
				Type: "auto",
			}
		}
		if claudeToolChoice.Type != "none" {
			claudeToolChoice.DisableParallelToolUse = !*parallelToolCalls
		}
	}

	return claudeToolChoice
}

// RelaxForcedToolChoiceForThinking sends a forced tool choice (any or a named
// tool) as auto when manual extended thinking is enabled: Claude rejects that
// combination, so the model may answer without calling a tool instead of the
// request failing. Only requests converted from another protocol use it; a
// native Claude request keeps what the client sent.
func RelaxForcedToolChoiceForThinking(request *dto.ClaudeRequest) {
	if request == nil || request.ToolChoice == nil || request.Thinking == nil || request.Thinking.Type != "enabled" {
		return
	}
	choice, ok := request.ToolChoice.(*dto.ClaudeToolChoice)
	if !ok || (choice.Type != "any" && choice.Type != "tool") {
		return
	}
	relaxed := *choice
	relaxed.Type = "auto"
	relaxed.Name = ""
	request.ToolChoice = &relaxed
}
