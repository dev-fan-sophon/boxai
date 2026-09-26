package ollama

import (
	"encoding/json"
	"fmt"
	"io"
	"net/http"
	"strings"
	"time"

	"github.com/dev-fan-sophon/boxai/common"
	"github.com/dev-fan-sophon/boxai/constant"
	"github.com/dev-fan-sophon/boxai/dto"
	"github.com/dev-fan-sophon/boxai/logger"
	"github.com/dev-fan-sophon/boxai/relay/channel/openai"
	relaycommon "github.com/dev-fan-sophon/boxai/relay/common"
	"github.com/dev-fan-sophon/boxai/relay/helper"
	"github.com/dev-fan-sophon/boxai/service"
	"github.com/dev-fan-sophon/boxai/service/relayconvert"
	"github.com/dev-fan-sophon/boxai/types"

	"github.com/gin-gonic/gin"
)

type ollamaChatStreamChunk struct {
	Model     string `json:"model"`
	CreatedAt string `json:"created_at"`
	// chat
	Message *struct {
		Role      string           `json:"role"`
		Content   string           `json:"content"`
		Thinking  json.RawMessage  `json:"thinking"`
		ToolCalls []OllamaToolCall `json:"tool_calls"`
	} `json:"message"`
	// generate
	Response              string `json:"response"`
	Done                  bool   `json:"done"`
	DoneReason            string `json:"done_reason"`
	TotalDuration         int64  `json:"total_duration"`
	LoadDuration          int64  `json:"load_duration"`
	PromptEvalCount       int    `json:"prompt_eval_count"`
	PromptEvalCachedCount int    `json:"prompt_eval_cached_count"`
	EvalCount             int    `json:"eval_count"`
	PromptEvalDuration    int64  `json:"prompt_eval_duration"`
	EvalDuration          int64  `json:"eval_duration"`
}

func ollamaToolCallsToOpenAI(toolCalls []OllamaToolCall, startIndex int, includeIndex bool) ([]dto.ToolCallResponse, int) {
	if len(toolCalls) == 0 {
		return nil, startIndex
	}
	result := make([]dto.ToolCallResponse, 0, len(toolCalls))
	for _, tc := range toolCalls {
		var argBytes []byte
		var err error
		if tc.Function.Arguments == nil {
			argBytes = []byte("{}")
		} else {
			argBytes, err = common.Marshal(tc.Function.Arguments)
			if err != nil || len(argBytes) == 0 {
				argBytes = []byte("{}")
			}
		}
		toolCallID := tc.ID
		if toolCallID == "" {
			toolCallID = fmt.Sprintf("call_%d", startIndex)
		}
		tr := dto.ToolCallResponse{
			ID:   toolCallID,
			Type: "function",
			Function: dto.FunctionResponse{
				Name:      tc.Function.Name,
				Arguments: string(argBytes),
			},
		}
		if includeIndex {
			tr.SetIndex(startIndex)
		}
		startIndex++
		result = append(result, tr)
	}
	return result, startIndex
}

func toUnix(ts string) int64 {
	if ts == "" {
		return time.Now().Unix()
	}
	// try time.RFC3339 or with nanoseconds
	t, err := time.Parse(time.RFC3339Nano, ts)
	if err != nil {
		t2, err2 := time.Parse(time.RFC3339, ts)
		if err2 == nil {
			return t2.Unix()
		}
		return time.Now().Unix()
	}
	return t.Unix()
}

// Ollama includes cache hits in prompt_eval_count; Claude input_tokens excludes them.
// Keep the original usage intact for billing and OpenAI clients.
func ollamaClaudeUsage(usage *dto.Usage) *dto.Usage {
	converted := *usage
	converted.PromptTokens = max(0, usage.PromptTokens-usage.PromptTokensDetails.CachedTokens)
	return &converted
}

func ollamaStreamResponse(c *gin.Context, info *relaycommon.RelayInfo, response *dto.ChatCompletionsStreamResponse) error {
	data, err := common.Marshal(response)
	if err != nil {
		return err
	}
	if info.RelayFormat != types.RelayFormatClaude {
		return helper.StringData(c, string(data))
	}
	return openai.HandleStreamFormat(c, info, string(data), false, false)
}

