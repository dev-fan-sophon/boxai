package codexproxy

import (
	"bytes"
	"encoding/json"
	"errors"
	"io"
	"net/http"
	"strings"

	"github.com/dev-fan-sophon/boxai/common"
	"github.com/dev-fan-sophon/boxai/dto"
	"github.com/dev-fan-sophon/boxai/relay/channel/openai"
	relaycommon "github.com/dev-fan-sophon/boxai/relay/common"
	"github.com/dev-fan-sophon/boxai/relay/helper"
	"github.com/dev-fan-sophon/boxai/service"
	"github.com/dev-fan-sophon/boxai/types"

	"github.com/gin-gonic/gin"
	"github.com/tidwall/gjson"
	"github.com/tidwall/sjson"
)

func responseIsEventStream(resp *http.Response) bool {
	return resp != nil && strings.HasPrefix(strings.ToLower(strings.TrimSpace(resp.Header.Get("Content-Type"))), "text/event-stream")
}

// responsesSSEToJSONHandler absorbs forced upstream SSE when the caller
// requested a normal Responses JSON result. The terminal response remains
// authoritative; output_item.done fills output only when terminal output is empty.
func responsesSSEToJSONHandler(c *gin.Context, info *relaycommon.RelayInfo, resp *http.Response) (*dto.Usage, *types.NewAPIError) {
	if resp == nil || resp.Body == nil {
		return nil, types.NewOpenAIError(errors.New("invalid Codex Proxy Responses stream"), types.ErrorCodeBadResponse, http.StatusBadGateway)
	}
	defer service.CloseResponseBodyGracefully(resp)

	var finalResponse []byte
	outputItems := make([]json.RawMessage, 0)
	scanner := helper.NewStreamScanner(resp.Body)
	for scanner.Scan() {
		line := bytes.TrimSpace(scanner.Bytes())
		if !bytes.HasPrefix(line, []byte("data:")) {
			continue
		}
		data := bytes.TrimSpace(bytes.TrimPrefix(line, []byte("data:")))
		if len(data) == 0 || bytes.Equal(data, []byte("[DONE]")) {
			continue
		}

		eventType := gjson.GetBytes(data, "type").String()
		if eventType == dto.ResponsesOutputTypeItemDone {
			if item := gjson.GetBytes(data, "item"); item.IsObject() {
				outputItems = append(outputItems, append(json.RawMessage(nil), item.Raw...))
			}
			continue
		}
		switch eventType {
		case "response.completed", "response.done", "response.incomplete":
			response := gjson.GetBytes(data, "response")
			if !response.IsObject() {
				return nil, types.NewOpenAIError(errors.New("Codex Proxy Responses stream ended without a response object"), types.ErrorCodeBadResponseBody, http.StatusBadGateway)
			}
			finalResponse = append(finalResponse[:0], response.Raw...)
		case "response.failed", "response.error":
			message := strings.TrimSpace(gjson.GetBytes(data, "response.error.message").String())
			if message == "" {
				message = strings.TrimSpace(gjson.GetBytes(data, "error.message").String())
			}
			if message == "" {
				message = "Codex Proxy Responses stream failed"
			}
			return nil, types.NewOpenAIError(errors.New(message), types.ErrorCodeBadResponse, http.StatusBadGateway)
		}
	}
	if err := scanner.Err(); err != nil {
		return nil, types.NewOpenAIError(err, types.ErrorCodeReadResponseBodyFailed, http.StatusBadGateway)
	}
	if len(finalResponse) == 0 {
		return nil, types.NewOpenAIError(errors.New("Codex Proxy Responses stream ended without a terminal response"), types.ErrorCodeBadResponseBody, http.StatusBadGateway)
	}

	output := gjson.GetBytes(finalResponse, "output")
	if (!output.IsArray() || len(output.Array()) == 0) && len(outputItems) > 0 {
		encodedOutput, err := common.Marshal(outputItems)
		if err != nil {
			return nil, types.NewOpenAIError(err, types.ErrorCodeJsonMarshalFailed, http.StatusInternalServerError)
		}
		finalResponse, err = sjson.SetRawBytes(finalResponse, "output", encodedOutput)
		if err != nil {
			return nil, types.NewOpenAIError(err, types.ErrorCodeBadResponseBody, http.StatusBadGateway)
		}
	}

	jsonResponse := *resp
	jsonResponse.Header = resp.Header.Clone()
	jsonResponse.Header.Set("Content-Type", "application/json")
	jsonResponse.Header.Del("Content-Encoding")
	jsonResponse.Header.Del("Content-Length")
	jsonResponse.Header.Del("Transfer-Encoding")
	jsonResponse.ContentLength = int64(len(finalResponse))
	jsonResponse.TransferEncoding = nil
	jsonResponse.Body = io.NopCloser(bytes.NewReader(finalResponse))
	return openai.OaiResponsesHandler(c, info, &jsonResponse)
}
