package dto

import "github.com/dev-fan-sophon/boxai/constant"

// OpenAIModels is the public GET /v1/models item. OpenAI-compatible identity
// fields stay at the top; the remaining fields are models.dev facts plus the
// gateway's own endpoint support.
type OpenAIModels struct {
	Id                     string                  `json:"id"`
	Object                 string                  `json:"object"`
	Created                int                     `json:"created"`
	OwnedBy                string                  `json:"owned_by"`
	DisplayName            string                  `json:"display_name,omitempty"`
	Description            string                  `json:"description,omitempty"`
	Family                 string                  `json:"family,omitempty"`
	SupportedEndpointTypes []constant.EndpointType `json:"supported_endpoint_types"`
	SupportedReasoning     bool                    `json:"supported_reasoning"`
	ReasoningEfforts       []string                `json:"reasoning_efforts,omitempty"`
	ReasoningOptions       []ReasoningOption       `json:"reasoning_options,omitempty"`
	ContextLength          int                     `json:"context_length,omitempty"`
	MaxInputTokens         int                     `json:"max_input_tokens,omitempty"`
	MaxOutputTokens        int                     `json:"max_output_tokens,omitempty"`
	KnowledgeCutoff        string                  `json:"knowledge_cutoff,omitempty"`
	ReleaseDate            string                  `json:"release_date,omitempty"`
	LastUpdated            string                  `json:"last_updated,omitempty"`
	InputModalities        []string                `json:"input_modalities,omitempty"`
	OutputModalities       []string                `json:"output_modalities,omitempty"`
	Capabilities           []string                `json:"capabilities,omitempty"`
	Temperature            *bool                   `json:"temperature,omitempty"`
	Attachment             bool                    `json:"attachment"`
	OpenWeights            bool                    `json:"open_weights"`
	Interleaved            any                     `json:"interleaved,omitempty"`
}

// ReasoningOption is one models.dev reasoning control (effort / toggle / budget_tokens).
type ReasoningOption struct {
	Type   string   `json:"type"`
	Values []string `json:"values,omitempty"`
	Min    *int     `json:"min,omitempty"`
	Max    *int     `json:"max,omitempty"`
}

type AnthropicModel struct {
	ID          string `json:"id"`
	CreatedAt   string `json:"created_at"`
	DisplayName string `json:"display_name"`
	Type        string `json:"type"`
}

type GeminiModel struct {
	Name                       interface{}   `json:"name"`
	BaseModelId                interface{}   `json:"baseModelId"`
	Version                    interface{}   `json:"version"`
	DisplayName                interface{}   `json:"displayName"`
	Description                interface{}   `json:"description"`
	InputTokenLimit            interface{}   `json:"inputTokenLimit"`
	OutputTokenLimit           interface{}   `json:"outputTokenLimit"`
	SupportedGenerationMethods []interface{} `json:"supportedGenerationMethods"`
	Thinking                   interface{}   `json:"thinking"`
	Temperature                interface{}   `json:"temperature"`
	MaxTemperature             interface{}   `json:"maxTemperature"`
	TopP                       interface{}   `json:"topP"`
	TopK                       interface{}   `json:"topK"`
}
