package oairesponses

import (
	"fmt"
	"slices"
	"strings"

	"github.com/dev-fan-sophon/boxai/common"
	"github.com/dev-fan-sophon/boxai/dto"
	relaycommon "github.com/dev-fan-sophon/boxai/relay/common"
	"github.com/dev-fan-sophon/boxai/service/relayconvert/internal/customtool"
	relaymedia "github.com/dev-fan-sophon/boxai/service/relayconvert/internal/media"
	relaymeta "github.com/dev-fan-sophon/boxai/service/relayconvert/internal/meta"
	sharedgemini "github.com/dev-fan-sophon/boxai/service/relayconvert/internal/shared/gemini"
	"github.com/dev-fan-sophon/boxai/setting/model_setting"
	"github.com/gin-gonic/gin"
)

func convertOpenAIResponsesRequestToGeminiChat(c *gin.Context, info *relaycommon.RelayInfo, request any) (any, error) {
	responsesRequest, err := OpenAIResponsesRequestFromAny(request)
	if err != nil {
		return nil, err
	}

	prepared, err := PrepareOpenAIResponsesRequest(*responsesRequest)
	if err != nil {
		return nil, err
	}
	return OpenAIResponsesRequestToGeminiChat(c, &prepared, info)
}

func OpenAIResponsesRequestToGeminiChat(c *gin.Context, req *dto.OpenAIResponsesRequest, info *relaycommon.RelayInfo) (*dto.GeminiChatRequest, error) {
	if req == nil {
		return nil, fmt.Errorf("request is nil")
	}
	if req.Model == "" {
		return nil, fmt.Errorf("model is required")
	}
	if err := ValidateRequestChatUnsupportedFields(req); err != nil {
		return nil, err
	}

	geminiRequest := &dto.GeminiChatRequest{
		GenerationConfig: dto.GeminiChatGenerationConfig{
			Temperature: req.Temperature,
		},
	}
	if req.TopP != nil && *req.TopP > 0 {
		geminiRequest.GenerationConfig.TopP = common.GetPointer(*req.TopP)
	}
	if req.MaxOutputTokens != nil && *req.MaxOutputTokens > 0 {
		geminiRequest.GenerationConfig.MaxOutputTokens = common.GetPointer(*req.MaxOutputTokens)
	}

	upstreamModelName := req.Model
	if modelName := relaymeta.RelayInfoUpstreamModelName(info); modelName != "" {
		upstreamModelName = modelName
	}
	if model_setting.IsGeminiModelSupportImagine(upstreamModelName) {
		geminiRequest.GenerationConfig.ResponseModalities = []string{"TEXT", "IMAGE"}
	}
	jsonSchema := sharedgemini.SupportsJSONSchema(info, upstreamModelName)
	if err := applyResponsesTextToGemini(req.Text, geminiRequest, jsonSchema); err != nil {
		return nil, err
	}
	sharedgemini.ApplyThinkingConfig(geminiRequest, info, dto.GeneralOpenAIRequest{
		Model:               req.Model,
		MaxCompletionTokens: req.MaxOutputTokens,
		ReasoningEffort:     ReasoningEffort(req),
	})

	safetySettings := make([]dto.GeminiChatSafetySettings, 0, len(sharedgemini.SafetySettingCategories))
	for _, category := range sharedgemini.SafetySettingCategories {
		safetySettings = append(safetySettings, dto.GeminiChatSafetySettings{
			Category:  category,
			Threshold: model_setting.GetGeminiSafetySetting(category),
		})
	}
	geminiRequest.SafetySettings = safetySettings

	functions, customNames, err := RequestFunctionDeclarations(req.Tools)
	if err != nil {
		return nil, err
	}
	if len(functions) > 0 {
		geminiRequest.SetTools([]dto.GeminiChatTool{
			{FunctionDeclarations: sharedgemini.FunctionDeclarations(functions, jsonSchema)},
		})
	}

	toolChoice, err := RequestToolChoiceToChat(req.ToolChoice, customNames)
	if err != nil {
		return nil, err
	}
	if toolChoice != nil && len(functions) > 0 {
		geminiRequest.ToolConfig = sharedgemini.OpenAIToolChoiceToConfig(toolChoice)
	}

	systemTexts := make([]string, 0)
	if RawJSONPresent(req.Instructions) {
		instructions, err := JSONString(req.Instructions)
		if err != nil {
			return nil, fmt.Errorf("invalid instructions: %w", err)
		}
		if strings.TrimSpace(instructions) != "" {
			systemTexts = append(systemTexts, instructions)
		}
	}

	inputItems, err := InputItems(req.Input)
	if err != nil {
		return nil, err
	}
	// Multimodal function responses (media in functionResponse.parts) are
	// documented for Gemini 3. Gemini 1.x and 2.x get tool media as ordinary
	// inlineData parts after the function responses of the same turn.
	modelID := strings.TrimPrefix(strings.ToLower(upstreamModelName), "models/")
	toolMediaInFunctionResponse := !strings.HasPrefix(modelID, "gemini-1.") && !strings.HasPrefix(modelID, "gemini-2.")
	callNames := make(map[string]string)
	for _, item := range inputItems {
		itemType := strings.TrimSpace(common.Interface2String(item["type"]))
		switch itemType {
		case ResponsesInputTypeFunctionCall, ResponsesInputTypeCustomToolCall:
			part, callID, err := responsesFunctionCallItemToGeminiPart(item)
			if err != nil {
				return nil, err
			}
			sharedgemini.AttachFunctionCallThoughtSignature(&part)
			if callID != "" {
				callNames[callID] = part.FunctionCall.FunctionName
			}
			appendGeminiContentPart(geminiRequest, "model", part)
		case ResponsesInputTypeFunctionCallOutput, ResponsesInputTypeCustomToolOutput:
			part, media, err := responsesFunctionOutputItemToGeminiPart(c, item, callNames, toolMediaInFunctionResponse)
			if err != nil {
				return nil, fmt.Errorf("tool output %s: %w", CallID(item), err)
			}
			appendGeminiContentPart(geminiRequest, "user", part)
			turn := &geminiRequest.Contents[len(geminiRequest.Contents)-1]
			turn.Parts = append(turn.Parts, media...)
		default:
			role := responsesGeminiRole(item)
			parts, err := responsesInputContentToGeminiParts(c, item["content"])
			if err != nil {
				return nil, err
			}
			if role == "system" {
				for _, part := range parts {
					if part.Text != "" {
						systemTexts = append(systemTexts, part.Text)
					}
				}
				continue
			}
			if len(parts) > 0 {
				geminiRequest.Contents = append(geminiRequest.Contents, dto.GeminiChatContent{
					Role:  role,
					Parts: parts,
				})
			}
		}
	}

	if len(systemTexts) > 0 {
		geminiRequest.SystemInstructions = &dto.GeminiChatContent{
			Parts: []dto.GeminiPart{{Text: strings.Join(systemTexts, "\n")}},
		}
	}

	return geminiRequest, nil
}

