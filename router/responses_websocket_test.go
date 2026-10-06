package router

import (
	"fmt"
	"net/http"
	"net/http/httptest"
	"os"
	"strings"
	"sync"
	"sync/atomic"
	"testing"
	"time"

	"github.com/dev-fan-sophon/boxai/common"
	"github.com/dev-fan-sophon/boxai/constant"
	"github.com/dev-fan-sophon/boxai/i18n"
	"github.com/dev-fan-sophon/boxai/model"
	"github.com/dev-fan-sophon/boxai/service"
	"github.com/dev-fan-sophon/boxai/setting/operation_setting"
	"github.com/dev-fan-sophon/boxai/setting/ratio_setting"

	"github.com/gin-gonic/gin"
	"github.com/gorilla/websocket"
	"github.com/stretchr/testify/assert"
	"github.com/stretchr/testify/require"
)

const (
	responsesWSTestModel    = "gpt-ws-e2e"
	responsesWSInitialQuota = 1_000_000
)

// responsesWSUpstream is a native Responses WebSocket upstream. Each
// accepted connection runs script with the decoded client events.
type responsesWSUpstream struct {
	server     *httptest.Server
	handshakes atomic.Int32
	mu         sync.Mutex
	headers    []http.Header
	events     []map[string]any
}

type responsesWSUpstreamConn struct {
	upstream *responsesWSUpstream
	conn     *websocket.Conn
}

func (u *responsesWSUpstreamConn) read() (map[string]any, bool) {
	var event map[string]any
	if err := u.conn.ReadJSON(&event); err != nil {
		return nil, false
	}
	u.upstream.mu.Lock()
	u.upstream.events = append(u.upstream.events, event)
	u.upstream.mu.Unlock()
	return event, true
}

func (u *responsesWSUpstreamConn) send(events ...string) {
	for _, event := range events {
		if err := u.conn.WriteMessage(websocket.TextMessage, []byte(event)); err != nil {
			return
		}
	}
}

func newResponsesWSUpstream(t *testing.T, rejectStatus int, script func(*responsesWSUpstreamConn)) *responsesWSUpstream {
	t.Helper()
	upstream := &responsesWSUpstream{}
	upgrader := websocket.Upgrader{CheckOrigin: func(*http.Request) bool { return true }}
	upstream.server = httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		upstream.handshakes.Add(1)
		upstream.mu.Lock()
		upstream.headers = append(upstream.headers, r.Header.Clone())
		upstream.mu.Unlock()
		if r.URL.Path != "/v1/responses" {
			http.NotFound(w, r)
			return
		}
		if rejectStatus != 0 {
			http.Error(w, `{"error":{"message":"private upstream secret detail"}}`, rejectStatus)
			return
		}
		conn, err := upgrader.Upgrade(w, r, nil)
		if err != nil {
			return
		}
		defer conn.Close()
		script(&responsesWSUpstreamConn{upstream: upstream, conn: conn})
	}))
	t.Cleanup(upstream.server.Close)
	return upstream
}

func (u *responsesWSUpstream) receivedEvents() []map[string]any {
	u.mu.Lock()
	defer u.mu.Unlock()
	return append([]map[string]any(nil), u.events...)
}

func completedEvent(responseID string, input, output int) string {
	return fmt.Sprintf(`{"type":"response.completed","response":{"id":%q,"status":"completed","model":%q,"usage":{"input_tokens":%d,"output_tokens":%d,"total_tokens":%d}}}`,
		responseID, responsesWSTestModel, input, output, input+output)
}

func createdEvent(responseID string) string {
	return fmt.Sprintf(`{"type":"response.created","response":{"id":%q,"status":"in_progress","model":%q}}`, responseID, responsesWSTestModel)
}

// serveTurns answers every response.create with created, delta and a
// completed event carrying usage (input, output) for that turn.
func serveTurns(usage ...[2]int) func(*responsesWSUpstreamConn) {
	return func(conn *responsesWSUpstreamConn) {
		turn := 0
		for {
			event, ok := conn.read()
			if !ok {
				return
			}
			if event["type"] != "response.create" || turn >= len(usage) {
				continue
			}
			id := fmt.Sprintf("resp_%d", turn+1)
			conn.send(createdEvent(id), `{"type":"response.output_text.delta","delta":"hello"}`, completedEvent(id, usage[turn][0], usage[turn][1]))
			turn++
		}
	}
}

