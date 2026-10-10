package service

import (
	"context"
	"encoding/json"
	"fmt"
	"io"
	"math"
	"net/http"
	"strconv"
	"strings"

	"github.com/dev-fan-sophon/boxai/common"
	"github.com/dev-fan-sophon/boxai/dto"
	"github.com/dev-fan-sophon/boxai/logger"
	relaycommon "github.com/dev-fan-sophon/boxai/relay/common"
	"github.com/dev-fan-sophon/boxai/types"
)

func MidjourneyErrorWrapper(code int, desc string) *dto.MidjourneyResponse {
	return &dto.MidjourneyResponse{
		Code:        code,
		Description: desc,
	}
}

func MidjourneyErrorWithStatusCodeWrapper(code int, desc string, statusCode int) *dto.MidjourneyResponseWithStatusCode {
	return &dto.MidjourneyResponseWithStatusCode{
		StatusCode: statusCode,
		Response:   *MidjourneyErrorWrapper(code, desc),
	}
}

//// OpenAIErrorWrapper wraps an error into an OpenAIErrorWithStatusCode
//func OpenAIErrorWrapper(err error, code string, statusCode int) *dto.OpenAIErrorWithStatusCode {
//	text := err.Error()
//	lowerText := strings.ToLower(text)
//	if !strings.HasPrefix(lowerText, "get file base64 from url") && !strings.HasPrefix(lowerText, "mime type is not supported") {
//		if strings.Contains(lowerText, "post") || strings.Contains(lowerText, "dial") || strings.Contains(lowerText, "http") {
//			common.SysLog(fmt.Sprintf("error: %s", text))
//			text = "请求上游地址失败"
//		}
//	}
//	openAIError := dto.OpenAIError{
//		Message: text,
//		Type:    "new_api_error",
//		Code:    code,
//	}
//	return &dto.OpenAIErrorWithStatusCode{
//		Error:      openAIError,
//		StatusCode: statusCode,
//	}
//}
//
//func OpenAIErrorWrapperLocal(err error, code string, statusCode int) *dto.OpenAIErrorWithStatusCode {
//	openaiErr := OpenAIErrorWrapper(err, code, statusCode)
//	openaiErr.LocalError = true
//	return openaiErr
//}

func ClaudeErrorWrapper(err error, code string, statusCode int) *dto.ClaudeErrorWithStatusCode {
	text := err.Error()
	lowerText := strings.ToLower(text)
	if !strings.HasPrefix(lowerText, "get file base64 from url") {
		if strings.Contains(lowerText, "post") || strings.Contains(lowerText, "dial") || strings.Contains(lowerText, "http") {
			common.SysLog(fmt.Sprintf("error: %s", text))
			text = "请求上游地址失败"
		}
	}
	claudeError := types.ClaudeError{
		Message: text,
		Type:    "new_api_error",
	}
	return &dto.ClaudeErrorWithStatusCode{
		Error:      claudeError,
		StatusCode: statusCode,
	}
}

func ClaudeErrorWrapperLocal(err error, code string, statusCode int) *dto.ClaudeErrorWithStatusCode {
	claudeErr := ClaudeErrorWrapper(err, code, statusCode)
	claudeErr.LocalError = true
	return claudeErr
}

