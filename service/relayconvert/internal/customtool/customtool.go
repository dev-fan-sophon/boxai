// Package customtool carries OpenAI Responses custom (freeform) tools through
// upstream protocols that only understand function tools. A custom tool is
// sent as a function taking one string argument named "input"; function calls
// to that name are restored as custom_tool_call items on the way back.
package customtool

import (
	"encoding/json"
	"fmt"
	"strings"

	"github.com/dev-fan-sophon/boxai/common"
	"github.com/dev-fan-sophon/boxai/dto"
)

// InputArgument is the single function argument that carries the raw input.
const InputArgument = "input"

// ToolType is the Responses tool and tool_choice type of a custom tool.
const ToolType = "custom"

// Tool is a Responses custom tool encoded as a function definition.
type Tool struct {
	Name        string
	Description string
}

// Function returns the function definition sent upstream for the custom tool.
func (t Tool) Function() dto.FunctionRequest {
	return dto.FunctionRequest{
		Name:        t.Name,
		Description: t.Description,
		Parameters: map[string]any{
			"type": "object",
			"properties": map[string]any{
				InputArgument: map[string]any{
					"type":        "string",
					"description": "Raw input for the tool.",
				},
			},
			"required":             []any{InputArgument},
			"additionalProperties": false,
		},
	}
}

// Select returns, keyed by position in tools, the custom tools that are sent
// upstream as functions. A custom tool whose name is already used by a function
// tool or an earlier custom tool is omitted because its calls could not be told
// apart. Request encoding and response restoration share this selection so the
// restored names always match the functions that were sent.
func Select(tools []map[string]any) map[int]Tool {
	usedNames := make(map[string]struct{})
	for _, tool := range tools {
		if strings.TrimSpace(common.Interface2String(tool["type"])) != "function" {
			continue
		}
		if name := strings.TrimSpace(common.Interface2String(tool["name"])); name != "" {
			usedNames[name] = struct{}{}
		}
	}

	var selected map[int]Tool
	for index, tool := range tools {
		if strings.TrimSpace(common.Interface2String(tool["type"])) != ToolType {
			continue
		}
		decoded, ok := decode(tool)
		if !ok {
			continue
		}
		if _, exists := usedNames[decoded.Name]; exists {
			continue
		}
		usedNames[decoded.Name] = struct{}{}
		if selected == nil {
			selected = make(map[int]Tool)
		}
		selected[index] = decoded
	}
	return selected
}

// SelectRaw decodes a Responses tools array and selects its custom tools.
func SelectRaw(raw json.RawMessage) ([]map[string]any, map[int]Tool, error) {
	if len(raw) == 0 || common.GetJsonType(raw) != "array" {
		return nil, nil, nil
	}
	var tools []map[string]any
	if err := common.Unmarshal(raw, &tools); err != nil {
		return nil, nil, fmt.Errorf("invalid tools: %w", err)
	}
	return tools, Select(tools), nil
}

// Names returns the function names of the selected custom tools, or nil.
func Names(selected map[int]Tool) map[string]struct{} {
	if len(selected) == 0 {
		return nil
	}
	names := make(map[string]struct{}, len(selected))
	for _, tool := range selected {
		names[tool.Name] = struct{}{}
	}
	return names
}

// ForcedName reports the custom tool named by a {"type":"custom","name":...}
// tool_choice. ok is false for any other choice shape.
func ForcedName(choice map[string]any) (name string, ok bool) {
	if strings.TrimSpace(common.Interface2String(choice["type"])) != ToolType {
		return "", false
	}
	return strings.TrimSpace(common.Interface2String(choice["name"])), true
}

// EncodeArguments wraps raw custom tool input as function call arguments.
func EncodeArguments(input string) (string, error) {
	raw, err := common.Marshal(map[string]string{InputArgument: input})
	if err != nil {
		return "", err
	}
	return string(raw), nil
}

// InputValue returns the raw input of a Responses custom_tool_call item. The
// input is a string; anything else is preserved as its JSON text.
func InputValue(value any) string {
	switch typed := value.(type) {
	case nil:
		return ""
	case string:
		return typed
	default:
		raw, err := common.Marshal(typed)
		if err != nil {
			return common.Interface2String(typed)
		}
		return string(raw)
	}
}

// InputFromArguments unwraps the raw input from {"input": ...} function call
// arguments. Arguments of any other shape are returned unchanged so the model
// output is never dropped.
func InputFromArguments(arguments string) string {
	var value map[string]any
	if err := common.UnmarshalJsonStr(arguments, &value); err != nil {
		return arguments
	}
	input, ok := value[InputArgument]
	if !ok {
		return arguments
	}
	if text, ok := input.(string); ok {
		return text
	}
	raw, err := common.Marshal(input)
	if err != nil {
		return arguments
	}
	return string(raw)
}

func decode(tool map[string]any) (Tool, bool) {
	name := strings.TrimSpace(common.Interface2String(tool["name"]))
	if name == "" {
		return Tool{}, false
	}
	parts := make([]string, 0, 3)
	if description := strings.TrimSpace(common.Interface2String(tool["description"])); description != "" {
		parts = append(parts, description)
	}
	parts = append(parts, `This tool takes freeform text. Put the complete raw text in the "input" argument.`)
	if format, ok := tool["format"].(map[string]any); ok && strings.TrimSpace(common.Interface2String(format["type"])) == "grammar" {
		if definition := strings.TrimSpace(common.Interface2String(format["definition"])); definition != "" {
			switch syntax := strings.TrimSpace(common.Interface2String(format["syntax"])); syntax {
			case "lark":
				parts = append(parts, "The input must match this Lark grammar:\n"+definition)
			case "regex":
				parts = append(parts, "The input must match this regular expression:\n"+definition)
			default:
				parts = append(parts, fmt.Sprintf("The input must match this %s grammar:\n%s", syntax, definition))
			}
		}
	}
	return Tool{Name: name, Description: strings.Join(parts, "\n\n")}, true
}

// Recognizer reports whether an upstream function name carries a Responses
// custom tool. *relaycommon.RelayInfo implements it with the record written by
// the current attempt's request conversion.
type Recognizer interface {
	IsResponsesCustomTool(name string) bool
}

// IsCustom is a nil-safe Recognizer lookup.
func IsCustom(recognizer Recognizer, name string) bool {
	if recognizer == nil {
		return false
	}
	return recognizer.IsResponsesCustomTool(name)
}