var responsesWSFixtureSequence atomic.Int64

type responsesWSFixture struct {
	t      *testing.T
	engine *httptest.Server
	user   model.User
	token  model.Token
}

func setupResponsesWSFixture(t *testing.T) *responsesWSFixture {
	t.Helper()
	gin.SetMode(gin.TestMode)
	originalDB, originalLogDB := model.DB, model.LOG_DB
	originalMaster, originalMemory := common.IsMasterNode, common.MemoryCacheEnabled
	originalSQLitePath := common.SQLitePath
	originalMainType, originalLogType := common.MainDatabaseType(), common.LogDatabaseType()
	originalSQLDSN, hadSQLDSN := os.LookupEnv("SQL_DSN")
	originalRetryTimes, originalRetryRanges := common.RetryTimes, operation_setting.AutomaticRetryStatusCodeRanges
	originalAutoDisable, originalCountToken := common.AutomaticDisableChannelEnabled, constant.CountToken
	originalRatios, originalCompletionRatios := ratio_setting.ModelRatio2JSONString(), ratio_setting.CompletionRatio2JSONString()
	originalLogConsume := common.LogConsumeEnabled
	t.Cleanup(func() {
		model.DB, model.LOG_DB = originalDB, originalLogDB
		// RedisEnabled stays false: asynchronous billing and metrics goroutines
		// may still read it, and this test binary never configures Redis.
		common.IsMasterNode, common.MemoryCacheEnabled = originalMaster, originalMemory
		common.SQLitePath = originalSQLitePath
		common.SetDatabaseTypes(originalMainType, originalLogType)
		if hadSQLDSN {
			_ = os.Setenv("SQL_DSN", originalSQLDSN)
		} else {
			_ = os.Unsetenv("SQL_DSN")
		}
		common.RetryTimes, operation_setting.AutomaticRetryStatusCodeRanges = originalRetryTimes, originalRetryRanges
		common.AutomaticDisableChannelEnabled, constant.CountToken = originalAutoDisable, originalCountToken
		require.NoError(t, ratio_setting.UpdateModelRatioByJSONString(originalRatios))
		require.NoError(t, ratio_setting.UpdateCompletionRatioByJSONString(originalCompletionRatios))
		common.LogConsumeEnabled = originalLogConsume
	})

	common.IsMasterNode, common.MemoryCacheEnabled = false, false
	if common.RedisEnabled {
		common.RedisEnabled = false
	}
	common.SQLitePath = fmt.Sprintf("file:%s_%d?mode=memory&cache=shared", strings.ReplaceAll(t.Name(), "/", "_"), responsesWSFixtureSequence.Add(1))
	common.SetDatabaseTypes(common.DatabaseTypeSQLite, common.DatabaseTypeSQLite)
	require.NoError(t, os.Setenv("SQL_DSN", "local"))
	require.NoError(t, model.InitDB())
	model.LOG_DB = model.DB
	require.NoError(t, model.DB.AutoMigrate(&model.User{}, &model.Token{}, &model.Channel{}, &model.Ability{},
		&model.Log{}, &model.UserSubscription{}, &model.BillingOperation{}))
	service.InitTokenEncoders()
	require.NoError(t, i18n.Init())
	common.RetryTimes = 0
	common.AutomaticDisableChannelEnabled = false
	common.LogConsumeEnabled = true
	constant.CountToken = false
	// One quota per token on both sides makes every settled turn exact.
	require.NoError(t, ratio_setting.UpdateModelRatioByJSONString(fmt.Sprintf(`{%q:1}`, responsesWSTestModel)))
	require.NoError(t, ratio_setting.UpdateCompletionRatioByJSONString(fmt.Sprintf(`{%q:1}`, responsesWSTestModel)))

	fixture := &responsesWSFixture{t: t}
	fixture.user = model.User{Username: "responses-ws-user", Status: common.UserStatusEnabled, Group: "default", Quota: responsesWSInitialQuota, Role: common.RoleCommonUser}
	require.NoError(t, model.DB.Create(&fixture.user).Error)
	fixture.token = model.Token{UserId: fixture.user.Id, Key: "responseswse2etoken", Status: common.TokenStatusEnabled, ExpiredTime: -1, RemainQuota: responsesWSInitialQuota}
	require.NoError(t, model.DB.Create(&fixture.token).Error)

	engine := gin.New()
	SetRelayRouter(engine)
	fixture.engine = httptest.NewServer(engine)
	t.Cleanup(fixture.engine.Close)
	return fixture
}

