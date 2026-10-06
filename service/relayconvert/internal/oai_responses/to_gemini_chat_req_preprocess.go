package oairesponses

import (
	"strings"

	"github.com/dev-fan-sophon/boxai/common"
	"github.com/dev-fan-sophon/boxai/dto"
	"github.com/dev-fan-sophon/boxai/service/relayconvert/internal/customtool"
)

// PrepareOpenAIResponsesRequest keeps only the tools Gemini can receive:
// function tools and custom tools, which are sent as functions taking one
// string input. custom_tool_call history and its outputs are kept so they can
// be replayed as function calls and responses.
func PrepareOpenAIResponsesRequest(request dto.OpenAIResponsesRequest) (dto.OpenAIResponsesRequest, error) {
	tools, err := filterGeminiResponsesTools(request.Tools)
	if err != nil {
		return request, err
	}
	request.Tools = tools
	return request, nil
}

func filterGeminiResponsesTools(raw []byte) ([]byte, error) {
	if !geminiRawJSONPresent(raw) || common.GetJsonType(raw) != "array" {
		return raw, nil
	}

	var tools []map[string]any
	if err := common.Unmarshal(raw, &tools); err != nil {
		return nil, err
	}

	filtered := make([]map[string]any, 0, len(tools))
	for _, tool := range tools {
		switch strings.TrimSpace(common.Interface2String(tool["type"])) {
		case "function", customtool.ToolType:
			filtered = append(filtered, tool)
		}
	}
	if len(filtered) == 0 {
		return nil, nil
	}
	return common.Marshal(filtered)
}

func geminiRawJSONPresent(raw []byte) bool {
	if len(raw) == 0 {
		return false
	}
	return common.GetJsonType(raw) != "null"
}
