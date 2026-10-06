package helper

import (
	"bytes"
	"io"
	"net/http"
	"net/http/httptest"
	"testing"

	"github.com/dev-fan-sophon/boxai/types"
	"github.com/gin-gonic/gin"
	"github.com/stretchr/testify/assert"
	"github.com/stretchr/testify/require"
)

const strictNestedRefSchema = `{
	"type":"object",
	"properties":{
		"user":{"$ref":"#/$defs/user"},
		"tags":{"type":"array","items":{"type":"object","properties":{"label":{"type":"string"}},"required":["label"],"additionalProperties":false}},
		"legacy":{"$ref":"#/definitions/legacy"},
		"payload":{"anyOf":[{"type":"string"},{"type":"object","properties":{"id":{"type":"integer"}},"required":["id"],"additionalProperties":false}]}
	},
	"required":["user","tags","legacy","payload"],
	"additionalProperties":false,
	"$defs":{
		"user":{"type":"object","properties":{"name":{"type":"string"},"address":{"$ref":"#/$defs/address"}},"required":["name","address"],"additionalProperties":false},
		"address":{"type":"object","properties":{"city":{"type":"string"}},"required":["city"],"additionalProperties":false}
	},
	"definitions":{
		"legacy":{"allOf":[{"type":"object","properties":{"v":{"type":"number"}},"required":["v"],"additionalProperties":false}]}
	}
}`

// Schema data inside enum/const/default/examples is JSON data, not a
// subschema, so open objects there must not trigger strict object rules.
const strictAdversarialDataSchema = `{
	"type":"object",
	"properties":{
		"mode":{"enum":[{"type":"object","properties":{"x":{"type":"string"}}},"plain"]},
		"fixed":{"const":{"type":"object","properties":{"y":{}}}},
		"conf":{"type":"string","default":{"type":"object","properties":{"z":{}}},"examples":[{"type":"object","properties":{"w":{}}}]}
	},
	"required":["mode","fixed","conf"],
	"additionalProperties":false
}`

const strictNullableOptionalSchema = `{
	"type":"object",
	"properties":{
		"nickname":{"type":["string","null"]},
		"profile":{"type":["object","null"],"properties":{"bio":{"type":["string","null"]}},"required":["bio"],"additionalProperties":false}
	},
	"required":["nickname","profile"],
	"additionalProperties":false
}`

const openSchema = `{"type":"object","properties":{"a":{"type":"object","properties":{"b":{"type":"string"}}}}}`

func chatStructuredBody(jsonSchema string) string {
	return `{"model":"gpt-4o","messages":[{"role":"user","content":"hi"}],"response_format":{"type":"json_schema","json_schema":` + jsonSchema + `}}`
}

func responsesStructuredBody(format string) string {
	return `{"model":"gpt-4o","input":"hi","text":{"format":` + format + `}}`
}

func runStructuredOutputValidation(t *testing.T, format types.RelayFormat, path string, body string) error {
	t.Helper()
	gin.SetMode(gin.TestMode)
	recorder := httptest.NewRecorder()
	c, _ := gin.CreateTestContext(recorder)
	c.Request = httptest.NewRequest(http.MethodPost, path, bytes.NewBufferString(body))
	c.Request.Header.Set("Content-Type", "application/json")

	_, err := GetAndValidateRequest(c, format)

	// Validation must never rewrite the client's schema.
	storedBody, readErr := io.ReadAll(c.Request.Body)
	require.NoError(t, readErr)
	assert.Equal(t, body, string(storedBody))
	return err
}