func ollamaStreamHandler(c *gin.Context, info *relaycommon.RelayInfo, resp *http.Response) (*dto.Usage, *types.NewAPIError) {
	if resp == nil || resp.Body == nil {
		return nil, types.NewOpenAIError(fmt.Errorf("empty response"), types.ErrorCodeBadResponse, http.StatusBadRequest)
	}
	defer service.CloseResponseBodyGracefully(resp)

	helper.SetEventStreamHeaders(c)
	scanner := helper.NewStreamScanner(resp.Body)
	usage := &dto.Usage{}
	var model = info.UpstreamModelName
	var responseId = common.GetUUID()
	var created = time.Now().Unix()
	var toolCallIndex int
	start := helper.GenerateStartEmptyResponse(responseId, created, model, nil)
	if err := ollamaStreamResponse(c, info, start); err != nil {
		return usage, types.NewError(err, types.ErrorCodeBadResponseBody)
	}

	for scanner.Scan() {
		line := scanner.Text()
		line = strings.TrimSpace(line)
		if line == "" {
			continue
		}
		var chunk ollamaChatStreamChunk
		if err := common.Unmarshal([]byte(line), &chunk); err != nil {
			logger.LogError(c, "ollama stream json decode error: "+err.Error()+" line="+line)
			return usage, types.NewOpenAIError(err, types.ErrorCodeBadResponseBody, http.StatusInternalServerError)
		}
		if chunk.Model != "" {
			model = chunk.Model
		}
		created = toUnix(chunk.CreatedAt)

		if !chunk.Done {
			// delta content
			var content string
			if chunk.Message != nil {
				content = chunk.Message.Content
			} else {
				content = chunk.Response
			}
			delta := dto.ChatCompletionsStreamResponse{
				Id:      responseId,
				Object:  "chat.completion.chunk",
				Created: created,
				Model:   model,
				Choices: []dto.ChatCompletionsStreamResponseChoice{{
					Index: 0,
					Delta: dto.ChatCompletionsStreamResponseChoiceDelta{Role: "assistant"},
				}},
			}
			if content != "" {
				delta.Choices[0].Delta.SetContentString(content)
			}
			if chunk.Message != nil && len(chunk.Message.Thinking) > 0 {
				raw := strings.TrimSpace(string(chunk.Message.Thinking))
				if raw != "" && raw != "null" {
					// Unmarshal the JSON string to get the actual content without quotes
					var thinkingContent string
					if err := common.Unmarshal(chunk.Message.Thinking, &thinkingContent); err == nil {
						delta.Choices[0].Delta.SetReasoningContent(thinkingContent)
					} else {
						// Fallback to raw string if it's not a JSON string
						delta.Choices[0].Delta.SetReasoningContent(raw)
					}
				}
			}
			// tool calls
			if chunk.Message != nil && len(chunk.Message.ToolCalls) > 0 {
				delta.Choices[0].Delta.ToolCalls, toolCallIndex = ollamaToolCallsToOpenAI(chunk.Message.ToolCalls, toolCallIndex, true)
			}
			if info.RelayFormat == types.RelayFormatClaude {
				// The shared converter consumes one block type per delta. Ollama can
				// return thinking, text and tools together, so send each in order.
				original := delta.Choices[0].Delta
				parts := []dto.ChatCompletionsStreamResponseChoiceDelta{}
				if reasoning := original.GetReasoningContent(); reasoning != "" {
					part := dto.ChatCompletionsStreamResponseChoiceDelta{}
					part.SetReasoningContent(reasoning)
					parts = append(parts, part)
				}
				if content := original.GetContentString(); content != "" {
					part := dto.ChatCompletionsStreamResponseChoiceDelta{}
					part.SetContentString(content)
					parts = append(parts, part)
				}
				if len(original.ToolCalls) > 0 {
					parts = append(parts, dto.ChatCompletionsStreamResponseChoiceDelta{ToolCalls: original.ToolCalls})
				}
				for _, part := range parts {
					delta.Choices[0].Delta = part
					if err := ollamaStreamResponse(c, info, &delta); err != nil {
						return usage, types.NewError(err, types.ErrorCodeBadResponseBody)
					}
				}
			} else if err := ollamaStreamResponse(c, info, &delta); err != nil {
				return usage, types.NewError(err, types.ErrorCodeBadResponseBody)
			}
			continue
		}
		// done frame
		// finalize once and break loop
		usage.PromptTokens = chunk.PromptEvalCount
		usage.PromptTokensDetails.CachedTokens = chunk.PromptEvalCachedCount
		usage.CompletionTokens = chunk.EvalCount
		usage.TotalTokens = usage.PromptTokens + usage.CompletionTokens
		finishReason := chunk.DoneReason
		if finishReason == "" {
			finishReason = "stop"
		}
		if toolCallIndex > 0 {
			finishReason = constant.FinishReasonToolCalls
		}
		if info.RelayFormat == types.RelayFormatClaude {
			stop := helper.GenerateStopResponse(responseId, created, model, finishReason)
			stop.Usage = ollamaClaudeUsage(usage)
			data, err := common.Marshal(stop)
			if err != nil {
				return usage, types.NewError(err, types.ErrorCodeBadResponseBody)
			}
			info.SendResponseCount++
			openai.HandleFinalResponse(c, info, string(data), responseId, created, model, "", stop.Usage, true)
			break
		}
		// emit stop delta
		if stop := helper.GenerateStopResponse(responseId, created, model, finishReason); stop != nil {
			if data, err := common.Marshal(stop); err == nil {
				_ = helper.StringData(c, string(data))
			}
		}
		// emit usage frame
		if final := helper.GenerateFinalUsageResponse(responseId, created, model, *usage); final != nil {
			if data, err := common.Marshal(final); err == nil {
				_ = helper.StringData(c, string(data))
			}
		}
		// send [DONE]
		helper.Done(c)
		break
	}
	if err := scanner.Err(); err != nil && err != io.EOF {
		logger.LogError(c, "ollama stream scan error: "+err.Error())
	}
	return usage, nil
}