func RelayErrorHandler(ctx context.Context, resp *http.Response, showBodyWhenFail bool) (newApiErr *types.NewAPIError) {
	newApiErr = types.InitOpenAIError(types.ErrorCodeBadResponseStatusCode, resp.StatusCode)
	defer CloseResponseBodyGracefully(resp)

	responseBody, err := io.ReadAll(resp.Body)
	if err != nil {
		return
	}
	var errResponse dto.GeneralErrorResponse
	responseBodyText := string(responseBody)
	responseBodyPreview := common.LocalLogPreview(responseBodyText)
	buildErrWithBody := func(message string) error {
		if message == "" {
			return fmt.Errorf("bad response status code %d, body: %s", resp.StatusCode, responseBodyText)
		}
		return fmt.Errorf("bad response status code %d, message: %s, body: %s", resp.StatusCode, message, responseBodyText)
	}

	err = common.Unmarshal(responseBody, &errResponse)
	if err != nil {
		if showBodyWhenFail {
			newApiErr.Err = buildErrWithBody("")
		} else {
			logger.LogError(ctx, fmt.Sprintf("bad response status code %d, body: %s", resp.StatusCode, responseBodyPreview))
			newApiErr.Err = fmt.Errorf("bad response status code %d", resp.StatusCode)
		}
		return
	}

	if common.GetJsonType(errResponse.Error) == "object" {
		// General format error (OpenAI, Anthropic, Gemini, etc.)
		oaiError := errResponse.TryToOpenAIError()
		if oaiError != nil {
			newApiErr = types.WithOpenAIError(*oaiError, resp.StatusCode)
			if showBodyWhenFail {
				newApiErr.Err = buildErrWithBody(newApiErr.Error())
			}
			return
		}
	}
	message := errResponse.ToMessage()
	if message == "" {
		logger.LogError(ctx, fmt.Sprintf("bad response status code %d with empty error message, body: %s", resp.StatusCode, responseBodyPreview))
	}
	code := any(types.ErrorCodeBadResponseStatusCode)
	if errResponse.Code != nil {
		code = errResponse.Code
	}
	newApiErr = types.WithOpenAIError(types.OpenAIError{Message: message, Code: code}, resp.StatusCode)
	if showBodyWhenFail {
		newApiErr.Err = buildErrWithBody(newApiErr.Error())
	}
	return
}

func ResetStatusCode(newApiErr *types.NewAPIError, statusCodeMappingStr string) {
	if newApiErr == nil {
		return
	}
	if statusCodeMappingStr == "" || statusCodeMappingStr == "{}" {
		return
	}
	statusCodeMapping := make(map[string]any)
	err := common.Unmarshal([]byte(statusCodeMappingStr), &statusCodeMapping)
	if err != nil {
		return
	}
	if newApiErr.StatusCode == http.StatusOK {
		return
	}
	codeStr := strconv.Itoa(newApiErr.StatusCode)
	if value, ok := statusCodeMapping[codeStr]; ok {
		intCode, ok := parseStatusCodeMappingValue(value)
		if !ok {
			return
		}
		newApiErr.StatusCode = intCode
	}
}

// NormalizeRelayServiceFault replaces non-local relay failures with stable
// BoxAI-facing errors. Original details stay attached for administrator-only
// diagnostics and must never be returned to a user.
func NormalizeRelayServiceFault(err *types.NewAPIError) {
	if err == nil || err.Diagnostic() != nil {
		return
	}
	if err.GetErrorType() != types.ErrorTypeOpenAIError && err.GetErrorType() != types.ErrorTypeClaudeError && err.GetErrorCode() != types.ErrorCodeDoRequestFailed {
		return
	}
	if _, local := relaycommon.AsParamOverrideReturnError(err); local {
		return
	}
	diagnostic := map[string]any{
		"status_code": err.StatusCode,
		"error_code":  err.GetErrorCode(),
		"message":     common.MaskSensitiveInfo(err.Error()),
	}
	err.SetDiagnostic(diagnostic)

	message := strings.ToLower(err.Error())
	if err.GetErrorCode() == "imagine:content-moderated" || err.GetErrorCode() == "content_policy_violation" ||
		err.GetErrorCode() == types.ErrorCodePromptBlocked || IsViolationFeeCode(err.GetErrorCode()) ||
		((err.StatusCode == 400 || err.StatusCode == 403) && (strings.Contains(message, "content moderation") || strings.Contains(message, "moderation policy"))) {
		types.ErrOptionWithSkipRetry()(err)
		err.SetPublicFault("content_policy_violation", "This request was rejected by the content safety policy. Please revise the content.", http.StatusBadRequest)
		return
	}
	if err.GetErrorCode() == "401008" || err.StatusCode == http.StatusPaymentRequired {
		err.SetPublicFault("model_temporarily_unavailable", "The selected model is temporarily unavailable. Please try again later.", http.StatusServiceUnavailable)
		return
	}
	if err.StatusCode == http.StatusRequestEntityTooLarge ||
		(err.StatusCode == http.StatusBadRequest && strings.Contains(message, "failed to read request body: length limit exceeded")) {
		types.ErrOptionWithSkipRetry()(err)
		err.SetPublicFault("request_too_large", "The request exceeds the supported size limit. Please reduce its size.", http.StatusRequestEntityTooLarge)
		return
	}
	switch err.StatusCode {
	case http.StatusBadRequest, http.StatusUnprocessableEntity:
		types.ErrOptionWithSkipRetry()(err)
		err.SetPublicFault("invalid_request_error", "The request contains invalid or unsupported parameters. Please check the request format and model capabilities.", err.StatusCode)
		return
	}
	if err.StatusCode == http.StatusTooManyRequests {
		err.SetPublicFault("model_temporarily_busy", "This model is temporarily busy. Please retry shortly.", http.StatusTooManyRequests)
		return
	}
	err.SetPublicFault("service_unavailable", "BoxAI could not complete this request. Please try again later.", http.StatusBadGateway)
}

