package toolresult

import (
	"fmt"
	"net/url"
	"strings"

	"github.com/dev-fan-sophon/boxai/common"
	"github.com/dev-fan-sophon/boxai/dto"
)

// Content preserves tool output blocks, rejecting media that cannot be represented.
func Content(value any, responses bool) ([]dto.ClaudeMediaMessage, error) {
	if value == nil {
		return nil, nil
	}
	if text, ok := value.(string); ok {
		return []dto.ClaudeMediaMessage{{Type: "text", Text: &text}}, nil
	}
	raw, err := common.Marshal(value)
	if err != nil {
		return nil, err
	}
	// Legacy Responses clients send structured JSON results as objects. Keep
	// those as text, but never stringify an object claiming to be a media block.
	if object, ok := value.(map[string]any); responses && ok && object["type"] == nil {
		text := string(raw)
		return []dto.ClaudeMediaMessage{{Type: "text", Text: &text}}, nil
	}
	var blocks []map[string]any
	if err := common.Unmarshal(raw, &blocks); err != nil {
		return nil, fmt.Errorf("tool output must be a string or content block array: %w", err)
	}
	parts := make([]dto.ClaudeMediaMessage, 0, len(blocks))
	for _, block := range blocks {
		kind, _ := block["type"].(string)
		if kind == "text" || responses && (kind == "input_text" || kind == "output_text") {
			text, ok := block["text"].(string)
			if !ok {
				return nil, fmt.Errorf("tool output text must be a string")
			}
			parts = append(parts, dto.ClaudeMediaMessage{Type: "text", Text: &text})
			continue
		}
		var source dto.ClaudeMessageSource
		if responses && kind == "input_image" {
			imageURL, _ := block["image_url"].(string)
			if strings.HasPrefix(imageURL, "data:") {
				header, data, ok := strings.Cut(strings.TrimPrefix(imageURL, "data:"), ",")
				if !ok || !strings.HasSuffix(header, ";base64") || data == "" {
					return nil, fmt.Errorf("invalid tool output image data URL")
				}
				source = dto.ClaudeMessageSource{Type: "base64", MediaType: strings.TrimSuffix(header, ";base64"), Data: data}
			} else {
				source = dto.ClaudeMessageSource{Type: "url", Url: imageURL}
			}
		} else if !responses && kind == "image" {
			encoded, err := common.Marshal(block["source"])
			if err != nil {
				return nil, err
			}
			if err := common.Unmarshal(encoded, &source); err != nil {
				return nil, err
			}
		} else {
			return nil, fmt.Errorf("unsupported tool output content type %q", kind)
		}
		switch source.Type {
		case "base64":
			data, ok := source.Data.(string)
			if !ok || data == "" || (source.MediaType != "image/png" && source.MediaType != "image/jpeg" && source.MediaType != "image/gif" && source.MediaType != "image/webp") {
				return nil, fmt.Errorf("unsupported tool output image media type %q or empty data", source.MediaType)
			}
		case "url":
			u, err := url.Parse(source.Url)
			if err != nil || u.Host == "" || (u.Scheme != "http" && u.Scheme != "https") {
				return nil, fmt.Errorf("tool output image requires an HTTP(S) URL")
			}
		default:
			return nil, fmt.Errorf("unsupported tool output image source %q", source.Type)
		}
		parts = append(parts, dto.ClaudeMediaMessage{Type: "image", Source: &source})
	}
	return parts, nil
}

// PromoteChat keeps parallel tool replies adjacent before emitting their images.
// Labels associate each image group with its original call; block order is retained.
func PromoteChat(messages []dto.Message) []dto.Message {
	out := make([]dto.Message, 0, len(messages))
	var pending []dto.MediaContent
	for _, message := range messages {
		if message.Role != "tool" && len(pending) > 0 {
			promoted := dto.Message{Role: "user"}
			promoted.SetMediaContent(pending)
			out = append(out, promoted)
			pending = nil
		}
		parts, ok := message.Content.([]dto.ClaudeMediaMessage)
		if message.Role == "tool" && ok {
			var text strings.Builder
			var media []dto.MediaContent
			hasImage := false
			for _, part := range parts {
				if part.Type == "text" {
					text.WriteString(part.GetText())
					media = append(media, dto.MediaContent{Type: "text", Text: part.GetText()})
				} else {
					hasImage = true
					imageURL := part.Source.Url
					if part.Source.Type == "base64" {
						imageURL = "data:" + part.Source.MediaType + ";base64," + part.Source.Data.(string)
					}
					media = append(media, dto.MediaContent{Type: "image_url", ImageUrl: &dto.MessageImageUrl{Url: imageURL}})
				}
			}
			message.Content = text.String()
			if hasImage {
				pending = append(pending, dto.MediaContent{Type: "text", Text: "Tool result " + message.ToolCallId + ":"})
				pending = append(pending, media...)
			}
		}
		out = append(out, message)
	}
	if len(pending) > 0 {
		promoted := dto.Message{Role: "user"}
		promoted.SetMediaContent(pending)
		out = append(out, promoted)
	}
	return out
}
