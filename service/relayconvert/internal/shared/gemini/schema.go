package gemini

import (
	"encoding/json"
	"fmt"
	"slices"
	"strings"

	"github.com/dev-fan-sophon/boxai/common"
	"github.com/dev-fan-sophon/boxai/constant"
	"github.com/dev-fan-sophon/boxai/dto"
	relaycommon "github.com/dev-fan-sophon/boxai/relay/common"
	"github.com/dev-fan-sophon/boxai/setting/model_setting"
)

var geminiOpenAPISchemaAllowedFields = map[string]struct{}{
	"anyOf":            {},
	"default":          {},
	"description":      {},
	"enum":             {},
	"example":          {},
	"format":           {},
	"items":            {},
	"maxItems":         {},
	"maxLength":        {},
	"maxProperties":    {},
	"maximum":          {},
	"minItems":         {},
	"minLength":        {},
	"minProperties":    {},
	"minimum":          {},
	"nullable":         {},
	"pattern":          {},
	"properties":       {},
	"propertyOrdering": {},
	"required":         {},
	"title":            {},
	"type":             {},
}

const geminiFunctionSchemaMaxDepth = 64

func CleanFunctionParameters(params interface{}) interface{} {
	return cleanGeminiFunctionParametersWithDepth(params, 0)
}

func cleanGeminiFunctionParametersWithDepth(params interface{}, depth int) interface{} {
	if params == nil {
		return nil
	}

	if depth >= geminiFunctionSchemaMaxDepth {
		return cleanGeminiFunctionParametersShallow(params)
	}

	switch v := params.(type) {
	case map[string]interface{}:
		cleanedMap := make(map[string]interface{}, len(v))
		for key, val := range v {
			if _, ok := geminiOpenAPISchemaAllowedFields[key]; ok {
				cleanedMap[key] = val
			}
		}

		normalizeGeminiSchemaTypeAndNullable(cleanedMap)

		if props, ok := cleanedMap["properties"].(map[string]interface{}); ok && props != nil {
			cleanedProps := make(map[string]interface{})
			for propName, propValue := range props {
				cleanedProps[propName] = cleanGeminiFunctionParametersWithDepth(propValue, depth+1)
			}
			cleanedMap["properties"] = cleanedProps
		}

		if items, ok := cleanedMap["items"].(map[string]interface{}); ok && items != nil {
			cleanedMap["items"] = cleanGeminiFunctionParametersWithDepth(items, depth+1)
		}
		if itemsArray, ok := cleanedMap["items"].([]interface{}); ok && len(itemsArray) > 0 {
			cleanedMap["items"] = cleanGeminiFunctionParametersWithDepth(itemsArray[0], depth+1)
		}

		if nested, ok := cleanedMap["anyOf"].([]interface{}); ok && nested != nil {
			cleanedNested := make([]interface{}, len(nested))
			for i, item := range nested {
				cleanedNested[i] = cleanGeminiFunctionParametersWithDepth(item, depth+1)
			}
			cleanedMap["anyOf"] = cleanedNested
		}

		return cleanedMap
	case []interface{}:
		cleanedArray := make([]interface{}, len(v))
		for i, item := range v {
			cleanedArray[i] = cleanGeminiFunctionParametersWithDepth(item, depth+1)
		}
		return cleanedArray
	default:
		return params
	}
}

func cleanGeminiFunctionParametersShallow(params interface{}) interface{} {
	switch v := params.(type) {
	case map[string]interface{}:
		cleanedMap := make(map[string]interface{}, len(v))
		for key, val := range v {
			if _, ok := geminiOpenAPISchemaAllowedFields[key]; ok {
				cleanedMap[key] = val
			}
		}
		normalizeGeminiSchemaTypeAndNullable(cleanedMap)
		delete(cleanedMap, "properties")
		delete(cleanedMap, "items")
		delete(cleanedMap, "anyOf")
		return cleanedMap
	case []interface{}:
		return []interface{}{}
	default:
		return params
	}
}

func normalizeGeminiSchemaTypeAndNullable(schema map[string]interface{}) {
	rawType, ok := schema["type"]
	if !ok || rawType == nil {
		return
	}

	normalize := func(t string) (string, bool) {
		switch strings.ToLower(strings.TrimSpace(t)) {
		case "object":
			return "OBJECT", false
		case "array":
			return "ARRAY", false
		case "string":
			return "STRING", false
		case "integer":
			return "INTEGER", false
		case "number":
			return "NUMBER", false
		case "boolean":
			return "BOOLEAN", false
		case "null":
			return "", true
		default:
			return t, false
		}
	}

	switch typed := rawType.(type) {
	case string:
		normalized, isNull := normalize(typed)
		if isNull {
			schema["nullable"] = true
			delete(schema, "type")
			return
		}
		schema["type"] = normalized
	case []interface{}:
		nullable := false
		var chosen string
		for _, item := range typed {
			if value, ok := item.(string); ok {
				normalized, isNull := normalize(value)
				if isNull {
					nullable = true
					continue
				}
				if chosen == "" {
					chosen = normalized
				}
			}
		}
		if nullable {
			schema["nullable"] = true
		}
		if chosen != "" {
			schema["type"] = chosen
		} else {
			delete(schema, "type")
		}
	}
}

