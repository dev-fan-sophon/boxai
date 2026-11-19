package relay

import (
	"context"
	"net/http"
	"net/http/httptest"
	"strings"
	"testing"
	"time"

	"github.com/dev-fan-sophon/boxai/common"
	"github.com/dev-fan-sophon/boxai/constant"
	"github.com/dev-fan-sophon/boxai/dto"
	"github.com/dev-fan-sophon/boxai/model"
	relaychannel "github.com/dev-fan-sophon/boxai/relay/channel"
	relaycommon "github.com/dev-fan-sophon/boxai/relay/common"
	relayconstant "github.com/dev-fan-sophon/boxai/relay/constant"
	"github.com/dev-fan-sophon/boxai/types"

	"github.com/gin-gonic/gin"
	"github.com/gorilla/websocket"
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
		{name: "azure", channelType: constant.ChannelTypeAzure, setting: enabled, want: true},
		{name: "azure not opted in", channelType: constant.ChannelTypeAzure, setting: `{}`, want: false},
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

func TestResponsesWSAzureDialUsesAzureResponsesURLAndAPIKey(t *testing.T) {
	for _, tc := range []struct {
		name           string
		host           string
		responsesVer   string
		channelAPIVer  string
		wantPath       string
		wantAPIVersion string
	}{
		{name: "openai v1 default preview", wantPath: "/openai/v1/responses", wantAPIVersion: "preview"},
		{name: "channel responses version", responsesVer: "2025-04-01-preview", wantPath: "/openai/v1/responses", wantAPIVersion: "2025-04-01-preview"},
		{name: "cognitiveservices uses channel api version", host: "cognitiveservices.azure.com", channelAPIVer: "2025-03-01-preview", wantPath: "/openai/responses", wantAPIVersion: "2025-03-01-preview"},
	} {
		t.Run(tc.name, func(t *testing.T) {
			handshake := make(chan *http.Request, 1)
			upgrader := websocket.Upgrader{}
			server := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
				handshake <- r
				conn, err := upgrader.Upgrade(w, r, nil)
				if err != nil {
					return
				}
				_ = conn.Close()
			}))
			defer server.Close()

			// The host check only inspects the base URL text, so a path segment
			// is enough to select the cognitiveservices URL form.
			baseURL := server.URL
			if tc.host != "" {
				baseURL += "/" + tc.host
			}
			c, _ := gin.CreateTestContext(httptest.NewRecorder())
			c.Request = httptest.NewRequest(http.MethodGet, "/v1/responses", nil)
			info := &relaycommon.RelayInfo{
				RelayMode:      relayconstant.RelayModeResponses,
				RequestURLPath: "/v1/responses",
				ChannelMeta: &relaycommon.ChannelMeta{
					ChannelType:          constant.ChannelTypeAzure,
					ChannelBaseUrl:       baseURL,
					ApiType:              constant.APITypeOpenAI,
					ApiVersion:           tc.channelAPIVer,
					ApiKey:               "azure-key",
					UpstreamModelName:    "gpt-test",
					ChannelOtherSettings: dto.ChannelOtherSettings{AzureResponsesVersion: tc.responsesVer},
				},
			}
			adaptor := GetAdaptor(info.ApiType)
			adaptor.Init(info)
			target, err := relaychannel.DoWssRequest(adaptor, c, info, nil)
			require.NoError(t, err)
			_ = target.Close()

			r := <-handshake
			assert.Equal(t, strings.TrimPrefix(baseURL, server.URL)+tc.wantPath, r.URL.Path)
			assert.Equal(t, tc.wantAPIVersion, r.URL.Query().Get("api-version"))
			assert.Equal(t, "azure-key", r.Header.Get("api-key"))
			assert.Empty(t, r.Header.Get("Authorization"))
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

func newTestWebSocketPair(t *testing.T) (*websocket.Conn, *websocket.Conn, func()) {
	t.Helper()
	upgrader := websocket.Upgrader{}
	serverConnCh := make(chan *websocket.Conn, 1)
	server := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		conn, err := upgrader.Upgrade(w, r, nil)
		if err != nil {
			t.Errorf("upgrade websocket: %v", err)
			return
		}
		serverConnCh <- conn
	}))
	dialed, _, err := websocket.DefaultDialer.Dial("ws"+strings.TrimPrefix(server.URL, "http"), nil)
	if err != nil {
		server.Close()
		t.Fatalf("dial websocket: %v", err)
	}
	accepted := <-serverConnCh
	cleanup := func() {
		_ = dialed.Close()
		_ = accepted.Close()
		server.Close()
	}
	return dialed, accepted, cleanup
}