func applyResponsesTextToGemini(raw []byte, geminiRequest *dto.GeminiChatRequest, jsonSchema bool) error {
	responseFormat, err := RequestTextToChatResponseFormat(raw)
	if err != nil {
		return err
	}
	if responseFormat == nil || (responseFormat.Type != "json_schema" && responseFormat.Type != "json_object") {
		return nil
	}

	geminiRequest.GenerationConfig.ResponseMimeType = "application/json"
	if len(responseFormat.JsonSchema) == 0 {
		return nil
	}

	sharedgemini.ApplyResponseSchema(&geminiRequest.GenerationConfig, responseFormat.JsonSchema, jsonSchema)
	return nil
}

func responsesInputContentToGeminiParts(c *gin.Context, content any) ([]dto.GeminiPart, error) {
	contentParts, err := ContentParts(content)
	if err != nil {
		return nil, err
	}

	parts := make([]dto.GeminiPart, 0, len(contentParts))
	for _, contentPart := range contentParts {
		nextParts, err := responsesContentPartToGeminiParts(c, contentPart)
		if err != nil {
			return nil, err
		}
		parts = append(parts, nextParts...)
	}
	return parts, nil
}

func responsesContentPartToGeminiParts(c *gin.Context, part map[string]any) ([]dto.GeminiPart, error) {
	partType := strings.TrimSpace(common.Interface2String(part["type"]))
	switch partType {
	case "input_text", "output_text", "text":
		text := common.Interface2String(part["text"])
		if text == "" {
			return nil, nil
		}
		return []dto.GeminiPart{{Text: text}}, nil
	case "input_image", "input_file", "input_audio", "input_video":
		source := ContentPartToFileSource(part)
		if source == nil {
			return nil, nil
		}
		base64Data, mimeType, err := relaymedia.ResolveBase64Data(c, source, "formatting Responses input for Gemini")
		if err != nil {
			return nil, fmt.Errorf("get file data from '%s' failed: %w", source.GetIdentifier(), err)
		}
		if !sharedgemini.IsSupportedMimeType(mimeType) {
			return nil, fmt.Errorf("mime type is not supported by Gemini: '%s', url: '%s', supported types are: %v", mimeType, source.GetIdentifier(), sharedgemini.SupportedMimeTypesList())
		}
		return []dto.GeminiPart{
			{
				InlineData: &dto.GeminiInlineData{
					MimeType: mimeType,
					Data:     base64Data,
				},
			},
		}, nil
	default:
		return nil, nil
	}
}