func (f *responsesWSFixture) addChannel(id int, channelType int, baseURL string, priority int64, setting string) {
	f.t.Helper()
	channel := model.Channel{Id: id, Type: channelType, Name: fmt.Sprintf("ws-%d", id), Key: fmt.Sprintf("upstream-key-%d", id),
		Status: common.ChannelStatusEnabled, BaseURL: common.GetPointer(baseURL), Group: "default", Models: responsesWSTestModel,
		Priority: common.GetPointer(priority), AutoBan: common.GetPointer(0), Setting: common.GetPointer(setting)}
	require.NoError(f.t, model.DB.Create(&channel).Error)
	require.NoError(f.t, model.DB.Create(&model.Ability{Group: "default", Model: responsesWSTestModel, ChannelId: id, Enabled: true, Priority: common.GetPointer(priority)}).Error)
}

func (f *responsesWSFixture) dial(key string) (*websocket.Conn, *http.Response, error) {
	header := http.Header{}
	if key != "" {
		header.Set("Authorization", "Bearer sk-"+key)
	}
	url := "ws" + strings.TrimPrefix(f.engine.URL, "http") + "/v1/responses"
	return websocket.DefaultDialer.Dial(url, header)
}

func (f *responsesWSFixture) connect() *websocket.Conn {
	f.t.Helper()
	conn, resp, err := f.dial(f.token.Key)
	require.NoError(f.t, err)
	require.Equal(f.t, http.StatusSwitchingProtocols, resp.StatusCode)
	f.t.Cleanup(func() { _ = conn.Close() })
	return conn
}

func sendCreate(t *testing.T, conn *websocket.Conn, modelName string, extra string) {
	t.Helper()
	require.NoError(t, conn.WriteMessage(websocket.TextMessage, []byte(fmt.Sprintf(`{"type":"response.create","model":%q,"input":"hi","stream":true%s}`, modelName, extra))))
}

// readUntilTerminal returns every client event up to the request's terminal
// event or error.
func readUntilTerminal(t *testing.T, conn *websocket.Conn) []map[string]any {
	t.Helper()
	var events []map[string]any
	for {
		require.NoError(t, conn.SetReadDeadline(time.Now().Add(10*time.Second)))
		var event map[string]any
		require.NoError(t, conn.ReadJSON(&event))
		events = append(events, event)
		switch event["type"] {
		case "response.completed", "response.incomplete", "response.failed", "response.cancelled", "error":
			return events
		}
	}
}

func (f *responsesWSFixture) quotas() (userQuota int, tokenQuota int) {
	f.t.Helper()
	var user model.User
	require.NoError(f.t, model.DB.First(&user, f.user.Id).Error)
	var token model.Token
	require.NoError(f.t, model.DB.First(&token, f.token.Id).Error)
	return user.Quota, token.RemainQuota
}

func (f *responsesWSFixture) consumeLogs() []model.Log {
	f.t.Helper()
	var logs []model.Log
	require.NoError(f.t, model.LOG_DB.Where("user_id = ? AND type = ?", f.user.Id, model.LogTypeConsume).Order("id").Find(&logs).Error)
	return logs
}

// requireQuotaSpent waits for asynchronous refunds and asserts the exact
// total charged to both the wallet and the token.
func (f *responsesWSFixture) requireQuotaSpent(spent int) {
	f.t.Helper()
	require.Eventually(f.t, func() bool {
		userQuota, tokenQuota := f.quotas()
		return userQuota == responsesWSInitialQuota-spent && tokenQuota == responsesWSInitialQuota-spent
	}, 5*time.Second, 10*time.Millisecond)
}

const responsesWSEnabled = `{"responses_websocket_enabled":true}`

