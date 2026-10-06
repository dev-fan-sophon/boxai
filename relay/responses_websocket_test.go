package relay

import (
	"testing"

	"github.com/dev-fan-sophon/boxai/common"
	"github.com/dev-fan-sophon/boxai/constant"
	"github.com/dev-fan-sophon/boxai/model"
	"github.com/dev-fan-sophon/boxai/types"

	"github.com/stretchr/testify/assert"
	"github.com/stretchr/testify/require"
)

func TestResponsesWebSocketChannelSupportsOnlyOptedInNativeChannels(t *testing.T) {
	enabled := `{"responses_websocket_enabled":true}`
	nativeRoute := `{"advanced_custom":{"advanced_routes":[{"incoming_path":"/v1/responses","upstream_path":"/v1/responses"}]}}`
	converterRoute := `{"advanced_custom":{"advanced_routes":[{"incoming_path":"/v1/responses","upstream_path":"/v1/chat/completions","converter":"openai_responses_to_openai_chat"}]}}`
	for _, tc := range []struct {
		name          string
		channelType   int
		setting       string
		otherSettings string
		want          bool
	}{
		{name: "openai", channelType: constant.ChannelTypeOpenAI, setting: enabled, want: true},
		{name: "codex", channelType: constant.ChannelTypeCodex, setting: enabled, want: true},
		{name: "codex proxy", channelType: constant.ChannelTypeCodexProxy, setting: enabled, want: true},
		{name: "sub2api", channelType: constant.ChannelTypeSub2API, setting: enabled, want: true},
		{name: "new api", channelType: constant.ChannelTypeNewAPI, setting: enabled, want: true},
		{name: "not opted in", channelType: constant.ChannelTypeOpenAI, setting: `{}`, want: false},
		{name: "azure is not native", channelType: constant.ChannelTypeAzure, setting: enabled, want: false},
		{name: "claude is converted", channelType: constant.ChannelTypeAnthropic, setting: enabled, want: false},
		{name: "advanced custom native route", channelType: constant.ChannelTypeAdvancedCustom, setting: enabled, otherSettings: nativeRoute, want: true},
		{name: "advanced custom converter route", channelType: constant.ChannelTypeAdvancedCustom, setting: enabled, otherSettings: converterRoute, want: false},
		{name: "advanced custom without route", channelType: constant.ChannelTypeAdvancedCustom, setting: enabled, want: false},
	} {
		t.Run(tc.name, func(t *testing.T) {
			channel := &model.Channel{Type: tc.channelType, Setting: common.GetPointer(tc.setting), OtherSettings: tc.otherSettings}
			assert.Equal(t, tc.want, responsesWebSocketChannelSupports(channel, "gpt-5"))
		})
	}
}

func TestNormalizeResponsesWSCreateEventKeepsTransportFieldsOutOfBody(t *testing.T) {
	t.Run("flat event", func(t *testing.T) {
		message := []byte(`{"type":"response.create","event_id":"evt_1","model":"gpt-5","input":"hi","stream":false,"stream_options":{"include_usage":true},"background":true,"stream_id":"s.1","generate":false}`)
		envelope, streamID, err := parseResponsesWSEnvelope(message)
		require.NoError(t, err)
		create, err := normalizeResponsesWSCreateEvent(message, envelope, streamID)
		require.NoError(t, err)
		assert.JSONEq(t, `{"model":"gpt-5","input":"hi"}`, string(create.Body))
		assert.Equal(t, "s.1", create.StreamID)
		assert.JSONEq(t, `false`, string(create.Generate))
	})

	t.Run("wrapped request cannot carry outer envelope fields", func(t *testing.T) {
		message := []byte(`{"type":"response.create","model":"outer-model","response":{"model":"gpt-5","input":"hi","stream_id":"inner","generate":true}}`)
		envelope, streamID, err := parseResponsesWSEnvelope(message)
		require.NoError(t, err)
		create, err := normalizeResponsesWSCreateEvent(message, envelope, streamID)
		require.NoError(t, err)
		assert.JSONEq(t, `{"model":"gpt-5","input":"hi"}`, string(create.Body))
		assert.Equal(t, "inner", create.StreamID)
		assert.JSONEq(t, `true`, string(create.Generate))
	})

	for _, message := range []string{`{"type":"response.create","stream_id":"bad id"}`, `{"type":"response.create","stream_id":""}`, `{"model":"gpt-5"}`, `not json`} {
		_, _, err := parseResponsesWSEnvelope([]byte(message))
		assert.Error(t, err, message)
	}
}

func TestBuildResponsesWSCreateEventUsesEnvelopeStreamIdentity(t *testing.T) {
	event, err := buildResponsesWSCreateEvent([]byte(`{"model":"gpt-5","stream":true,"stream_id":"override","background":true}`), []byte(`false`), "client")
	require.NoError(t, err)
	assert.JSONEq(t, `{"type":"response.create","model":"gpt-5","stream_id":"client","generate":false}`, string(event))
}

func TestResponsesWSErrorEndsRequestCorrelatesControlErrors(t *testing.T) {
	cancel := []byte(`{"type":"response.cancel","event_id":"evt_cancel","response_id":"resp_old"}`)
	notFound := &types.OpenAIError{Type: "invalid_request_error", Code: "response_not_found"}
	for _, tc := range []struct {
		name                                  string
		event                                 responsesWSErrorEvent
		control                               []byte
		wantTerminal, wantAmbiguous, wantCtrl bool
	}{
		{name: "request error ends request", event: responsesWSErrorEvent{Error: &types.OpenAIError{Type: "server_error"}}, wantTerminal: true},
		{name: "other stream is forwarded", event: responsesWSErrorEvent{StreamID: "other"}},
		{name: "other response is forwarded", event: responsesWSErrorEvent{ResponseID: "resp_other"}},
		{name: "control event id resolves control", event: responsesWSErrorEvent{EventID: "evt_cancel"}, control: cancel, wantCtrl: true},
		{name: "control response id resolves control", event: responsesWSErrorEvent{ResponseID: "resp_old"}, control: cancel, wantCtrl: true},
		{name: "control lifecycle error resolves control", event: responsesWSErrorEvent{Error: notFound}, control: cancel, wantCtrl: true},
		{name: "uncorrelated error with pending control is ambiguous", event: responsesWSErrorEvent{Error: &types.OpenAIError{Type: "server_error"}}, control: cancel, wantTerminal: true, wantAmbiguous: true},
	} {
		t.Run(tc.name, func(t *testing.T) {
			terminal, ambiguous, controlError := responsesWSErrorEndsRequest(tc.event, "", "resp_active", tc.control)
			assert.Equal(t, []bool{tc.wantTerminal, tc.wantAmbiguous, tc.wantCtrl}, []bool{terminal, ambiguous, controlError})
		})
	}
}
