package service

import (
	"errors"
	"fmt"

	"github.com/dev-fan-sophon/boxai/dto"
)

// Trial funding covers bounded text generation, not batches, server-side
// agent loops or opaque passthrough options that can bypass the output cap.
func validateTrialRequest(request dto.Request, maxOutput int) error {
	if request == nil {
		return errors.New("trial requires a bounded text request")
	}
	unsupported := false
	switch r := request.(type) {
	case *dto.GeneralOpenAIRequest:
		unsupported = (r.N != nil && *r.N != 1) || len(r.Tools) > 0 || len(r.Functions) > 0 || len(r.ExtraBody) > 0 || len(r.SearchParameters) > 0 || r.WebSearchOptions != nil || len(r.EnableSearch) > 0 || len(r.WebSearch) > 0 || len(r.Audio) > 0 || len(r.Modalities) > 0
		if r.MaxTokens != nil && *r.MaxTokens > uint(maxOutput) {
			unsupported = true
		}
	case *dto.OpenAIResponsesRequest:
		unsupported = len(r.Tools) > 0 || r.MaxTurns != nil || r.PreviousResponseID != "" || len(r.Prompt) > 0
	case *dto.ClaudeRequest:
		unsupported = r.Tools != nil || len(r.McpServers) > 0 || len(r.Container) > 0
		if r.MaxTokensToSample != nil && *r.MaxTokensToSample > uint(maxOutput) {
			unsupported = true
		}
	case *dto.GeminiChatRequest:
		unsupported = len(r.Requests) > 0 || len(r.Tools) > 0 || len(r.GenerationConfig.ResponseModalities) > 0 || len(r.GenerationConfig.SpeechConfig) > 0 || len(r.GenerationConfig.ImageConfig) > 0 || (r.GenerationConfig.CandidateCount != nil && *r.GenerationConfig.CandidateCount != 1)
	default:
		unsupported = true
	}
	if unsupported {
		return errors.New("trial supports single text generations without tools or passthrough options; use paid funding for this request")
	}
	meta := request.GetTokenCountMeta()
	if meta == nil || meta.MaxTokens <= 0 || meta.MaxTokens > maxOutput {
		return fmt.Errorf("trial requires an explicit maximum output token limit between 1 and %d", maxOutput)
	}
	return nil
}
