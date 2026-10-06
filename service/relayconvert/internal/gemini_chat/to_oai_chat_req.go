package geminichat

import (
	"fmt"
	"net/url"
	"strings"

	"github.com/dev-fan-sophon/boxai/common"
	"github.com/dev-fan-sophon/boxai/dto"
	relaycommon "github.com/dev-fan-sophon/boxai/relay/common"
	"github.com/dev-fan-sophon/boxai/service/relayconvert/internal/jsonutil"
	relaymeta "github.com/dev-fan-sophon/boxai/service/relayconvert/internal/meta"
)

// GeminiGenerateContentRequestToOpenAIChat converts a native Gemini
// generateContent request into an OpenAI chat completions request. Content
// that OpenAI chat cannot represent is rejected with an error naming the part,
// instead of being dropped or reshaped into a different media type.
func GeminiGenerateContentRequestToOpenAIChat(geminiRequest *dto.GeminiChatRequest, info *relaycommon.RelayInfo) (*dto.GeneralOpenAIRequest, error) {
	isStream := false
	if info != nil {
		isStream = info.IsStream
	}
	openaiRequest := &dto.GeneralOpenAIRequest{
		Model:  relaymeta.RelayInfoUpstreamModelName(info),
		Stream: common.GetPointer(isStream),
	}

	var messages []dto.Message
	if geminiRequest.SystemInstructions != nil {
		var systemTexts []string
		for i := range geminiRequest.SystemInstructions.Parts {
			part := &geminiRequest.SystemInstructions.Parts[i]
			if part.DataFieldCount() != 1 || part.InlineData != nil || part.FileData != nil || part.FunctionCall != nil ||
				part.FunctionResponse != nil || part.ExecutableCode != nil || part.CodeExecutionResult != nil {
				return nil, fmt.Errorf("systemInstruction.parts[%d]: only text parts can be converted to an OpenAI system message", i)
			}
			if part.Text != "" {
				systemTexts = append(systemTexts, part.Text)
			}
		}
		if len(systemTexts) > 0 {
			messages = append(messages, dto.Message{Role: "system", Content: strings.Join(systemTexts, "\n")})
		}
	}

	// OpenAI links tool results to calls by tool_call_id. Gemini links them by
	// optional id, otherwise by function name in call order.
	type pendingToolCall struct {
		id       string
		name     string
		geminiID string
	}
	var pendingCalls []pendingToolCall
	reservedCallIDs := make(map[string]bool)
	for _, content := range geminiRequest.Contents {
		for _, part := range content.Parts {
			if part.FunctionCall == nil || len(part.FunctionCall.ID) == 0 {
				continue
			}
			var id string
			if err := common.Unmarshal(part.FunctionCall.ID, &id); err != nil || id == "" || reservedCallIDs[id] {
				return nil, fmt.Errorf("functionCall.id must be a unique non-empty string")
			}
			reservedCallIDs[id] = true
		}
	}
	generatedCallCount := 0
	conversationMessageCount := 0

	for contentIndex, content := range geminiRequest.Contents {
		role := "user"
		if content.Role == "model" {
			role = "assistant"
		}
		message := dto.Message{Role: role}
		var mediaContents []dto.MediaContent
		var toolCalls []dto.ToolCallRequest
		var reasoningTexts []string

		for partIndex := range content.Parts {
			part := &content.Parts[partIndex]
			partPath := fmt.Sprintf("contents[%d].parts[%d]", contentIndex, partIndex)
			if part.DataFieldCount() != 1 {
				return nil, fmt.Errorf("%s must set exactly one Gemini data field", partPath)
			}
			if len(part.VideoMetadata) > 0 {
				return nil, fmt.Errorf("%s: videoMetadata cannot be represented in OpenAI chat", partPath)
			}

			switch {
			case part.Text != "" && part.Thought:
				if role != "assistant" {
					return nil, fmt.Errorf("%s: thought parts are only valid in model turns", partPath)
				}
				reasoningTexts = append(reasoningTexts, part.Text)
			case part.Text != "":
				mediaContents = append(mediaContents, dto.MediaContent{Type: dto.ContentTypeText, Text: part.Text})
			case part.InlineData != nil || part.FileData != nil:
				mediaContent, err := geminiMediaPartToOpenAIContent(part, role)
				if err != nil {
					return nil, fmt.Errorf("%s: %w", partPath, err)
				}
				mediaContents = append(mediaContents, mediaContent)
			case part.FunctionCall != nil:
				if role != "assistant" {
					return nil, fmt.Errorf("%s: functionCall is only valid in model turns", partPath)
				}
				var geminiID string
				if len(part.FunctionCall.ID) > 0 {
					_ = common.Unmarshal(part.FunctionCall.ID, &geminiID)
				}
				callID := geminiID
				if callID == "" {
					for {
						generatedCallCount++
						callID = fmt.Sprintf("call_%d", generatedCallCount)
						if !reservedCallIDs[callID] {
							break
						}
					}
				}
				arguments := "{}"
				if part.FunctionCall.Arguments != nil {
					arguments = jsonutil.ToJSONString(part.FunctionCall.Arguments)
				}
				toolCalls = append(toolCalls, dto.ToolCallRequest{
					ID:   callID,
					Type: "function",
					Function: dto.FunctionRequest{
						Name:      part.FunctionCall.FunctionName,
						Arguments: arguments,
					},
				})
				pendingCalls = append(pendingCalls, pendingToolCall{id: callID, name: part.FunctionCall.FunctionName, geminiID: geminiID})
			case part.FunctionResponse != nil:
				if role == "assistant" {
					return nil, fmt.Errorf("%s: functionResponse is not valid in model turns", partPath)
				}
				if len(part.FunctionResponse.Parts) > 0 && string(part.FunctionResponse.Parts) != "null" && string(part.FunctionResponse.Parts) != "[]" {
					return nil, fmt.Errorf("%s: multimodal functionResponse.parts cannot be represented in OpenAI chat", partPath)
				}
				var responseID string
				if len(part.FunctionResponse.ID) > 0 {
					_ = common.Unmarshal(part.FunctionResponse.ID, &responseID)
				}
				matched := -1
				for i, call := range pendingCalls {
					if responseID != "" && call.geminiID == responseID {
						matched = i
						break
					}
				}
				for i, call := range pendingCalls {
					if matched >= 0 {
						break
					}
					if call.name == part.FunctionResponse.Name && (responseID == "" || call.geminiID == "") {
						matched = i
					}
				}
				if matched < 0 {
					return nil, fmt.Errorf("%s: functionResponse %q has no preceding matching functionCall", partPath, part.FunctionResponse.Name)
				}
				toolCallID := pendingCalls[matched].id
				pendingCalls = append(pendingCalls[:matched], pendingCalls[matched+1:]...)
				response := "{}"
				if part.FunctionResponse.Response != nil {
					response = jsonutil.ToJSONString(part.FunctionResponse.Response)
				}
				toolMessage := dto.Message{Role: "tool", ToolCallId: toolCallID}
				toolMessage.SetStringContent(response)
				// Tool results must directly follow the assistant tool_calls
				// turn, so they precede any other content of this turn.
				messages = append(messages, toolMessage)
				conversationMessageCount++
			case part.ExecutableCode != nil || part.CodeExecutionResult != nil:
				return nil, fmt.Errorf("%s: code execution parts cannot be represented in OpenAI chat", partPath)
			default:
				// Explicit empty text (typically a streamed thoughtSignature
				// carrier) holds no content to convert.
			}
		}

		if len(mediaContents) == 1 && mediaContents[0].Type == dto.ContentTypeText {
			message.SetStringContent(mediaContents[0].Text)
		} else if len(mediaContents) > 0 {
			message.SetMediaContent(mediaContents)
		}
		if len(toolCalls) > 0 {
			message.SetToolCalls(toolCalls)
		}
		if len(mediaContents) == 0 && len(toolCalls) == 0 {
			continue
		}
		if len(reasoningTexts) > 0 {
			message.ReasoningContent = common.GetPointer(strings.Join(reasoningTexts, "\n"))
		}
		messages = append(messages, message)
		conversationMessageCount++
	}

	if conversationMessageCount == 0 {
		return nil, fmt.Errorf("contents contain no content that can be converted to OpenAI chat")
	}
	openaiRequest.Messages = messages

	generationConfig := geminiRequest.GenerationConfig
	openaiRequest.Temperature = generationConfig.Temperature
	openaiRequest.TopP = generationConfig.TopP
	if generationConfig.TopK != nil {
		openaiRequest.TopK = common.GetPointer(int(*generationConfig.TopK))
	}
	openaiRequest.MaxTokens = generationConfig.MaxOutputTokens
	if len(generationConfig.StopSequences) > 0 {
		openaiRequest.Stop = generationConfig.StopSequences[:min(len(generationConfig.StopSequences), 4)]
	}
	openaiRequest.N = generationConfig.CandidateCount

	var tools []dto.ToolCallRequest
	for _, tool := range geminiRequest.GetTools() {
		if tool.FunctionDeclarations == nil {
			continue
		}
		functionDeclarations, err := common.Any2Type[[]struct {
			Name                 string `json:"name"`
			Description          string `json:"description,omitempty"`
			Parameters           any    `json:"parameters,omitempty"`
			ParametersJsonSchema any    `json:"parametersJsonSchema,omitempty"`
		}](tool.FunctionDeclarations)
		if err != nil {
			return nil, fmt.Errorf("invalid gemini functionDeclarations: %w", err)
		}
		for _, function := range functionDeclarations {
			parameters := function.Parameters
			if parameters == nil {
				parameters = function.ParametersJsonSchema
			}
			tools = append(tools, dto.ToolCallRequest{
				Type: "function",
				Function: dto.FunctionRequest{
					Name:        function.Name,
					Description: function.Description,
					Parameters:  parameters,
				},
			})
		}
	}
	if len(tools) > 0 {
		openaiRequest.Tools = tools
		if toolConfig := geminiRequest.ToolConfig; toolConfig != nil && toolConfig.FunctionCallingConfig != nil {
			allowedNames := toolConfig.FunctionCallingConfig.AllowedFunctionNames
			switch strings.ToUpper(string(toolConfig.FunctionCallingConfig.Mode)) {
			case "NONE":
				openaiRequest.ToolChoice = "none"
			case "AUTO", "VALIDATED":
				openaiRequest.ToolChoice = "auto"
			case "ANY":
				if len(allowedNames) == 1 {
					openaiRequest.ToolChoice = map[string]any{
						"type":     "function",
						"function": map[string]any{"name": allowedNames[0]},
					}
				} else {
					openaiRequest.ToolChoice = "required"
				}
			}
		}
	}

	return openaiRequest, nil
}

