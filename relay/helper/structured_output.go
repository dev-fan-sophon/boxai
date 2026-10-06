package helper

import (
	"bytes"
	"encoding/json"
	"errors"
	"fmt"
	"sort"
	"strings"

	"github.com/dev-fan-sophon/boxai/common"
	"github.com/dev-fan-sophon/boxai/dto"
)

// responsesTextFormat is the Responses API text.format object. Unlike Chat
// Completions, json_schema fields sit directly on the format object.
type responsesTextFormat struct {
	Type string `json:"type"`
	dto.FormatJsonSchema
}

var jsonPointerEscaper = strings.NewReplacer("~", "~0", "/", "~1")

// validateChatResponseFormat checks Chat Completions response_format of type
// json_schema before it reaches an upstream. The request is never modified.
func validateChatResponseFormat(format *dto.ResponseFormat) error {
	if format == nil || format.Type != "json_schema" {
		return nil
	}
	raw := bytes.TrimSpace(format.JsonSchema)
	if len(raw) == 0 || bytes.Equal(raw, []byte("null")) {
		return errors.New("response_format.json_schema is required when type is json_schema")
	}
	var jsonSchema dto.FormatJsonSchema
	if err := common.Unmarshal(raw, &jsonSchema); err != nil {
		return errors.New("response_format.json_schema must be an object")
	}
	return validateStructuredOutputSchema("response_format.json_schema", jsonSchema, false)
}

// validateResponsesTextFormat checks Responses API text.format of type
// json_schema before it reaches an upstream. The request is never modified.
// Non-object text values are left for the upstream to judge.
func validateResponsesTextFormat(text json.RawMessage) error {
	raw := bytes.TrimSpace(text)
	if len(raw) == 0 || raw[0] != '{' {
		return nil
	}
	var textConfig struct {
		Format json.RawMessage `json:"format"`
	}
	if err := common.Unmarshal(raw, &textConfig); err != nil {
		return errors.New("text must be an object")
	}
	formatRaw := bytes.TrimSpace(textConfig.Format)
	if len(formatRaw) == 0 || formatRaw[0] != '{' {
		return nil
	}
	var format responsesTextFormat
	if err := common.Unmarshal(formatRaw, &format); err != nil {
		return errors.New("text.format is invalid")
	}
	if format.Type != "json_schema" {
		return nil
	}
	return validateStructuredOutputSchema("text.format", format.FormatJsonSchema, true)
}

// validateStructuredOutputSchema enforces the json_schema format contract:
// a name is always required, strict must be a boolean when present, and an
// explicit strict:true requires a schema satisfying the strict object rules.
// schemaRequired reflects APIs (Responses) where schema is always mandatory.
func validateStructuredOutputSchema(path string, jsonSchema dto.FormatJsonSchema, schemaRequired bool) error {
	if strings.TrimSpace(jsonSchema.Name) == "" {
		return fmt.Errorf("%s.name is required", path)
	}

	strict := false
	strictRaw := bytes.TrimSpace(jsonSchema.Strict)
	switch {
	case len(strictRaw) == 0, bytes.Equal(strictRaw, []byte("null")), bytes.Equal(strictRaw, []byte("false")):
	case bytes.Equal(strictRaw, []byte("true")):
		strict = true
	default:
		return fmt.Errorf("%s.strict must be a boolean", path)
	}

	if jsonSchema.Schema == nil {
		if schemaRequired || strict {
			return fmt.Errorf("%s.schema is required", path)
		}
		return nil
	}
	if !strict {
		return nil
	}
	if _, ok := jsonSchema.Schema.(map[string]any); !ok {
		return fmt.Errorf("%s.schema must be an object when strict is true", path)
	}
	return validateStrictSchemaNode(jsonSchema.Schema, path+".schema", "#")
}

// validateStrictSchemaNode walks only subschema-bearing keywords, so schema
// data in enum/const/default/examples is never interpreted as a schema.
// Every schema that denotes an object must list all properties in required
// and set additionalProperties to false.
func validateStrictSchemaNode(node any, fieldPath string, pointer string) error {
	schema, ok := node.(map[string]any)
	if !ok {
		// Boolean schemas and non-object values carry no object contract.
		return nil
	}

	denotesObject := false
	switch schemaType := schema["type"].(type) {
	case string:
		denotesObject = schemaType == "object"
	case []any:
		for _, item := range schemaType {
			if item == "object" {
				denotesObject = true
				break
			}
		}
	}
	properties, hasProperties := schema["properties"]
	if hasProperties {
		denotesObject = true
	}

	var propertyMap map[string]any
	if hasProperties {
		propertyMap, ok = properties.(map[string]any)
		if !ok {
			return fmt.Errorf("%s: properties at %s must be an object", fieldPath, pointer)
		}
	}
	propertyNames := make([]string, 0, len(propertyMap))
	for name := range propertyMap {
		propertyNames = append(propertyNames, name)
	}
	sort.Strings(propertyNames)

	if denotesObject {
		additional, hasAdditional := schema["additionalProperties"]
		if allowed, isBool := additional.(bool); !hasAdditional || !isBool || allowed {
			return fmt.Errorf("%s: strict schema object at %s must set additionalProperties to false", fieldPath, pointer)
		}
		requiredNames := make(map[string]bool)
		if requiredRaw, hasRequired := schema["required"]; hasRequired {
			requiredList, isList := requiredRaw.([]any)
			if !isList {
				return fmt.Errorf("%s: required at %s must be an array of strings", fieldPath, pointer)
			}
			for _, item := range requiredList {
				name, isString := item.(string)
				if !isString {
					return fmt.Errorf("%s: required at %s must be an array of strings", fieldPath, pointer)
				}
				requiredNames[name] = true
			}
		}
		for _, name := range propertyNames {
			if !requiredNames[name] {
				return fmt.Errorf("%s: strict schema object at %s must list property %q in required", fieldPath, pointer, name)
			}
		}
	}

	for _, name := range propertyNames {
		if err := validateStrictSchemaNode(propertyMap[name], fieldPath, pointer+"/properties/"+jsonPointerEscaper.Replace(name)); err != nil {
			return err
		}
	}

	switch items := schema["items"].(type) {
	case map[string]any:
		if err := validateStrictSchemaNode(items, fieldPath, pointer+"/items"); err != nil {
			return err
		}
	case []any:
		for i, item := range items {
			if err := validateStrictSchemaNode(item, fieldPath, fmt.Sprintf("%s/items/%d", pointer, i)); err != nil {
				return err
			}
		}
	}

	for _, keyword := range []string{"$defs", "definitions"} {
		definitions, isMap := schema[keyword].(map[string]any)
		if !isMap {
			continue
		}
		definitionNames := make([]string, 0, len(definitions))
		for name := range definitions {
			definitionNames = append(definitionNames, name)
		}
		sort.Strings(definitionNames)
		for _, name := range definitionNames {
			if err := validateStrictSchemaNode(definitions[name], fieldPath, pointer+"/"+keyword+"/"+jsonPointerEscaper.Replace(name)); err != nil {
				return err
			}
		}
	}

	for _, keyword := range []string{"anyOf", "allOf", "oneOf"} {
		branches, isList := schema[keyword].([]any)
		if !isList {
			continue
		}
		for i, branch := range branches {
			if err := validateStrictSchemaNode(branch, fieldPath, fmt.Sprintf("%s/%s/%d", pointer, keyword, i)); err != nil {
				return err
			}
		}
	}
	return nil
}
