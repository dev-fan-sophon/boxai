package customtool

import (
	"encoding/json"
	"fmt"
	"strings"

	"github.com/dev-fan-sophon/boxai/common"
	"github.com/dev-fan-sophon/boxai/dto"
)

// DefaultNamespace is the namespace Codex declares its ordinary tools in.
// OpenAI returns calls to its tools by bare name without a namespace field, so
// its tools keep their names upstream.
const DefaultNamespace = "functions"

// NamespacedName is the upstream function name of a tool declared in a
// Responses tool namespace: "<namespace>__<name>", or the bare name for the
// default namespace.
func NamespacedName(namespace string, name string) string {
	if namespace == "" || namespace == DefaultNamespace {
		return name
	}
	return namespace + "__" + name
}

// FlattenNamespaces rewrites the Responses tool namespaces and the
// additional_tools input items Codex uses to declare tools into plain
// top-level tools, because no other protocol has either. Tools in a
// non-default namespace are renamed with NamespacedName and described with the
// namespace description; a namespaced tool whose flattened name collides with
// an earlier tool is omitted. Calls in the input history and a namespaced
// function tool_choice get the same flattened names.
//
// It returns the rewritten request, or req itself when nothing needed
// flattening, and maps every flattened upstream name to its namespace so the
// response side can restore it.
func FlattenNamespaces(req *dto.OpenAIResponsesRequest) (*dto.OpenAIResponsesRequest, map[string]string, error) {
	if req == nil {
		return req, nil, nil
	}
	var tools []map[string]any
	if len(req.Tools) > 0 && common.GetJsonType(req.Tools) == "array" {
		if err := common.Unmarshal(req.Tools, &tools); err != nil {
			return nil, nil, fmt.Errorf("invalid tools: %w", err)
		}
	}
	var items []map[string]any
	if len(req.Input) > 0 && common.GetJsonType(req.Input) == "array" {
		if err := common.Unmarshal(req.Input, &items); err != nil {
			return nil, nil, fmt.Errorf("invalid input: %w", err)
		}
	}

	changed := false
	type declared struct {
		tool      map[string]any
		namespace string
	}
	var declarations []declared
	expand := func(tool map[string]any) error {
		if strings.TrimSpace(common.Interface2String(tool["type"])) != "namespace" {
			declarations = append(declarations, declared{tool: tool})
			return nil
		}
		changed = true
		namespace := strings.TrimSpace(common.Interface2String(tool["name"]))
		if namespace == "" {
			return fmt.Errorf("namespace tool requires name")
		}
		members, _ := tool["tools"].([]any)
		namespaceDescription := strings.TrimSpace(common.Interface2String(tool["description"]))
		for _, rawMember := range members {
			member, ok := rawMember.(map[string]any)
			if !ok {
				continue
			}
			if name := strings.TrimSpace(common.Interface2String(member["name"])); name != "" {
				member["name"] = NamespacedName(namespace, name)
			}
			description := strings.TrimSpace(common.Interface2String(member["description"]))
			if namespaceDescription != "" {
				description = strings.TrimSpace(namespaceDescription + "\n\n" + description)
			}
			if description != "" {
				member["description"] = description
			}
			declarations = append(declarations, declared{tool: member, namespace: namespace})
		}
		return nil
	}
	for _, tool := range tools {
		if err := expand(tool); err != nil {
			return nil, nil, err
		}
	}

	filteredItems := items[:0:0]
	for _, item := range items {
		switch strings.TrimSpace(common.Interface2String(item["type"])) {
		case "additional_tools":
			// No target protocol has an input item that declares tools, so they
			// join the top-level tool list.
			changed = true
			members, _ := item["tools"].([]any)
			for _, rawMember := range members {
				if member, ok := rawMember.(map[string]any); ok {
					if err := expand(member); err != nil {
						return nil, nil, err
					}
				}
			}
			continue
		case "function_call", "custom_tool_call":
			if namespace := strings.TrimSpace(common.Interface2String(item["namespace"])); namespace != "" {
				changed = true
				if name := strings.TrimSpace(common.Interface2String(item["name"])); name != "" {
					item["name"] = NamespacedName(namespace, name)
				}
				delete(item, "namespace")
			}
		}
		filteredItems = append(filteredItems, item)
	}

	toolChoice := req.ToolChoice
	if len(toolChoice) > 0 && common.GetJsonType(toolChoice) == "object" {
		var choice map[string]any
		if err := common.Unmarshal(toolChoice, &choice); err != nil {
			return nil, nil, fmt.Errorf("invalid tool_choice: %w", err)
		}
		if namespace := strings.TrimSpace(common.Interface2String(choice["namespace"])); namespace != "" {
			changed = true
			if name := strings.TrimSpace(common.Interface2String(choice["name"])); name != "" {
				choice["name"] = NamespacedName(namespace, name)
			}
			delete(choice, "namespace")
			encoded, err := common.Marshal(choice)
			if err != nil {
				return nil, nil, err
			}
			toolChoice = encoded
		}
	}

	if !changed {
		return req, nil, nil
	}

	seenNames := make(map[string]struct{}, len(declarations))
	flattened := make([]map[string]any, 0, len(declarations))
	var namespaces map[string]string
	for _, declaration := range declarations {
		name := strings.TrimSpace(common.Interface2String(declaration.tool["name"]))
		if _, duplicate := seenNames[name]; duplicate && name != "" && declaration.namespace != "" {
			continue
		}
		if name != "" {
			seenNames[name] = struct{}{}
		}
		if declaration.namespace != "" && declaration.namespace != DefaultNamespace && name != "" {
			if namespaces == nil {
				namespaces = make(map[string]string)
			}
			namespaces[name] = declaration.namespace
		}
		flattened = append(flattened, declaration.tool)
	}

	out := *req
	out.ToolChoice = toolChoice
	out.Tools = nil
	if len(flattened) > 0 {
		encoded, err := common.Marshal(flattened)
		if err != nil {
			return nil, nil, err
		}
		out.Tools = encoded
	}
	if items != nil {
		encoded, err := common.Marshal(filteredItems)
		if err != nil {
			return nil, nil, err
		}
		out.Input = json.RawMessage(encoded)
	}
	return &out, namespaces, nil
}

// ToolName restores the Responses namespace and tool name of an upstream
// function name. Names that were not flattened from a namespace return an
// empty namespace and the name unchanged.
func ToolName(recognizer Recognizer, upstreamName string) (namespace string, name string) {
	if recognizer == nil {
		return "", upstreamName
	}
	namespace = recognizer.ResponsesToolNamespace(upstreamName)
	if namespace == "" {
		return "", upstreamName
	}
	return namespace, strings.TrimPrefix(upstreamName, namespace+"__")
}