func TestResponsesWebSocketErrorAliasReleasesTurn(t *testing.T) {
	for _, accepted := range []bool{false, true} {
		t.Run(fmt.Sprint("accepted=", accepted), func(t *testing.T) {
			fixture := setupResponsesWSFixture(t)
			upstream := newResponsesWSUpstream(t, 0, func(conn *responsesWSUpstreamConn) {
				if _, ok := conn.read(); !ok {
					return
				}
				if accepted {
					conn.send(createdEvent("failed-turn"))
				}
				conn.send(`{"type":"response.error","status":400,"error":{"message":"private upstream detail","type":"invalid_request_error"}}`)
				serveTurns([2]int{3, 5})(conn)
			})
			fixture.addChannel(1, constant.ChannelTypeOpenAI, upstream.server.URL, 0, responsesWSEnabled)
			conn := fixture.connect()
			sendCreate(t, conn, responsesWSTestModel, "")
			events := readUntilTerminal(t, conn)
			last := events[len(events)-1]
			assert.Equal(t, "error", last["type"])
			assert.NotContains(t, last["error"].(map[string]any)["message"], "private")
			fixture.requireQuotaSpent(0)
			sendCreate(t, conn, responsesWSTestModel, "")
			events = readUntilTerminal(t, conn)
			assert.Equal(t, "response.completed", events[len(events)-1]["type"])
			fixture.requireQuotaSpent(8)
		})
	}
}

func TestResponsesWebSocketHandshakeRequiresTokenAuthentication(t *testing.T) {
	fixture := setupResponsesWSFixture(t)
	for _, key := range []string{"", "not-a-valid-token"} {
		_, resp, err := fixture.dial(key)
		require.Error(t, err)
		require.NotNil(t, resp)
		assert.Equal(t, http.StatusUnauthorized, resp.StatusCode)
	}
}

func TestResponsesWebSocketMultiTurnBillingAndModelLock(t *testing.T) {
	fixture := setupResponsesWSFixture(t)
	upstream := newResponsesWSUpstream(t, 0, serveTurns([2]int{10, 5}, [2]int{20, 0}))
	fixture.addChannel(1, constant.ChannelTypeOpenAI, upstream.server.URL, 0, responsesWSEnabled)
	conn := fixture.connect()

	sendCreate(t, conn, responsesWSTestModel, `,"stream_id":"s-1","stream_options":{"include_usage":true}`)
	events := readUntilTerminal(t, conn)
	require.Equal(t, "response.completed", events[len(events)-1]["type"])
	assert.Equal(t, []any{"response.created", "response.output_text.delta"}, []any{events[0]["type"], events[1]["type"]})
	fixture.requireQuotaSpent(15)

	sendCreate(t, conn, responsesWSTestModel, "")
	events = readUntilTerminal(t, conn)
	require.Equal(t, "response.completed", events[len(events)-1]["type"])
	fixture.requireQuotaSpent(35)

	// The connection is bound to its first model; another model is refused
	// without reaching the upstream or reserving quota.
	sendCreate(t, conn, "gpt-other-model", "")
	events = readUntilTerminal(t, conn)
	rejection := events[len(events)-1]
	assert.Equal(t, "error", rejection["type"])
	assert.EqualValues(t, http.StatusBadRequest, rejection["status"])
	assert.Contains(t, rejection["error"].(map[string]any)["message"], "locked to model")

	logs := fixture.consumeLogs()
	require.Len(t, logs, 2)
	assert.Equal(t, []int{15, 20}, []int{logs[0].Quota, logs[1].Quota})
	assert.Equal(t, []int{10, 20}, []int{logs[0].PromptTokens, logs[1].PromptTokens})
	assert.True(t, logs[0].IsStream)
	fixture.requireQuotaSpent(35)

	// Both turns reused one upstream handshake, sent as native response.create
	// events without transport-only fields; stream_id stays on the envelope.
	assert.EqualValues(t, 1, upstream.handshakes.Load())
	received := upstream.receivedEvents()
	require.Len(t, received, 2)
	for _, event := range received {
		assert.Equal(t, "response.create", event["type"])
		assert.Equal(t, responsesWSTestModel, event["model"])
		assert.NotContains(t, event, "stream")
		assert.NotContains(t, event, "stream_options")
	}
	assert.Equal(t, "s-1", received[0]["stream_id"])
	assert.NotContains(t, received[1], "stream_id")
	assert.Equal(t, "Bearer upstream-key-1", upstream.headers[0].Get("Authorization"))
}

