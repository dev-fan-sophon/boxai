package service

import (
	"bytes"
	"context"
	"fmt"
	"io"
	"net/http"
	"strings"
	"testing"

	"github.com/dev-fan-sophon/boxai/common"
	relaycommon "github.com/dev-fan-sophon/boxai/relay/common"
	"github.com/dev-fan-sophon/boxai/types"
	"github.com/gin-gonic/gin"
	"github.com/stretchr/testify/assert"
	"github.com/stretchr/testify/require"
)

func TestNormalizeRelayFaultPreservesOnlyLocalParamRejections(t *testing.T) {
	local := relaycommon.NewAPIErrorFromParamOverride(&relaycommon.ParamOverrideReturnError{
		Message: "JSON mode is unavailable for this model", StatusCode: 400,
		Code: "unsupported_response_format", Type: "invalid_request_error", SkipRetry: true,
	})
	require.NotNil(t, local)
	want := local.ToOpenAIError()
	NormalizeRelayServiceFault(local)
	assert.Equal(t, 400, local.StatusCode)
	assert.Equal(t, want, local.ToOpenAIError())
	assert.True(t, types.IsSkipRetryError(local))

	// An upstream cannot bypass sanitization by returning the same public code.
	upstream := types.WithOpenAIError(want, 400)
	NormalizeRelayServiceFault(upstream)
	assert.Equal(t, 400, upstream.StatusCode)
	assert.Equal(t, types.ErrorCode("invalid_request_error"), upstream.PublicCode())
	assert.NotEqual(t, want.Message, upstream.ToOpenAIError().Message)
}

func TestRelayFaultClassificationPreservesRoutingAndPrivacy(t *testing.T) {
	for _, tc := range []struct {
		name, body, code     string
		status, publicStatus int
		skip                 bool
	}{
		{"moderated image", `{"code":"imagine:content-moderated","error":"private moderation details"}`, "content_policy_violation", 400, 400, true},
		{"bad schema", `{"error":{"code":"invalid_json_schema","message":"private schema details"}}`, "invalid_request_error", 400, 400, true},
		{"body limit reported as 400", `{"error":"Failed to read request body: length limit exceeded; private details"}`, "request_too_large", 400, 413, true},
		{"private metadata", `{"error":{"message":"private details","param":"private parameter","metadata":{"account":"private account"}}}`, "invalid_request_error", 400, 400, true},
		{"unsupported parameter", `{"error":{"code":"unknown_parameter","message":"private parameter details"}}`, "invalid_request_error", 422, 422, true},
		{"oversized body", `{"error":"private body details"}`, "request_too_large", 413, 413, true},
		{"exhausted supplier", `{"error":{"code":"401008","message":"private account details"}}`, "model_temporarily_unavailable", 402, 503, false},
		{"rate limited", `{"error":"private quota details"}`, "model_temporarily_busy", 429, 429, false},
		{"bad credential", `{"error":"private token details"}`, "service_unavailable", 401, 502, false},
		{"gateway timeout", `{"code":504,"error":"private network details"}`, "service_unavailable", 504, 502, false},
	} {
		t.Run(tc.name, func(t *testing.T) {
			fault := RelayErrorHandler(context.Background(), &http.Response{StatusCode: tc.status, Body: io.NopCloser(strings.NewReader(tc.body))}, false)
			require.NotNil(t, fault)
			NormalizeRelayServiceFault(fault)
			NormalizeRelayServiceFault(fault) // Idempotent; never overwrite the original diagnostic.
			assert.Equal(t, tc.status, fault.OriginalStatusCode())
			assert.Equal(t, tc.publicStatus, fault.StatusCode)
			assert.Equal(t, tc.code, string(fault.PublicCode()))
			assert.Equal(t, tc.skip, types.IsSkipRetryError(fault))
			assert.Equal(t, tc.status, fault.Diagnostic()["status_code"])
			assert.Contains(t, fault.Diagnostic()["message"], "private")
			assert.NotContains(t, fault.ToOpenAIError().Message, "private")
			assert.Empty(t, fault.ToOpenAIError().Param)
			assert.Empty(t, fault.ToOpenAIError().Metadata)
			assert.NotContains(t, fault.ToClaudeError().Message, "private")
		})
	}
}

func TestResetStatusCode(t *testing.T) {
	t.Parallel()

	testCases := []struct {
		name             string
		statusCode       int
		statusCodeConfig string
		expectedCode     int
	}{
		{
			name:             "map string value",
			statusCode:       429,
			statusCodeConfig: `{"429":"503"}`,
			expectedCode:     503,
		},
		{
			name:             "map int value",
			statusCode:       429,
			statusCodeConfig: `{"429":503}`,
			expectedCode:     503,
		},
		{
			name:             "skip invalid string value",
			statusCode:       429,
			statusCodeConfig: `{"429":"bad-code"}`,
			expectedCode:     429,
		},
		{
			name:             "skip status code 200",
			statusCode:       200,
			statusCodeConfig: `{"200":503}`,
			expectedCode:     200,
		},
	}

	for _, tc := range testCases {
		tc := tc
		t.Run(tc.name, func(t *testing.T) {
			t.Parallel()

			newAPIError := &types.NewAPIError{
				StatusCode: tc.statusCode,
			}
			ResetStatusCode(newAPIError, tc.statusCodeConfig)
			require.Equal(t, tc.expectedCode, newAPIError.StatusCode)
		})
	}
}