func responsesFunctionCallItemToGeminiPart(item map[string]any) (dto.GeminiPart, string, error) {
	itemType := strings.TrimSpace(common.Interface2String(item["type"]))
	name := strings.TrimSpace(common.Interface2String(item["name"]))
	if name == "" {
		return dto.GeminiPart{}, "", fmt.Errorf("%s item is missing name", itemType)
	}
	var arguments map[string]any
	if itemType == ResponsesInputTypeCustomToolCall {
		// The custom tool is declared as a function taking one string
		// argument, so its raw input is replayed verbatim in that shape.
		arguments = map[string]any{customtool.InputArgument: customtool.InputValue(item["input"])}
	} else {
		arguments = ObjectValue(item["arguments"], "arguments")
	}
	return dto.GeminiPart{
		FunctionCall: &dto.FunctionCall{
			FunctionName: name,
			Arguments:    arguments,
		},
	}, CallID(item), nil
}

// responsesFunctionOutputItemToGeminiPart returns the functionResponse part
// and, unless mediaInParts puts them into functionResponse.parts, the tool
// media the caller sends as separate parts after the turn's function
// responses.
func responsesFunctionOutputItemToGeminiPart(c *gin.Context, item map[string]any, callNames map[string]string, mediaInParts bool) (dto.GeminiPart, []dto.GeminiPart, error) {
	callID := CallID(item)
	name := strings.TrimSpace(common.Interface2String(item["name"]))
	if name == "" {
		name = callNames[callID]
	}
	output, media, err := responsesToolOutputToGemini(c, item["output"], mediaInParts)
	if err != nil {
		return dto.GeminiPart{}, nil, err
	}
	response := &dto.GeminiFunctionResponse{
		Name:     name,
		Response: output,
	}
	if mediaInParts && len(media) > 0 {
		parts, err := common.Marshal(media)
		if err != nil {
			return dto.GeminiPart{}, nil, fmt.Errorf("failed to marshal function response parts: %w", err)
		}
		response.Parts = parts
		media = nil
	}
	return dto.GeminiPart{FunctionResponse: response}, media, nil
}