func TestStructuredOutputValidationEntrypoints(t *testing.T) {
	tests := []struct {
		name       string
		jsonSchema string
		wantErr    string
	}{
		{
			name:       "strict nested refs and definitions",
			jsonSchema: `{"name":"out","strict":true,"schema":` + strictNestedRefSchema + `}`,
		},
		{
			name:       "strict schema data in enum const default examples",
			jsonSchema: `{"name":"out","strict":true,"schema":` + strictAdversarialDataSchema + `}`,
		},
		{
			name:       "strict nullable optional fields listed as required",
			jsonSchema: `{"name":"out","strict":true,"schema":` + strictNullableOptionalSchema + `}`,
		},
		{
			name:       "strict absent keeps open schema",
			jsonSchema: `{"name":"out","schema":` + openSchema + `}`,
		},
		{
			name:       "strict false keeps open schema",
			jsonSchema: `{"name":"out","strict":false,"schema":` + openSchema + `}`,
		},
		{
			name:       "strict null keeps open schema",
			jsonSchema: `{"name":"out","strict":null,"schema":` + openSchema + `}`,
		},
		{
			name:       "strict root missing additionalProperties",
			jsonSchema: `{"name":"out","strict":true,"schema":{"type":"object","properties":{"a":{"type":"string"}},"required":["a"]}}`,
			wantErr:    "schema: strict schema object at # must set additionalProperties to false",
		},
		{
			name:       "strict additionalProperties true",
			jsonSchema: `{"name":"out","strict":true,"schema":{"type":"object","properties":{},"additionalProperties":true}}`,
			wantErr:    "strict schema object at # must set additionalProperties to false",
		},
		{
			name:       "strict nested property missing additionalProperties",
			jsonSchema: `{"name":"out","strict":true,"schema":{"type":"object","properties":{"a":{"type":"object","properties":{"b":{"type":"string"}},"required":["b"]}},"required":["a"],"additionalProperties":false}}`,
			wantErr:    "strict schema object at #/properties/a must set additionalProperties to false",
		},
		{
			name:       "strict $defs object missing additionalProperties",
			jsonSchema: `{"name":"out","strict":true,"schema":{"type":"object","properties":{"u":{"$ref":"#/$defs/u"}},"required":["u"],"additionalProperties":false,"$defs":{"u":{"type":"object","properties":{"n":{"type":"string"}},"required":["n"]}}}}`,
			wantErr:    "strict schema object at #/$defs/u must set additionalProperties to false",
		},
		{
			name:       "strict definitions object missing additionalProperties",
			jsonSchema: `{"name":"out","strict":true,"schema":{"type":"object","properties":{},"additionalProperties":false,"definitions":{"d":{"type":"object","properties":{}}}}}`,
			wantErr:    "strict schema object at #/definitions/d must set additionalProperties to false",
		},
		{
			name:       "strict items object missing additionalProperties",
			jsonSchema: `{"name":"out","strict":true,"schema":{"type":"object","properties":{"l":{"type":"array","items":{"type":"object","properties":{}}}},"required":["l"],"additionalProperties":false}}`,
			wantErr:    "strict schema object at #/properties/l/items must set additionalProperties to false",
		},
		{
			name:       "strict anyOf object missing additionalProperties",
			jsonSchema: `{"name":"out","strict":true,"schema":{"type":"object","properties":{"p":{"anyOf":[{"type":"string"},{"type":"object","properties":{}}]}},"required":["p"],"additionalProperties":false}}`,
			wantErr:    "strict schema object at #/properties/p/anyOf/1 must set additionalProperties to false",
		},
		{
			name:       "strict oneOf nullable object missing additionalProperties",
			jsonSchema: `{"name":"out","strict":true,"schema":{"type":"object","properties":{"p":{"oneOf":[{"type":["object","null"],"properties":{}}]}},"required":["p"],"additionalProperties":false}}`,
			wantErr:    "strict schema object at #/properties/p/oneOf/0 must set additionalProperties to false",
		},
		{
			name:       "strict nullable optional field omitted from required",
			jsonSchema: `{"name":"out","strict":true,"schema":{"type":"object","properties":{"nickname":{"type":["string","null"]}},"additionalProperties":false}}`,
			wantErr:    `strict schema object at # must list property "nickname" in required`,
		},
		{
			name:       "strict malformed required",
			jsonSchema: `{"name":"out","strict":true,"schema":{"type":"object","properties":{"a":{"type":"string"}},"required":"a","additionalProperties":false}}`,
			wantErr:    "required at # must be an array of strings",
		},
		{
			name:       "malformed strict string",
			jsonSchema: `{"name":"out","strict":"true","schema":` + openSchema + `}`,
			wantErr:    "strict must be a boolean",
		},
		{
			name:       "missing name",
			jsonSchema: `{"strict":true,"schema":` + strictNullableOptionalSchema + `}`,
			wantErr:    "name is required",
		},
		{
			name:       "strict missing schema",
			jsonSchema: `{"name":"out","strict":true}`,
			wantErr:    "schema is required",
		},
		{
			name:       "strict non-object schema",
			jsonSchema: `{"name":"out","strict":true,"schema":true}`,
			wantErr:    "schema must be an object when strict is true",
		},
	}

	for _, tt := range tests {
		t.Run("chat/"+tt.name, func(t *testing.T) {
			err := runStructuredOutputValidation(t, types.RelayFormatOpenAI, "/v1/chat/completions", chatStructuredBody(tt.jsonSchema))
			if tt.wantErr == "" {
				require.NoError(t, err)
				return
			}
			require.Error(t, err)
			assert.Contains(t, err.Error(), "response_format.json_schema")
			assert.Contains(t, err.Error(), tt.wantErr)
		})

		// Responses text.format carries the json_schema fields inline.
		format := `{"type":"json_schema",` + tt.jsonSchema[1:]
		t.Run("responses/"+tt.name, func(t *testing.T) {
			err := runStructuredOutputValidation(t, types.RelayFormatOpenAIResponses, "/v1/responses", responsesStructuredBody(format))
			if tt.wantErr == "" {
				require.NoError(t, err)
				return
			}
			require.Error(t, err)
			assert.Contains(t, err.Error(), "text.format")
			assert.Contains(t, err.Error(), tt.wantErr)
		})
	}
}