func TestRelayErrorHandlerTruncatesInvalidJSONBodyInLog(t *testing.T) {
	withDebugEnabled(t, false)

	body := strings.Repeat("b", common.LocalLogContentLimit+256)
	var logBuffer bytes.Buffer

	common.LogWriterMu.Lock()
	oldWriter := gin.DefaultErrorWriter
	gin.DefaultErrorWriter = &logBuffer
	common.LogWriterMu.Unlock()
	t.Cleanup(func() {
		common.LogWriterMu.Lock()
		gin.DefaultErrorWriter = oldWriter
		common.LogWriterMu.Unlock()
	})

	resp := &http.Response{
		StatusCode: http.StatusInternalServerError,
		Body:       io.NopCloser(strings.NewReader(body)),
	}

	newAPIError := RelayErrorHandler(context.Background(), resp, false)

	require.NotNil(t, newAPIError)
	require.Equal(t, "bad response status code 500", newAPIError.Error())
	require.Contains(t, logBuffer.String(), "[truncated")
	require.Contains(t, logBuffer.String(), fmt.Sprintf("original_length=%d", len(body)))
	require.NotContains(t, logBuffer.String(), strings.Repeat("b", common.LocalLogContentLimit+1))
}

func TestRelayErrorHandlerKeepsStructuredErrorMessage(t *testing.T) {
	message := strings.Repeat("c", common.LocalLogContentLimit+256)
	body := `{"message":"` + message + `"}`
	resp := &http.Response{
		StatusCode: http.StatusInternalServerError,
		Body:       io.NopCloser(strings.NewReader(body)),
	}

	newAPIError := RelayErrorHandler(context.Background(), resp, false)

	require.NotNil(t, newAPIError)
	require.Equal(t, message, newAPIError.Error())
}

func TestRelayErrorHandlerKeepsOpenAIErrorMessage(t *testing.T) {
	message := strings.Repeat("d", common.LocalLogContentLimit+256)
	body := `{"error":{"message":"` + message + `","type":"server_error","code":"server_error"}}`
	resp := &http.Response{
		StatusCode: http.StatusInternalServerError,
		Body:       io.NopCloser(strings.NewReader(body)),
	}

	newAPIError := RelayErrorHandler(context.Background(), resp, false)

	require.NotNil(t, newAPIError)
	require.Equal(t, message, newAPIError.Error())
}

func TestRelayErrorHandlerLogsPreviewForEmptyStructuredMessage(t *testing.T) {
	withDebugEnabled(t, false)

	padding := strings.Repeat("x", common.LocalLogContentLimit+256)
	body := `{"error":{"message":""},"padding":"` + padding + `"}`
	var logBuffer bytes.Buffer

	common.LogWriterMu.Lock()
	oldWriter := gin.DefaultErrorWriter
	gin.DefaultErrorWriter = &logBuffer
	common.LogWriterMu.Unlock()
	t.Cleanup(func() {
		common.LogWriterMu.Lock()
		gin.DefaultErrorWriter = oldWriter
		common.LogWriterMu.Unlock()
	})

	resp := &http.Response{
		StatusCode: http.StatusBadGateway,
		Body:       io.NopCloser(strings.NewReader(body)),
	}
	newAPIError := RelayErrorHandler(context.Background(), resp, false)

	require.NotNil(t, newAPIError)
	require.Empty(t, newAPIError.Error())
	require.Contains(t, logBuffer.String(), "empty error message")
	require.Contains(t, logBuffer.String(), "[truncated")
	require.NotContains(t, logBuffer.String(), padding)
}

func TestRelayErrorHandlerDoesNotLogBodyForStructuredMessage(t *testing.T) {
	var logBuffer bytes.Buffer
	common.LogWriterMu.Lock()
	oldWriter := gin.DefaultErrorWriter
	gin.DefaultErrorWriter = &logBuffer
	common.LogWriterMu.Unlock()
	t.Cleanup(func() {
		common.LogWriterMu.Lock()
		gin.DefaultErrorWriter = oldWriter
		common.LogWriterMu.Unlock()
	})

	body := `{"error":{"message":"upstream unavailable"}}`
	resp := &http.Response{
		StatusCode: http.StatusBadGateway,
		Body:       io.NopCloser(strings.NewReader(body)),
	}
	newAPIError := RelayErrorHandler(context.Background(), resp, false)

	require.NotNil(t, newAPIError)
	require.Equal(t, "upstream unavailable", newAPIError.Error())
	require.Empty(t, logBuffer.String())
}

func TestRelayErrorHandlerKeepsInvalidJSONBodyInDebugLog(t *testing.T) {
	withDebugEnabled(t, true)

	body := strings.Repeat("e", common.LocalLogContentLimit+256)
	var logBuffer bytes.Buffer

	common.LogWriterMu.Lock()
	oldWriter := gin.DefaultErrorWriter
	gin.DefaultErrorWriter = &logBuffer
	common.LogWriterMu.Unlock()
	t.Cleanup(func() {
		common.LogWriterMu.Lock()
		gin.DefaultErrorWriter = oldWriter
		common.LogWriterMu.Unlock()
	})

	resp := &http.Response{
		StatusCode: http.StatusInternalServerError,
		Body:       io.NopCloser(strings.NewReader(body)),
	}

	newAPIError := RelayErrorHandler(context.Background(), resp, false)

	require.NotNil(t, newAPIError)
	require.NotContains(t, logBuffer.String(), "[truncated")
	require.Contains(t, logBuffer.String(), body)
}

func withDebugEnabled(t *testing.T, enabled bool) {
	t.Helper()

	oldDebug := common.DebugEnabled
	common.DebugEnabled = enabled
	t.Cleanup(func() {
		common.DebugEnabled = oldDebug
	})
}