// non-stream handler for chat/generate
func ollamaChatHandler(c *gin.Context, info *relaycommon.RelayInfo, resp *http.Response) (*dto.Usage, *types.NewAPIError) {
	body, err := io.ReadAll(resp.Body)
	if err != nil {
		return nil, types.NewOpenAIError(err, types.ErrorCodeReadResponseBodyFailed, http.StatusInternalServerError)
	}
	service.CloseResponseBodyGracefully(resp)
	raw := string(body)
	if common.DebugEnabled {
		println("ollama non-stream raw resp:", raw)
	}

	lines := strings.Split(raw, "\n")
	var (
		aggContent       strings.Builder
		reasoningBuilder strings.Builder
		lastChunk        ollamaChatStreamChunk
		parsedAny        bool
		toolCallIndex    int
		toolCalls        []dto.ToolCallResponse
	)
	for _, ln := range lines {
		ln = strings.TrimSpace(ln)
		if ln == "" {
			continue
		}
		var ck ollamaChatStreamChunk
		if err := common.Unmarshal([]byte(ln), &ck); err != nil {
			if len(lines) == 1 {
				return nil, types.NewOpenAIError(err, types.ErrorCodeBadResponseBody, http.StatusInternalServerError)
			}
			continue
		}
		parsedAny = true
		lastChunk = ck
		if ck.Message != nil && len(ck.Message.Thinking) > 0 {
			raw := strings.TrimSpace(string(ck.Message.Thinking))
			if raw != "" && raw != "null" {
				// Unmarshal the JSON string to get the actual content without quotes
				var thinkingContent string
				if err := common.Unmarshal(ck.Message.Thinking, &thinkingContent); err == nil {
					reasoningBuilder.WriteString(thinkingContent)
				} else {
					// Fallback to raw string if it's not a JSON string
					reasoningBuilder.WriteString(raw)
				}
			}
		}
		if ck.Message != nil && ck.Message.Content != "" {
			aggContent.WriteString(ck.Message.Content)
		} else if ck.Response != "" {
			aggContent.WriteString(ck.Response)
		}
		if ck.Message != nil && len(ck.Message.ToolCalls) > 0 {
			var converted []dto.ToolCallResponse
			converted, toolCallIndex = ollamaToolCallsToOpenAI(ck.Message.ToolCalls, toolCallIndex, false)
			toolCalls = append(toolCalls, converted...)
		}
	}

	if !parsedAny {
		var single ollamaChatStreamChunk
		if err := common.Unmarshal(body, &single); err != nil {
			return nil, types.NewOpenAIError(err, types.ErrorCodeBadResponseBody, http.StatusInternalServerError)
		}
		lastChunk = single
		if single.Message != nil {
			if len(single.Message.Thinking) > 0 {
				raw := strings.TrimSpace(string(single.Message.Thinking))
				if raw != "" && raw != "null" {
					// Unmarshal the JSON string to get the actual content without quotes
					var thinkingContent string
					if err := common.Unmarshal(single.Message.Thinking, &thinkingContent); err == nil {
						reasoningBuilder.WriteString(thinkingContent)
					} else {
						// Fallback to raw string if it's not a JSON string
						reasoningBuilder.WriteString(raw)
					}
				}
			}
			aggContent.WriteString(single.Message.Content)
			if len(single.Message.ToolCalls) > 0 {
				var converted []dto.ToolCallResponse
				converted, toolCallIndex = ollamaToolCallsToOpenAI(single.Message.ToolCalls, toolCallIndex, false)
				toolCalls = append(toolCalls, converted...)
			}
		} else {
			aggContent.WriteString(single.Response)
		}
	}

	model := lastChunk.Model
	if model == "" {
		model = info.UpstreamModelName
	}
	created := toUnix(lastChunk.CreatedAt)
	usage := &dto.Usage{
		PromptTokens:     lastChunk.PromptEvalCount,
		CompletionTokens: lastChunk.EvalCount,
		TotalTokens:      lastChunk.PromptEvalCount + lastChunk.EvalCount,
	}
	usage.PromptTokensDetails.CachedTokens = lastChunk.PromptEvalCachedCount
	content := aggContent.String()
	finishReason := lastChunk.DoneReason
	if finishReason == "" {
		finishReason = "stop"
	}
	if len(toolCalls) > 0 {
		finishReason = constant.FinishReasonToolCalls
	}

	msg := dto.Message{Role: "assistant", Content: contentPtr(content)}
	if len(toolCalls) > 0 {
		if rawToolCalls, err := common.Marshal(toolCalls); err == nil {
			msg.ToolCalls = rawToolCalls
		}
	}
	if rc := reasoningBuilder.String(); rc != "" {
		msg.ReasoningContent = &rc
	}
	full := dto.OpenAITextResponse{
		Id:      common.GetUUID(),
		Model:   model,
		Object:  "chat.completion",
		Created: created,
		Choices: []dto.OpenAITextResponseChoice{{
			Index:        0,
			Message:      msg,
			FinishReason: finishReason,
		}},
		Usage: *usage,
	}
	var output any = &full
	if info.RelayFormat == types.RelayFormatClaude {
		// StringContent used by the converter expects a string, not *string.
		full.Choices[0].Message.SetStringContent(content)
		full.Usage = *ollamaClaudeUsage(usage)
		result, err := relayconvert.ConvertResponse(c, info, types.RelayFormatClaude, &full)
		if err != nil {
			return nil, types.NewError(err, types.ErrorCodeBadResponseBody)
		}
		claudeResponse, ok := result.Value.(*dto.ClaudeResponse)
		if !ok {
			return nil, types.NewError(fmt.Errorf("expected Claude response, got %T", result.Value), types.ErrorCodeBadResponseBody)
		}
		// The shared non-stream converter currently maps text and tools only.
		if msg.ReasoningContent != nil {
			claudeResponse.Content = append([]dto.ClaudeMediaMessage{{
				Type: "thinking", Thinking: msg.ReasoningContent,
			}}, claudeResponse.Content...)
		}
		output = claudeResponse
	}
	out, err := common.Marshal(output)
	if err != nil {
		return nil, types.NewError(err, types.ErrorCodeBadResponseBody)
	}
	service.IOCopyBytesGracefully(c, resp, out)
	return usage, nil
}

func contentPtr(s string) *string {
	if s == "" {
		return nil
	}
	return &s
}