func TestStructuredOutputSchemaPresenceRules(t *testing.T) {
	tests := []struct {
		name    string
		format  types.RelayFormat
		path    string
		body    string
		wantErr string
	}{
		{
			name:   "chat non-strict schema is optional",
			format: types.RelayFormatOpenAI,
			path:   "/v1/chat/completions",
			body:   chatStructuredBody(`{"name":"out"}`),
		},
		{
			name:    "chat json_schema missing",
			format:  types.RelayFormatOpenAI,
			path:    "/v1/chat/completions",
			body:    `{"model":"gpt-4o","messages":[{"role":"user","content":"hi"}],"response_format":{"type":"json_schema"}}`,
			wantErr: "response_format.json_schema is required when type is json_schema",
		},
		{
			name:    "chat json_schema not an object",
			format:  types.RelayFormatOpenAI,
			path:    "/v1/chat/completions",
			body:    chatStructuredBody(`"out"`),
			wantErr: "response_format.json_schema must be an object",
		},
		{
			name:   "chat json_object type is untouched",
			format: types.RelayFormatOpenAI,
			path:   "/v1/chat/completions",
			body:   `{"model":"gpt-4o","messages":[{"role":"user","content":"hi"}],"response_format":{"type":"json_object"}}`,
		},
		{
			name:    "responses schema is always required",
			format:  types.RelayFormatOpenAIResponses,
			path:    "/v1/responses",
			body:    responsesStructuredBody(`{"type":"json_schema","name":"out"}`),
			wantErr: "text.format.schema is required",
		},
		{
			name:   "responses text format is untouched",
			format: types.RelayFormatOpenAIResponses,
			path:   "/v1/responses",
			body:   responsesStructuredBody(`{"type":"text"}`),
		},
	}

	for _, tt := range tests {
		t.Run(tt.name, func(t *testing.T) {
			err := runStructuredOutputValidation(t, tt.format, tt.path, tt.body)
			if tt.wantErr == "" {
				require.NoError(t, err)
				return
			}
			require.Error(t, err)
			assert.Contains(t, err.Error(), tt.wantErr)
		})
	}
}
