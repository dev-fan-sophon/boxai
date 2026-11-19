package gemini

import (
	"encoding/json"
	"testing"

	"github.com/dev-fan-sophon/boxai/common"
	"github.com/dev-fan-sophon/boxai/constant"
	"github.com/dev-fan-sophon/boxai/dto"
	relaycommon "github.com/dev-fan-sophon/boxai/relay/common"
	"github.com/dev-fan-sophon/boxai/setting/model_setting"
	"github.com/stretchr/testify/assert"
	"github.com/stretchr/testify/require"
)

func TestFunctionParameters(t *testing.T) {
	strictObject := map[string]any{
		"type":                 "object",
		"$schema":              "http://json-schema.org/draft-07/schema#",
		"additionalProperties": false,
		"properties":           map[string]any{"q": map[string]any{"type": "string"}},
		"required":             []any{"q"},
	}
	cleanedStrictObject := map[string]any{
		"type":       "OBJECT",
		"properties": map[string]any{"q": map[string]any{"type": "STRING"}},
		"required":   []any{"q"},
	}
	constSchema := map[string]any{
		"type":       "object",
		"properties": map[string]any{"mode": map[string]any{"const": "fast"}},
	}
	numberEnum := map[string]any{
		"type":       "object",
		"properties": map[string]any{"level": map[string]any{"type": "integer", "enum": []any{1.0, 2.0}}},
	}
	refSchema := map[string]any{
		"type":       "object",
		"$defs":      map[string]any{"item": map[string]any{"type": "string"}},
		"properties": map[string]any{"item": map[string]any{"$ref": "#/$defs/item"}},
	}
	emptyObject := map[string]any{"type": "object", "properties": map[string]any{}, "required": []any{}}
	constrainedEmptyObject := map[string]any{"type": "object", "properties": map[string]any{}, "minProperties": 1.0}

	tests := []struct {
		name       string
		schema     any
		jsonSchema bool
		wantField  string
		want       any
	}{
		{name: "nil schema", schema: nil, jsonSchema: true, wantField: "parameters", want: nil},
		{name: "strict schema stays typed", schema: strictObject, jsonSchema: true, wantField: "parameters", want: cleanedStrictObject},
		{name: "const goes to JSON Schema", schema: constSchema, jsonSchema: true, wantField: "parametersJsonSchema", want: constSchema},
		{name: "const is cleaned without JSON Schema support", schema: constSchema, jsonSchema: false, wantField: "parameters",
			want: map[string]any{"type": "OBJECT", "properties": map[string]any{"mode": map[string]any{}}}},
		{name: "non-string enum goes to JSON Schema", schema: numberEnum, jsonSchema: true, wantField: "parametersJsonSchema", want: numberEnum},
		{name: "refs go to JSON Schema", schema: refSchema, jsonSchema: true, wantField: "parametersJsonSchema", want: refSchema},
		{name: "empty object is left out", schema: emptyObject, jsonSchema: true, wantField: "parameters", want: nil},
		{name: "constrained empty object goes to JSON Schema", schema: constrainedEmptyObject, jsonSchema: true, wantField: "parametersJsonSchema", want: constrainedEmptyObject},
		{name: "constrained empty object is left out without JSON Schema support", schema: constrainedEmptyObject, jsonSchema: false, wantField: "parameters", want: nil},
	}
	for _, tt := range tests {
		t.Run(tt.name, func(t *testing.T) {
			field, value := FunctionParameters(tt.schema, tt.jsonSchema)
			assert.Equal(t, tt.wantField, field)
			assert.Equal(t, tt.want, value)
		})
	}
}

func TestFunctionDeclarationsWireShape(t *testing.T) {
	declarations := FunctionDeclarations([]dto.FunctionRequest{
		{Name: "pick", Description: "Pick one", Parameters: map[string]any{"oneOf": []any{map[string]any{"type": "string"}, map[string]any{"type": "integer"}}}},
		{Name: "ping"},
	}, true)

	raw, err := common.Marshal(declarations)
	require.NoError(t, err)
	assert.JSONEq(t, `[
		{"name":"pick","description":"Pick one","parametersJsonSchema":{"oneOf":[{"type":"string"},{"type":"integer"}]}},
		{"name":"ping"}
	]`, string(raw))
}

func TestApplyResponseSchema(t *testing.T) {
	tests := []struct {
		name           string
		format         string
		jsonSchema     bool
		wantSchema     any
		wantJSONSchema string
	}{
		{
			name:       "strict schema keeps responseSchema cleanup",
			format:     `{"name":"answer","strict":true,"schema":{"type":"object","additionalProperties":false,"properties":{"a":{"type":"string"}}}}`,
			jsonSchema: true,
			wantSchema: map[string]any{"type": "object", "properties": map[string]any{"a": map[string]any{"type": "string"}}},
		},
		{
			name:           "type arrays are sent unchanged",
			format:         `{"name":"answer","schema":{"type":"object","properties":{"b":{"type":["string","null"]},"a":{"enum":[1,2]}}}}`,
			jsonSchema:     true,
			wantJSONSchema: `{"type":"object","properties":{"b":{"type":["string","null"]},"a":{"enum":[1,2]}}}`,
		},
		{
			name:       "unsupported upstream keeps cleanup",
			format:     `{"name":"answer","schema":{"type":"object","properties":{"a":{"const":"x"}}}}`,
			jsonSchema: false,
			wantSchema: map[string]any{"type": "object", "properties": map[string]any{"a": map[string]any{"const": "x"}}},
		},
	}
	for _, tt := range tests {
		t.Run(tt.name, func(t *testing.T) {
			var config dto.GeminiChatGenerationConfig
			ApplyResponseSchema(&config, json.RawMessage(tt.format), tt.jsonSchema)
			assert.Equal(t, tt.wantSchema, config.ResponseSchema)
			assert.Equal(t, tt.wantJSONSchema, string(config.ResponseJsonSchema))
		})
	}
}