func TestResponsesWebSocketCancelAndDisconnectSettleObservedUsage(t *testing.T) {
	t.Run("cancel control reaches upstream and settles terminal usage", func(t *testing.T) {
		fixture := setupResponsesWSFixture(t)
		upstream := newResponsesWSUpstream(t, 0, func(conn *responsesWSUpstreamConn) {
			for {
				event, ok := conn.read()
				if !ok {
					return
				}
				switch event["type"] {
				case "response.create":
					conn.send(createdEvent("resp_cancel"), `{"type":"response.output_text.delta","delta":"partial"}`)
				case "response.cancel":
					conn.send(`{"type":"response.cancelled","response":{"id":"resp_cancel","status":"cancelled","usage":{"input_tokens":4,"output_tokens":3,"total_tokens":7}}}`)
				}
			}
		})
		fixture.addChannel(1, constant.ChannelTypeOpenAI, upstream.server.URL, 0, responsesWSEnabled)
		conn := fixture.connect()
		sendCreate(t, conn, responsesWSTestModel, "")
		require.NoError(t, conn.SetReadDeadline(time.Now().Add(10*time.Second)))
		var created map[string]any
		require.NoError(t, conn.ReadJSON(&created))
		require.Equal(t, "response.created", created["type"])
		require.NoError(t, conn.WriteMessage(websocket.TextMessage, []byte(`{"type":"response.cancel","response_id":"resp_cancel"}`)))

		events := readUntilTerminal(t, conn)
		assert.Equal(t, "response.cancelled", events[len(events)-1]["type"])
		fixture.requireQuotaSpent(7)
		require.Len(t, fixture.consumeLogs(), 1)
		received := upstream.receivedEvents()
		require.Len(t, received, 2)
		assert.Equal(t, "response.cancel", received[1]["type"])
	})

	t.Run("client disconnect keeps the interrupted stream usage", func(t *testing.T) {
		fixture := setupResponsesWSFixture(t)
		upstreamClosed := make(chan struct{})
		upstream := newResponsesWSUpstream(t, 0, func(conn *responsesWSUpstreamConn) {
			defer close(upstreamClosed)
			if _, ok := conn.read(); !ok {
				return
			}
			conn.send(`{"type":"response.in_progress","response":{"id":"resp_cut","status":"in_progress","usage":{"input_tokens":9,"output_tokens":2}}}`,
				`{"type":"response.output_text.delta","delta":"x"}`)
			// The relay closes the upstream connection once the client is gone.
			conn.read()
		})
		fixture.addChannel(1, constant.ChannelTypeOpenAI, upstream.server.URL, 0, responsesWSEnabled)
		conn := fixture.connect()
		sendCreate(t, conn, responsesWSTestModel, "")
		require.NoError(t, conn.SetReadDeadline(time.Now().Add(10*time.Second)))
		var event map[string]any
		require.NoError(t, conn.ReadJSON(&event))
		require.NoError(t, conn.ReadJSON(&event))
		require.Equal(t, "response.output_text.delta", event["type"])
		require.NoError(t, conn.Close())

		select {
		case <-upstreamClosed:
		case <-time.After(10 * time.Second):
			t.Fatal("upstream connection was not cancelled after the client disconnected")
		}
		// Upstream running totals (9 prompt, 2 output) bound the interrupted
		// stream; the delivered text is smaller, so 11 is charged.
		fixture.requireQuotaSpent(11)
		require.Eventually(t, func() bool { return len(fixture.consumeLogs()) == 1 }, 5*time.Second, 10*time.Millisecond)
	})
}

