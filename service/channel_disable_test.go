package service

import (
	"errors"
	"net/http"
	"testing"

	"github.com/dev-fan-sophon/boxai/common"
	"github.com/dev-fan-sophon/boxai/types"
	"github.com/stretchr/testify/assert"
)

// Automatic disabling only reacts to failures that say something about the
// channel. Errors BoxAI raised itself before or without an upstream answer
// never disable it, even when their text matches a disable keyword or their
// status is a disabling one, while upstream failures and channel errors do.
func TestShouldDisableChannelIgnoresLocalErrors(t *testing.T) {
	previousAutoDisable := common.AutomaticDisableChannelEnabled
	common.AutomaticDisableChannelEnabled = true
	t.Cleanup(func() { common.AutomaticDisableChannelEnabled = previousAutoDisable })
	upstreamKeyErr := types.WithOpenAIError(types.OpenAIError{Message: "Incorrect API key provided", Type: "invalid_request_error", Code: "invalid_api_key"}, http.StatusUnauthorized)
	for _, tc := range []struct {
		name        string
		err         *types.NewAPIError
		wantDisable bool
	}{
		{name: "upstream invalid key", err: upstreamKeyErr, wantDisable: true},
		{name: "upstream keyword in an adaptor-parsed body", err: types.NewError(errors.New("Your credit balance is too low"), types.ErrorCodeBadResponseBody), wantDisable: true},
		{name: "upstream 401 status reported by an adaptor", err: types.NewErrorWithStatusCode(errors.New("unauthorized"), types.ErrorCodeBadResponseStatusCode, http.StatusUnauthorized), wantDisable: true},
		{name: "channel key error", err: types.NewError(errors.New("invalid auth"), types.ErrorCodeChannelInvalidKey), wantDisable: true},
		{name: "local 401 from request conversion", err: types.NewErrorWithStatusCode(errors.New("bad image"), types.ErrorCodeConvertRequestFailed, http.StatusUnauthorized), wantDisable: false},
		{name: "local error echoing a disable keyword from client input", err: types.NewError(errors.New("fetch https://x.invalid/Your credit balance is too low failed"), types.ErrorCodeConvertRequestFailed), wantDisable: false},
		{name: "request body read failure with a keyword", err: types.NewErrorWithStatusCode(errors.New("You exceeded your current quota"), types.ErrorCodeReadRequestBodyFailed, http.StatusUnauthorized), wantDisable: false},
		{name: "local wrapper around an upstream key error", err: types.NewErrorWithStatusCode(upstreamKeyErr, types.ErrorCodeInvalidRequest, http.StatusUnauthorized), wantDisable: true},
	} {
		t.Run(tc.name, func(t *testing.T) {
			assert.Equal(t, tc.wantDisable, ShouldDisableChannel(tc.err))
		})
	}
}