func TestSupportsJSONSchema(t *testing.T) {
	settings := model_setting.GetGeminiSettings()
	original := settings.VersionSettings
	t.Cleanup(func() { settings.VersionSettings = original })
	settings.VersionSettings = map[string]string{"default": "v1beta", "gemini-v1-model": "v1"}

	tests := []struct {
		name        string
		channelType int
		model       string
		want        bool
	}{
		{name: "Gemini on the default version", channelType: constant.ChannelTypeGemini, model: "gemini-3.7-flash", want: true},
		{name: "Gemini on v1", channelType: constant.ChannelTypeGemini, model: "gemini-v1-model", want: false},
		{name: "Vertex AI", channelType: constant.ChannelTypeVertexAi, model: "gemini-v1-model", want: true},
		{name: "other channel on v1", channelType: constant.ChannelTypeOpenAI, model: "gemini-v1-model", want: false},
	}
	for _, tt := range tests {
		t.Run(tt.name, func(t *testing.T) {
			info := &relaycommon.RelayInfo{ChannelMeta: &relaycommon.ChannelMeta{ChannelType: tt.channelType}}
			assert.Equal(t, tt.want, SupportsJSONSchema(info, tt.model))
		})
	}
}

func TestCleanFunctionParametersEnumSanitization(t *testing.T) {
	tests := []struct {
		name     string
		params   map[string]interface{}
		expected map[string]interface{}
	}{
		{
			name: "string enum passes through",
			params: map[string]interface{}{
				"type": "string",
				"enum": []interface{}{"red", "green", "blue"},
			},
			expected: map[string]interface{}{
				"type": "STRING",
				"enum": []interface{}{"red", "green", "blue"},
			},
		},
		{
			name: "boolean enum is dropped and type is kept",
			params: map[string]interface{}{
				"type": "boolean",
				"enum": []interface{}{true},
			},
			expected: map[string]interface{}{
				"type": "BOOLEAN",
			},
		},
		{
			name: "mixed string and boolean enum is dropped",
			params: map[string]interface{}{
				"type": "string",
				"enum": []interface{}{"on", true},
			},
			expected: map[string]interface{}{
				"type": "STRING",
			},
		},
		{
			name: "number enum is dropped",
			params: map[string]interface{}{
				"type": "number",
				"enum": []interface{}{1.0, 2.5},
			},
			expected: map[string]interface{}{
				"type": "NUMBER",
			},
		},
		{
			name: "enum nested in properties is sanitized",
			params: map[string]interface{}{
				"type": "object",
				"properties": map[string]interface{}{
					"flag": map[string]interface{}{
						"type": "boolean",
						"enum": []interface{}{true},
					},
					"color": map[string]interface{}{
						"type": "string",
						"enum": []interface{}{"red"},
					},
				},
			},
			expected: map[string]interface{}{
				"type": "OBJECT",
				"properties": map[string]interface{}{
					"flag": map[string]interface{}{
						"type": "BOOLEAN",
					},
					"color": map[string]interface{}{
						"type": "STRING",
						"enum": []interface{}{"red"},
					},
				},
			},
		},
		{
			name: "enum nested in array items is sanitized",
			params: map[string]interface{}{
				"type": "array",
				"items": map[string]interface{}{
					"type": "boolean",
					"enum": []interface{}{false},
				},
			},
			expected: map[string]interface{}{
				"type":  "ARRAY",
				"items": map[string]interface{}{"type": "BOOLEAN"},
			},
		},
		{
			name: "enum nested in anyOf is sanitized",
			params: map[string]interface{}{
				"anyOf": []interface{}{
					map[string]interface{}{
						"type": "boolean",
						"enum": []interface{}{true},
					},
					map[string]interface{}{
						"type": "string",
						"enum": []interface{}{"yes", "no"},
					},
				},
			},
			expected: map[string]interface{}{
				"anyOf": []interface{}{
					map[string]interface{}{"type": "BOOLEAN"},
					map[string]interface{}{
						"type": "STRING",
						"enum": []interface{}{"yes", "no"},
					},
				},
			},
		},
	}

	for _, tt := range tests {
		t.Run(tt.name, func(t *testing.T) {
			cleaned := CleanFunctionParameters(tt.params)
			assert.Equal(t, tt.expected, cleaned)
		})
	}
}

func TestCleanFunctionParametersShallowDropsBooleanEnum(t *testing.T) {
	// Schemas beyond geminiFunctionSchemaMaxDepth fall back to the shallow
	// cleaner, which must apply the same enum sanitization.
	params := map[string]interface{}{
		"type": "boolean",
		"enum": []interface{}{true},
	}
	cleaned := cleanGeminiFunctionParametersShallow(params)
	assert.Equal(t, map[string]interface{}{"type": "BOOLEAN"}, cleaned)

	stringEnum := map[string]interface{}{
		"type": "string",
		"enum": []interface{}{"a", "b"},
	}
	cleaned = cleanGeminiFunctionParametersShallow(stringEnum)
	assert.Equal(t, map[string]interface{}{
		"type": "STRING",
		"enum": []interface{}{"a", "b"},
	}, cleaned)
}