func TestResponsesWebSocketRejectedUpstreamHandshake(t *testing.T) {
	t.Run("rejection is refunded and reported without upstream detail", func(t *testing.T) {
		fixture := setupResponsesWSFixture(t)
		upstream := newResponsesWSUpstream(t, http.StatusUnauthorized, nil)
		fixture.addChannel(1, constant.ChannelTypeOpenAI, upstream.server.URL, 0, responsesWSEnabled)
		conn := fixture.connect()
		sendCreate(t, conn, responsesWSTestModel, "")
		events := readUntilTerminal(t, conn)
		rejection := events[len(events)-1]
		require.Equal(t, "error", rejection["type"])
		message := rejection["error"].(map[string]any)["message"].(string)
		assert.NotContains(t, message, "private upstream secret")
		assert.NotContains(t, message, upstream.server.URL)
		fixture.requireQuotaSpent(0)
		assert.Empty(t, fixture.consumeLogs())
	})

	t.Run("a failed handshake fails over before any create is sent", func(t *testing.T) {
		fixture := setupResponsesWSFixture(t)
		common.RetryTimes = 1
		operation_setting.AutomaticRetryStatusCodeRanges = []operation_setting.StatusCodeRange{{Start: 500, End: 599}}
		failing := newResponsesWSUpstream(t, http.StatusServiceUnavailable, nil)
		working := newResponsesWSUpstream(t, 0, serveTurns([2]int{6, 6}))
		fixture.addChannel(1, constant.ChannelTypeOpenAI, failing.server.URL, 10, responsesWSEnabled)
		fixture.addChannel(2, constant.ChannelTypeOpenAI, working.server.URL, 0, responsesWSEnabled)
		conn := fixture.connect()
		sendCreate(t, conn, responsesWSTestModel, "")
		events := readUntilTerminal(t, conn)
		require.Equal(t, "response.completed", events[len(events)-1]["type"])
		assert.EqualValues(t, 1, failing.handshakes.Load())
		assert.EqualValues(t, 1, working.handshakes.Load())
		assert.Len(t, working.receivedEvents(), 1)
		fixture.requireQuotaSpent(12)
		logs := fixture.consumeLogs()
		require.Len(t, logs, 1)
		assert.Equal(t, 2, logs[0].ChannelId)
	})
}

func TestResponsesWebSocketRoutesOnlyOptedInNativeChannels(t *testing.T) {
	fixture := setupResponsesWSFixture(t)
	disabled := newResponsesWSUpstream(t, 0, serveTurns([2]int{1, 1}))
	enabled := newResponsesWSUpstream(t, 0, serveTurns([2]int{2, 2}))
	converter := newResponsesWSUpstream(t, 0, serveTurns([2]int{3, 3}))
	// Higher priority channels that cannot carry the native protocol are skipped.
	fixture.addChannel(1, constant.ChannelTypeOpenAI, disabled.server.URL, 20, `{}`)
	fixture.addChannel(2, constant.ChannelTypeAdvancedCustom, converter.server.URL, 10, responsesWSEnabled)
	require.NoError(t, model.DB.Model(&model.Channel{}).Where("id = ?", 2).Update("settings",
		`{"advanced_custom":{"advanced_routes":[{"incoming_path":"/v1/responses","upstream_path":"/v1/chat/completions","converter":"openai_responses_to_openai_chat"}]}}`).Error)
	fixture.addChannel(3, constant.ChannelTypeSub2API, enabled.server.URL, 0, responsesWSEnabled)
	conn := fixture.connect()

	sendCreate(t, conn, responsesWSTestModel, "")
	events := readUntilTerminal(t, conn)
	require.Equal(t, "response.completed", events[len(events)-1]["type"])
	assert.Zero(t, disabled.handshakes.Load())
	assert.Zero(t, converter.handshakes.Load())
	assert.EqualValues(t, 1, enabled.handshakes.Load())
	fixture.requireQuotaSpent(4)

	t.Run("no capable channel", func(t *testing.T) {
		require.NoError(t, model.DB.Model(&model.Channel{}).Where("id = ?", 3).Update("setting", `{}`).Error)
		other := fixture.connect()
		sendCreate(t, other, responsesWSTestModel, "")
		events := readUntilTerminal(t, other)
		rejection := events[len(events)-1]
		assert.Equal(t, "error", rejection["type"])
		assert.EqualValues(t, http.StatusServiceUnavailable, rejection["status"])
		fixture.requireQuotaSpent(4)
	})
}