// responsesToolOutputToGemini maps a function_call_output payload onto a Gemini
// functionResponse. A Responses content-part array keeps its text in response
// and returns its media as inlineData parts; stringifying them instead would
// hand base64 media to the upstream text tokenizer. Multimodal function
// responses (mediaInParts) carry images and documents only; separate parts
// carry every type Gemini accepts. Like the other tool result conversions,
// media that cannot be loaded or carried is rejected. An array holding any
// other part type, and every other payload shape, keeps the historical
// response map.
func responsesToolOutputToGemini(c *gin.Context, value any, mediaInParts bool) (map[string]any, []dto.GeminiPart, error) {
	rawParts, ok := value.([]any)
	if !ok || len(rawParts) == 0 {
		return GeminiResponseMap(value), nil, nil
	}
	parts := make([]map[string]any, 0, len(rawParts))
	for _, rawPart := range rawParts {
		part, isMap := rawPart.(map[string]any)
		if !isMap {
			return GeminiResponseMap(value), nil, nil
		}
		switch strings.TrimSpace(common.Interface2String(part["type"])) {
		case "input_text", "output_text", "text", "input_image", "input_file", "input_audio", "input_video":
		default:
			return GeminiResponseMap(value), nil, nil
		}
		parts = append(parts, part)
	}

	texts := make([]string, 0, len(parts))
	media := make([]dto.GeminiPart, 0, len(parts))
	for _, part := range parts {
		partType := strings.TrimSpace(common.Interface2String(part["type"]))
		switch partType {
		case "input_text", "output_text", "text":
			if text := common.Interface2String(part["text"]); text != "" {
				texts = append(texts, text)
			}
			continue
		}
		kind := strings.TrimPrefix(partType, "input_")
		source := ContentPartToFileSource(part)
		if source == nil {
			return nil, nil, fmt.Errorf("tool output %s has no data or URL", kind)
		}
		// The documented MIME list for multimodal function responses has no
		// audio or video, and Gemini 3 ignores audio sent there.
		if mediaInParts && kind != "image" && kind != "file" {
			return nil, nil, fmt.Errorf("Gemini function responses cannot carry %s content", kind)
		}
		base64Data, mimeType, err := relaymedia.ResolveBase64Data(c, source, "formatting Responses tool output for Gemini")
		if err != nil {
			return nil, nil, fmt.Errorf("the tool output %s could not be loaded: %w", kind, err)
		}
		topLevelType, _, _ := strings.Cut(strings.ToLower(mimeType), "/")
		if !sharedgemini.IsSupportedMimeType(mimeType) || mediaInParts && (topLevelType == "audio" || topLevelType == "video") {
			return nil, nil, fmt.Errorf("Gemini function responses cannot carry %s content", mimeType)
		}
		media = append(media, dto.GeminiPart{InlineData: &dto.GeminiInlineData{MimeType: mimeType, Data: base64Data}})
	}
	if len(texts) == 0 && len(media) > 0 {
		return map[string]any{}, media, nil
	}
	return GeminiResponseMap(strings.Join(texts, "\n")), media, nil
}

func appendGeminiContentPart(req *dto.GeminiChatRequest, role string, part dto.GeminiPart) {
	if len(req.Contents) > 0 && req.Contents[len(req.Contents)-1].Role == role {
		parts := req.Contents[len(req.Contents)-1].Parts
		insertAt := len(parts)
		switch {
		case role == "model" && part.FunctionCall != nil:
			insertAt = 0
			for insertAt < len(parts) && parts[insertAt].FunctionCall != nil {
				insertAt++
			}
		case part.FunctionResponse != nil:
			// Tool media sent as separate parts stay after every function
			// response of the turn, so a later response goes before them.
			for i := len(parts) - 1; i >= 0; i-- {
				if parts[i].FunctionResponse != nil {
					insertAt = i + 1
					break
				}
			}
		}
		req.Contents[len(req.Contents)-1].Parts = slices.Insert(parts, insertAt, part)
		return
	}
	req.Contents = append(req.Contents, dto.GeminiChatContent{
		Role:  role,
		Parts: []dto.GeminiPart{part},
	})
}

func responsesGeminiRole(item map[string]any) string {
	switch strings.TrimSpace(common.Interface2String(item["role"])) {
	case "assistant":
		return "model"
	case "system", "developer":
		return "system"
	case "model":
		return "model"
	default:
		return "user"
	}
}