func parseStatusCodeMappingValue(value any) (int, bool) {
	switch v := value.(type) {
	case string:
		if v == "" {
			return 0, false
		}
		statusCode, err := strconv.Atoi(v)
		if err != nil {
			return 0, false
		}
		return statusCode, true
	case float64:
		if v != math.Trunc(v) {
			return 0, false
		}
		return int(v), true
	case int:
		return v, true
	case json.Number:
		statusCode, err := strconv.Atoi(v.String())
		if err != nil {
			return 0, false
		}
		return statusCode, true
	default:
		return 0, false
	}
}

func TaskErrorWrapperLocal(err error, code string, statusCode int) *dto.TaskError {
	openaiErr := TaskErrorWrapper(err, code, statusCode)
	openaiErr.LocalError = true
	return openaiErr
}

func TaskErrorWrapper(err error, code string, statusCode int) *dto.TaskError {
	text := err.Error()
	lowerText := strings.ToLower(text)
	if strings.Contains(lowerText, "post") || strings.Contains(lowerText, "dial") || strings.Contains(lowerText, "http") {
		common.SysLog(fmt.Sprintf("error: %s", text))
		//text = "请求上游地址失败"
		text = common.MaskSensitiveInfo(text)
	}
	//避免暴露内部错误
	taskError := &dto.TaskError{
		Code:       code,
		Message:    text,
		StatusCode: statusCode,
		Error:      err,
	}

	return taskError
}

// TaskErrorFromAPIError 将 PreConsumeBilling 返回的 NewAPIError 转换为 TaskError。
func TaskErrorFromAPIError(apiErr *types.NewAPIError) *dto.TaskError {
	if apiErr == nil {
		return nil
	}
	// Keep upstream origin and original status if this adapter is reused outside
	// billing. Task response normalization and channel diagnostics own sanitization.
	if apiErr.GetErrorType() != types.ErrorTypeNewAPIError || apiErr.GetErrorCode() == types.ErrorCodeDoRequestFailed {
		return &dto.TaskError{
			Code: string(apiErr.GetErrorCode()), Message: apiErr.Error(),
			StatusCode: apiErr.OriginalStatusCode(), Error: apiErr.Err,
		}
	}
	message := apiErr.PublicMessage()
	if apiErr.StatusCode >= http.StatusInternalServerError {
		message = "BoxAI could not process billing. Please try again later."
	}
	return &dto.TaskError{
		Code:       string(apiErr.PublicCode()),
		Message:    message,
		StatusCode: apiErr.StatusCode,
		Error:      apiErr.Err,
		LocalError: true,
	}
}