func TestResponsesWebSocketEnforcesTokenConstraintsPerTurn(t *testing.T) {
	t.Run("model limit", func(t *testing.T) {
		fixture := setupResponsesWSFixture(t)
		upstream := newResponsesWSUpstream(t, 0, serveTurns([2]int{1, 1}))
		fixture.addChannel(1, constant.ChannelTypeOpenAI, upstream.server.URL, 0, responsesWSEnabled)
		require.NoError(t, model.DB.Model(&fixture.token).Updates(map[string]any{"model_limits_enabled": true, "model_limits": "some-other-model"}).Error)
		conn := fixture.connect()
		sendCreate(t, conn, responsesWSTestModel, "")
		events := readUntilTerminal(t, conn)
		rejection := events[len(events)-1]
		assert.Equal(t, "error", rejection["type"])
		assert.EqualValues(t, http.StatusForbidden, rejection["status"])
		assert.Zero(t, upstream.handshakes.Load())
		// Authorization failures end the connection.
		require.NoError(t, conn.SetReadDeadline(time.Now().Add(10*time.Second)))
		_, _, err := conn.ReadMessage()
		assert.Error(t, err)
	})

	t.Run("revoked token after handshake", func(t *testing.T) {
		fixture := setupResponsesWSFixture(t)
		upstream := newResponsesWSUpstream(t, 0, serveTurns([2]int{1, 1}, [2]int{1, 1}))
		fixture.addChannel(1, constant.ChannelTypeOpenAI, upstream.server.URL, 0, responsesWSEnabled)
		conn := fixture.connect()
		sendCreate(t, conn, responsesWSTestModel, "")
		require.Equal(t, "response.completed", readUntilTerminal(t, conn)[2]["type"])
		require.NoError(t, model.DB.Model(&fixture.token).Update("status", common.TokenStatusDisabled).Error)

		sendCreate(t, conn, responsesWSTestModel, "")
		events := readUntilTerminal(t, conn)
		rejection := events[len(events)-1]
		assert.Equal(t, "error", rejection["type"])
		assert.EqualValues(t, http.StatusUnauthorized, rejection["status"])
		assert.Len(t, upstream.receivedEvents(), 1)
		fixture.requireQuotaSpent(2)
	})

	t.Run("insufficient quota is rejected before the upstream", func(t *testing.T) {
		fixture := setupResponsesWSFixture(t)
		upstream := newResponsesWSUpstream(t, 0, serveTurns([2]int{1, 1}))
		fixture.addChannel(1, constant.ChannelTypeOpenAI, upstream.server.URL, 0, responsesWSEnabled)
		require.NoError(t, model.DB.Model(&fixture.user).Update("quota", 0).Error)
		conn := fixture.connect()
		sendCreate(t, conn, responsesWSTestModel, "")
		events := readUntilTerminal(t, conn)
		assert.Equal(t, "error", events[len(events)-1]["type"])
		assert.EqualValues(t, http.StatusForbidden, events[len(events)-1]["status"])
		assert.Zero(t, upstream.handshakes.Load())
	})
}