func RemoveAdditionalProperties(schema interface{}, depth int) interface{} {
	if depth >= 5 {
		return schema
	}

	value, ok := schema.(map[string]interface{})
	if !ok || len(value) == 0 {
		return schema
	}
	delete(value, "title")
	delete(value, "$schema")
	if typeVal, exists := value["type"]; !exists || (typeVal != "object" && typeVal != "array") {
		return schema
	}
	switch value["type"] {
	case "object":
		delete(value, "additionalProperties")
		if properties, ok := value["properties"].(map[string]interface{}); ok {
			for key, nested := range properties {
				properties[key] = RemoveAdditionalProperties(nested, depth+1)
			}
		}
		for _, field := range []string{"allOf", "anyOf", "oneOf"} {
			if nested, ok := value[field].([]interface{}); ok {
				for i, item := range nested {
					nested[i] = RemoveAdditionalProperties(item, depth+1)
				}
			}
		}
	case "array":
		if items, ok := value["items"].(map[string]interface{}); ok {
			value["items"] = RemoveAdditionalProperties(items, depth+1)
		}
	}

	return value
}

func OpenAIToolChoiceToConfig(toolChoice any) *dto.ToolConfig {
	if toolChoice == nil {
		return nil
	}

	if toolChoiceStr, ok := toolChoice.(string); ok {
		config := &dto.ToolConfig{
			FunctionCallingConfig: &dto.FunctionCallingConfig{},
		}
		switch toolChoiceStr {
		case "auto":
			config.FunctionCallingConfig.Mode = "AUTO"
		case "none":
			config.FunctionCallingConfig.Mode = "NONE"
		case "required":
			config.FunctionCallingConfig.Mode = "ANY"
		default:
			config.FunctionCallingConfig.Mode = "AUTO"
		}
		return config
	}

	if toolChoiceMap, ok := toolChoice.(map[string]interface{}); ok {
		if toolChoiceMap["type"] == "function" {
			config := &dto.ToolConfig{
				FunctionCallingConfig: &dto.FunctionCallingConfig{
					Mode: "ANY",
				},
			}
			if function, ok := toolChoiceMap["function"].(map[string]interface{}); ok {
				if name, ok := function["name"].(string); ok && name != "" {
					config.FunctionCallingConfig.AllowedFunctionNames = []string{name}
				}
			}
			return config
		}
		return nil
	}

	return nil
}

// FunctionDeclaration is a Gemini function declaration. Its parameters go in
// exactly one of Parameters (Gemini's typed Schema) or ParametersJsonSchema
// (unchanged JSON Schema).
type FunctionDeclaration struct {
	Name                 string `json:"name"`
	Description          string `json:"description,omitempty"`
	Parameters           any    `json:"parameters,omitempty"`
	ParametersJsonSchema any    `json:"parametersJsonSchema,omitempty"`
}

// SupportsJSONSchema reports whether the upstream accepts JSON Schema in
// parametersJsonSchema and responseJsonSchema for the model. Gemini API v1
// has no such fields; v1beta and Vertex AI accept them.
func SupportsJSONSchema(info *relaycommon.RelayInfo, modelName string) bool {
	if info != nil && info.ChannelMeta != nil && info.ChannelType == constant.ChannelTypeVertexAi {
		return true
	}
	return model_setting.GetGeminiVersionSetting(modelName) != "v1"
}

// FunctionDeclarations encodes OpenAI function definitions for Gemini. See
// FunctionParameters for where each schema goes.
func FunctionDeclarations(functions []dto.FunctionRequest, jsonSchema bool) []FunctionDeclaration {
	declarations := make([]FunctionDeclaration, 0, len(functions))
	for _, function := range functions {
		declaration := FunctionDeclaration{Name: function.Name, Description: function.Description}
		if field, value := FunctionParameters(function.Parameters, jsonSchema); field == parametersJsonSchemaField {
			declaration.ParametersJsonSchema = value
		} else {
			declaration.Parameters = value
		}
		declarations = append(declarations, declaration)
	}
	return declarations
}

const parametersJsonSchemaField = "parametersJsonSchema"