// readResponsesWSClose reads until the peer's close frame. A dropped socket
// would read as a synthetic 1006, so a received code proves a frame was sent.
func readResponsesWSClose(t *testing.T, conn *websocket.Conn) *websocket.CloseError {
	t.Helper()
	require.NoError(t, conn.SetReadDeadline(time.Now().Add(5*time.Second)))
	_, _, err := conn.ReadMessage()
	var closeErr *websocket.CloseError
	require.ErrorAs(t, err, &closeErr)
	return closeErr
}

func TestResponsesWSShutdownSendsCloseFramesWithoutWaitingForWriters(t *testing.T) {
	server, client, cleanupClient := newTestWebSocketPair(t)
	defer cleanupClient()
	target, peer, cleanupTarget := newTestWebSocketPair(t)
	defer cleanupTarget()
	ctx, cancel := context.WithCancel(context.Background())
	s := &responsesWSSession{ctx: ctx, cancel: cancel, client: server, target: target}
	// Blocked network writers own these locks. Shutdown must not wait for
	// them: its close frames are bounded control writes, and closing the
	// sockets is what interrupts those writers.
	s.clientWriteMu.Lock()
	defer s.clientWriteMu.Unlock()
	s.targetWriteMu.Lock()
	defer s.targetWriteMu.Unlock()
	done := make(chan struct{})
	go func() { s.shutdown(websocket.CloseInternalServerErr, "upstream connection closed"); close(done) }()
	select {
	case <-done:
	case <-time.After(5 * time.Second):
		t.Fatal("shutdown waited for a network writer")
	}
	for _, conn := range []*websocket.Conn{client, peer} {
		closeErr := readResponsesWSClose(t, conn)
		assert.Equal(t, websocket.CloseInternalServerErr, closeErr.Code)
		assert.Equal(t, "upstream connection closed", closeErr.Text)
	}
	assert.Nil(t, s.getTarget())

	// Only the first shutdown decides the close code.
	s.shutdown(websocket.CloseNormalClosure, "")

	// An upstream dial that completes after shutdown is closed with a frame too.
	late, latePeer, cleanupLate := newTestWebSocketPair(t)
	defer cleanupLate()
	assert.False(t, s.setTarget(late))
	assert.Equal(t, websocket.CloseNormalClosure, readResponsesWSClose(t, latePeer).Code)
}

// An idle upstream that closes normally ends the client session with its own
// code; any other end of the upstream socket is reported as 1011.
func TestResponsesWSIdleUpstreamCloseEndsClientSession(t *testing.T) {
	for _, tc := range []struct {
		name     string
		upstream func(*testing.T, *websocket.Conn)
		want     int
	}{
		{name: "normal closure", upstream: func(t *testing.T, conn *websocket.Conn) {
			require.NoError(t, conn.WriteControl(websocket.CloseMessage, websocket.FormatCloseMessage(websocket.CloseNormalClosure, "bye"), time.Now().Add(time.Second)))
		}, want: websocket.CloseNormalClosure},
		{name: "going away", upstream: func(t *testing.T, conn *websocket.Conn) {
			require.NoError(t, conn.WriteControl(websocket.CloseMessage, websocket.FormatCloseMessage(websocket.CloseGoingAway, "restart"), time.Now().Add(time.Second)))
		}, want: websocket.CloseGoingAway},
		{name: "dropped", upstream: func(t *testing.T, conn *websocket.Conn) {
			require.NoError(t, conn.UnderlyingConn().Close())
		}, want: websocket.CloseInternalServerErr},
	} {
		t.Run(tc.name, func(t *testing.T) {
			server, client, cleanupClient := newTestWebSocketPair(t)
			defer cleanupClient()
			target, peer, cleanupTarget := newTestWebSocketPair(t)
			defer cleanupTarget()
			ctx, cancel := context.WithCancel(context.Background())
			s := &responsesWSSession{ctx: ctx, cancel: cancel, client: server}
			require.True(t, s.setTarget(target))
			s.startTargetReader(target)

			tc.upstream(t, peer)
			closeErr := readResponsesWSClose(t, client)
			assert.Equal(t, tc.want, closeErr.Code)
			assert.Equal(t, "upstream connection closed", closeErr.Text)
			s.workers.Wait()
			assert.Error(t, ctx.Err())
		})
	}
}
