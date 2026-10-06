package dto

import (
	"testing"

	"github.com/dev-fan-sophon/boxai/common"
	"github.com/stretchr/testify/assert"
	"github.com/stretchr/testify/require"
)

// Gemini streams the final thoughtSignature in a part whose only data member is
// an empty text. Re-marshaling must keep `"text": ""`; dropping it produces a
// part with no data member, which Gemini rejects with
// "required oneof field 'data' must have one initialized field".
func TestGeminiPartPreservesExplicitEmptyTextData(t *testing.T) {
	tests := []struct {
		name      string
		input     string
		want      string
		dataCount int
	}{
		{
			name:      "empty text carrying thought signature",
			input:     `{"text":"","thoughtSignature":"sig"}`,
			want:      `{"text":"","thoughtSignature":"sig"}`,
			dataCount: 1,
		},
		{
			name:      "part without any data member stays empty",
			input:     `{"thoughtSignature":"sig"}`,
			want:      `{"thoughtSignature":"sig"}`,
			dataCount: 0,
		},
		{
			name:      "empty text next to inline data still sets a second data member",
			input:     `{"text":"","inlineData":{"mimeType":"image/png","data":"AAAA"}}`,
			want:      `{"text":"","inlineData":{"mimeType":"image/png","data":"AAAA"}}`,
			dataCount: 2,
		},
		{
			name:      "text plus inline data counts both members",
			input:     `{"text":"hi","inline_data":{"mime_type":"image/png","data":"AAAA"}}`,
			want:      `{"text":"hi","inlineData":{"mimeType":"image/png","data":"AAAA"}}`,
			dataCount: 2,
		},
		{
			name:      "function call id round-trips",
			input:     `{"functionCall":{"name":"lookup","args":{"q":1},"id":"fc-1"}}`,
			want:      `{"functionCall":{"name":"lookup","args":{"q":1},"id":"fc-1"}}`,
			dataCount: 1,
		},
	}

	for _, tt := range tests {
		t.Run(tt.name, func(t *testing.T) {
			var part GeminiPart
			require.NoError(t, common.Unmarshal([]byte(tt.input), &part))
			assert.Equal(t, tt.dataCount, part.DataFieldCount())

			encoded, err := common.Marshal(part)
			require.NoError(t, err)
			assert.JSONEq(t, tt.want, string(encoded))
		})
	}
}

func TestGeminiPartConstructedEmptyTextIsNotEmitted(t *testing.T) {
	encoded, err := common.Marshal(GeminiPart{Text: ""})
	require.NoError(t, err)
	assert.JSONEq(t, `{}`, string(encoded))
	assert.Equal(t, 0, (&GeminiPart{}).DataFieldCount())
}