// FunctionParameters returns the Gemini function declaration field that
// carries schema, and its value. A schema that fits Gemini's typed Schema is
// cleaned as before, and still left out when its properties are empty. Any
// other schema goes unchanged to parametersJsonSchema when jsonSchema is
// true; otherwise it is cleaned anyway.
func FunctionParameters(schema any, jsonSchema bool) (field string, value any) {
	if schema == nil {
		return "parameters", nil
	}
	misfits := schemaMisfits(schema)
	object, _ := schema.(map[string]any)
	properties, hasProperties := object["properties"].(map[string]any)
	emptyObject := hasProperties && len(properties) == 0
	if emptyObject {
		for key, item := range object {
			switch key {
			case "type", "properties":
				continue
			case "required":
				if required, _ := item.([]any); len(required) == 0 {
					continue
				}
			}
			if _, allowed := geminiOpenAPISchemaAllowedFields[key]; allowed {
				misfits = append(misfits, "constraints on an empty object")
				break
			}
		}
	}
	if len(misfits) > 0 && jsonSchema {
		return parametersJsonSchemaField, schema
	}
	if emptyObject {
		return "parameters", nil
	}
	return "parameters", CleanFunctionParameters(schema)
}

// ApplyResponseSchema sets the structured output schema from the json_schema
// object of an OpenAI response format. A schema that fits Gemini's typed
// Schema keeps the responseSchema cleanup. Any other schema is sent unchanged
// as responseJsonSchema when jsonSchema is true; otherwise it is cleaned
// anyway.
func ApplyResponseSchema(config *dto.GeminiChatGenerationConfig, rawFormat json.RawMessage, jsonSchema bool) {
	var format dto.FormatJsonSchema
	if err := common.Unmarshal(rawFormat, &format); err != nil {
		return
	}
	if jsonSchema && len(schemaMisfits(format.Schema)) > 0 {
		// The raw member keeps the client's key order.
		var raw struct {
			Schema json.RawMessage `json:"schema"`
		}
		if err := common.Unmarshal(rawFormat, &raw); err == nil && len(raw.Schema) > 0 {
			config.ResponseJsonSchema = raw.Schema
			return
		}
	}
	config.ResponseSchema = RemoveAdditionalProperties(format.Schema, 0)
}

// schemaMisfits lists what Gemini's typed Schema cannot hold of a JSON Schema
// as written: keywords outside its fields, type arrays, non-string enum
// values, tuple items, boolean schemas, and nesting deeper than
// CleanFunctionParameters keeps. additionalProperties and $schema are not
// misfits: agent tools and OpenAI strict schemas carry them on nearly every
// object, and dropping them as before keeps those requests unchanged for
// upstreams that do not pass the JSON Schema fields through.
func schemaMisfits(schema any) []string {
	found := make(map[string]struct{})
	collectSchemaMisfits(schema, 0, found)
	misfits := make([]string, 0, len(found))
	for misfit := range found {
		misfits = append(misfits, misfit)
	}
	slices.Sort(misfits)
	return misfits
}

func collectSchemaMisfits(schema any, depth int, found map[string]struct{}) {
	if depth > geminiFunctionSchemaMaxDepth {
		found[fmt.Sprintf("nesting deeper than %d levels", geminiFunctionSchemaMaxDepth)] = struct{}{}
		return
	}
	value, ok := schema.(map[string]any)
	if !ok {
		if _, isBool := schema.(bool); isBool {
			found["boolean schemas"] = struct{}{}
		}
		return
	}
	for key, item := range value {
		if _, allowed := geminiOpenAPISchemaAllowedFields[key]; !allowed {
			if key != "additionalProperties" && key != "$schema" {
				found[key] = struct{}{}
			}
			continue
		}
		switch key {
		case "type":
			if _, isArray := item.([]any); isArray {
				found["type arrays"] = struct{}{}
			}
		case "enum":
			values, _ := item.([]any)
			if slices.ContainsFunc(values, func(value any) bool {
				_, isString := value.(string)
				return !isString
			}) {
				found["non-string enum values"] = struct{}{}
			}
		case "properties":
			properties, _ := item.(map[string]any)
			for _, property := range properties {
				collectSchemaMisfits(property, depth+1, found)
			}
		case "items":
			entries, isTuple := item.([]any)
			if !isTuple {
				collectSchemaMisfits(item, depth+1, found)
				continue
			}
			found["tuple items"] = struct{}{}
			for _, entry := range entries {
				collectSchemaMisfits(entry, depth+1, found)
			}
		case "anyOf":
			variants, _ := item.([]any)
			for _, variant := range variants {
				collectSchemaMisfits(variant, depth+1, found)
			}
		}
	}
}