// geminiMediaPartToOpenAIContent maps Gemini inlineData/fileData to the
// OpenAI chat content type with the same meaning. Images become image_url,
// wav/mp3 audio becomes input_audio, video becomes video_url, and documents
// become file parts; anything else is rejected rather than relabelled.
func geminiMediaPartToOpenAIContent(part *dto.GeminiPart, role string) (dto.MediaContent, error) {
	if part.FileData != nil {
		mimeType := strings.ToLower(strings.TrimSpace(part.FileData.MimeType))
		fileURI := strings.TrimSpace(part.FileData.FileUri)
		parsedURI, err := url.Parse(fileURI)
		isFetchableURL := err == nil && (parsedURI.Scheme == "http" || parsedURI.Scheme == "https") &&
			parsedURI.Host != "" && !strings.EqualFold(parsedURI.Hostname(), "generativelanguage.googleapis.com")
		if !isFetchableURL || (mimeType != "" && !strings.HasPrefix(mimeType, "image/")) {
			return dto.MediaContent{}, fmt.Errorf("fileData %q (mimeType %q) cannot be represented in OpenAI chat; only public http(s) image URLs are supported, send other media as inlineData", fileURI, part.FileData.MimeType)
		}
		return dto.MediaContent{
			Type:     dto.ContentTypeImageURL,
			ImageUrl: &dto.MessageImageUrl{Url: fileURI, Detail: "auto", MimeType: part.FileData.MimeType},
		}, nil
	}

	mimeType := strings.ToLower(strings.TrimSpace(part.InlineData.MimeType))
	if part.InlineData.Data == "" || mimeType == "" {
		return dto.MediaContent{}, fmt.Errorf("inlineData requires non-empty mimeType and data")
	}
	dataURL := fmt.Sprintf("data:%s;base64,%s", part.InlineData.MimeType, part.InlineData.Data)
	if strings.HasPrefix(mimeType, "image/") {
		return dto.MediaContent{
			Type:     dto.ContentTypeImageURL,
			ImageUrl: &dto.MessageImageUrl{Url: dataURL, Detail: "auto", MimeType: part.InlineData.MimeType},
		}, nil
	}
	if role == "assistant" {
		return dto.MediaContent{}, fmt.Errorf("inlineData %q in a model turn cannot be represented in OpenAI chat; assistant messages carry only text and images", part.InlineData.MimeType)
	}
	switch {
	case strings.HasPrefix(mimeType, "audio/"):
		format := ""
		switch strings.TrimPrefix(mimeType, "audio/") {
		case "wav", "wave", "x-wav", "vnd.wave":
			format = "wav"
		case "mp3", "mpeg", "mpeg3", "x-mp3":
			format = "mp3"
		default:
			return dto.MediaContent{}, fmt.Errorf("audio inlineData %q cannot be represented in OpenAI chat; input_audio supports only wav and mp3", part.InlineData.MimeType)
		}
		return dto.MediaContent{
			Type:       dto.ContentTypeInputAudio,
			InputAudio: &dto.MessageInputAudio{Data: part.InlineData.Data, Format: format},
		}, nil
	case strings.HasPrefix(mimeType, "video/"):
		return dto.MediaContent{
			Type:     dto.ContentTypeVideoUrl,
			VideoUrl: &dto.MessageVideoUrl{Url: dataURL},
		}, nil
	}
	extension := ""
	switch mimeType {
	case "application/pdf":
		extension = "pdf"
	case "text/plain":
		extension = "txt"
	case "text/markdown", "text/md":
		extension = "md"
	case "text/csv":
		extension = "csv"
	case "text/html":
		extension = "html"
	case "text/xml", "application/xml":
		extension = "xml"
	case "application/json":
		extension = "json"
	case "application/rtf", "text/rtf":
		extension = "rtf"
	default:
		return dto.MediaContent{}, fmt.Errorf("inlineData %q cannot be represented in OpenAI chat", part.InlineData.MimeType)
	}
	return dto.MediaContent{
		Type: dto.ContentTypeFile,
		File: &dto.MessageFile{FileName: "document." + extension, FileData: dataURL},
	}, nil
}