func TestResponsesWebSocketLockedRouteRequiresReconnect(t *testing.T) {
	t.Run("changed base URL", func(t *testing.T) {
		fixture := setupResponsesWSFixture(t)
		upstream := newResponsesWSUpstream(t, 0, serveTurns([2]int{1, 1}, [2]int{1, 1}))
		fixture.addChannel(1, constant.ChannelTypeOpenAI, upstream.server.URL, 0, responsesWSEnabled)
		conn := fixture.connect()
		sendCreate(t, conn, responsesWSTestModel, "")
		require.Equal(t, "response.completed", readUntilTerminal(t, conn)[2]["type"])
		require.NoError(t, model.DB.Model(&model.Channel{}).Where("id = ?", 1).Update("base_url", upstream.server.URL+"/moved").Error)

		sendCreate(t, conn, responsesWSTestModel, "")
		events := readUntilTerminal(t, conn)
		rejection := events[len(events)-1]
		assert.Equal(t, "error", rejection["type"])
		assert.EqualValues(t, http.StatusForbidden, rejection["status"])
		assert.Contains(t, rejection["error"].(map[string]any)["message"], "reconnect required")
		assert.Len(t, upstream.receivedEvents(), 1)
		fixture.requireQuotaSpent(2)
	})

	t.Run("disabled channel closes the connection", func(t *testing.T) {
		fixture := setupResponsesWSFixture(t)
		upstream := newResponsesWSUpstream(t, 0, serveTurns([2]int{1, 1}))
		fixture.addChannel(1, constant.ChannelTypeOpenAI, upstream.server.URL, 0, responsesWSEnabled)
		conn := fixture.connect()
		sendCreate(t, conn, responsesWSTestModel, "")
		require.Equal(t, "response.completed", readUntilTerminal(t, conn)[2]["type"])

		require.Equal(t, 1, service.CloseActiveWebSocketsForChannels([]int{1}, service.ChannelDisabledCloseReason))
		require.NoError(t, conn.SetReadDeadline(time.Now().Add(10*time.Second)))
		_, _, err := conn.ReadMessage()
		var closeErr *websocket.CloseError
		require.ErrorAs(t, err, &closeErr)
		assert.Equal(t, websocket.ClosePolicyViolation, closeErr.Code)
	})

	t.Run("concurrent create is refused while a response is active", func(t *testing.T) {
		fixture := setupResponsesWSFixture(t)
		release := make(chan struct{})
		upstream := newResponsesWSUpstream(t, 0, func(conn *responsesWSUpstreamConn) {
			if _, ok := conn.read(); !ok {
				return
			}
			conn.send(createdEvent("resp_slow"))
			<-release
			conn.send(completedEvent("resp_slow", 1, 1))
			conn.read()
		})
		fixture.addChannel(1, constant.ChannelTypeOpenAI, upstream.server.URL, 0, responsesWSEnabled)
		conn := fixture.connect()
		sendCreate(t, conn, responsesWSTestModel, "")
		require.NoError(t, conn.SetReadDeadline(time.Now().Add(10*time.Second)))
		var created map[string]any
		require.NoError(t, conn.ReadJSON(&created))
		require.Equal(t, "response.created", created["type"])

		sendCreate(t, conn, responsesWSTestModel, "")
		conflict := readUntilTerminal(t, conn)
		assert.EqualValues(t, http.StatusConflict, conflict[len(conflict)-1]["status"])
		close(release)
		assert.Equal(t, "response.completed", readUntilTerminal(t, conn)[0]["type"])
		fixture.requireQuotaSpent(2)
		assert.Len(t, upstream.receivedEvents(), 1)
	})
}

func TestResponsesWebSocketAdminPinnedChannelAndBetaOptIn(t *testing.T) {
	fixture := setupResponsesWSFixture(t)
	require.NoError(t, model.DB.Model(&fixture.user).Update("role", common.RoleAdminUser).Error)
	preferred := newResponsesWSUpstream(t, 0, serveTurns([2]int{1, 1}))
	pinned := newResponsesWSUpstream(t, 0, serveTurns([2]int{2, 1}))
	fixture.addChannel(1, constant.ChannelTypeOpenAI, preferred.server.URL, 10, responsesWSEnabled)
	fixture.addChannel(2, constant.ChannelTypeCodexProxy, pinned.server.URL, 0, responsesWSEnabled)

	header := http.Header{}
	header.Set("Authorization", "Bearer sk-"+fixture.token.Key+"-2")
	header.Set("OpenAI-Beta", "responses_websockets=2026-02-06")
	conn, _, err := websocket.DefaultDialer.Dial("ws"+strings.TrimPrefix(fixture.engine.URL, "http")+"/v1/responses", header)
	require.NoError(t, err)
	t.Cleanup(func() { _ = conn.Close() })

	sendCreate(t, conn, responsesWSTestModel, "")
	events := readUntilTerminal(t, conn)
	require.Equal(t, "response.completed", events[len(events)-1]["type"])
	assert.Zero(t, preferred.handshakes.Load())
	require.EqualValues(t, 1, pinned.handshakes.Load())
	assert.Equal(t, "responses_websockets=2026-02-06", pinned.headers[0].Get("OpenAI-Beta"))
	assert.Equal(t, "Bearer upstream-key-2", pinned.headers[0].Get("Authorization"))
	fixture.requireQuotaSpent(3)
}
