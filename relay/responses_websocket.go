package relay

import (
	"bytes"
	"context"
	"encoding/json"
	"errors"
	"fmt"
	"io"
	"net/http"
	"reflect"
	"runtime/debug"
	"slices"
	"strconv"
	"strings"
	"sync"
	"time"

	"github.com/dev-fan-sophon/boxai/common"
	"github.com/dev-fan-sophon/boxai/common/limiter"
	"github.com/dev-fan-sophon/boxai/constant"
	"github.com/dev-fan-sophon/boxai/dto"
	"github.com/dev-fan-sophon/boxai/i18n"
	"github.com/dev-fan-sophon/boxai/logger"
	"github.com/dev-fan-sophon/boxai/middleware"
	"github.com/dev-fan-sophon/boxai/model"
	perfmetrics "github.com/dev-fan-sophon/boxai/pkg/perf_metrics"
	"github.com/dev-fan-sophon/boxai/pkg/wsmanager"
	relaychannel "github.com/dev-fan-sophon/boxai/relay/channel"
	relaycommon "github.com/dev-fan-sophon/boxai/relay/common"
	"github.com/dev-fan-sophon/boxai/relay/helper"
	"github.com/dev-fan-sophon/boxai/service"
	"github.com/dev-fan-sophon/boxai/setting"
	"github.com/dev-fan-sophon/boxai/setting/ratio_setting"
	"github.com/dev-fan-sophon/boxai/types"

	"github.com/bytedance/gopkg/util/gopool"
	"github.com/gin-gonic/gin"
	"github.com/gorilla/websocket"
	"github.com/samber/lo"
)

const (
	responsesWSEventTypeResponseCreate = "response.create"
	responsesWSEventTypeResponseCancel = "response.cancel"
	responsesWSWriteTimeout            = 30 * time.Second
	// ResponsesWSRequestPath is the HTTP-shaped path every response.create is
	// authenticated, limited, routed and billed as.
	ResponsesWSRequestPath = "/v1/responses"
)

// ResponsesWSRequestRunner executes the ordinary authentication and request
// limiter middleware around one complete response.create, without a second
// HTTP connection, and runs handle inside it.
type ResponsesWSRequestRunner func(*http.Request, string, func(*gin.Context) *types.NewAPIError) *types.NewAPIError

// ResponsesWSChannelPolicy lets the controller apply the HTTP relay's channel
// retry and channel-error rules to upstream WebSocket handshakes.
type ResponsesWSChannelPolicy struct {
	ShouldRetry    func(c *gin.Context, err *types.NewAPIError, remainingRetries int) bool
	OnChannelError func(c *gin.Context, channelError types.ChannelError, err *types.NewAPIError)
}

type responsesWSCreateEvent struct {
	Type     string          `json:"type"`
	EventID  string          `json:"event_id,omitempty"`
	StreamID json.RawMessage `json:"stream_id,omitempty"`
	Generate json.RawMessage `json:"generate,omitempty"`
	Request  json.RawMessage `json:"response,omitempty"`
}

type responsesWSCreateRequest struct {
	Body     []byte
	Generate json.RawMessage
	StreamID string
}

type responsesWSErrorEvent struct {
	Type       string             `json:"type"`
	Status     int                `json:"status"`
	EventID    string             `json:"event_id,omitempty"`
	StreamID   string             `json:"stream_id,omitempty"`
	ResponseID string             `json:"response_id,omitempty"`
	Code       any                `json:"code,omitempty"`
	Message    string             `json:"message,omitempty"`
	Error      *types.OpenAIError `json:"error"`
}

type responsesWSMessage struct {
	kind int
	body []byte
	err  error
}

// responsesWSControl is a client control event (response.cancel) whose
// envelope the read loop already parsed.
type responsesWSControl struct {
	body              []byte
	eventID, streamID string
}

// Only the request worker reads or changes billing state. Socket readers pass
// bounded messages to it; cancellation never performs an independent refund.
type responsesWSCallState struct {
	inbox      chan responsesWSMessage
	controls   chan responsesWSControl
	done       chan struct{}
	terminal   *responsesWSMessage
	closeAfter bool
}

type responsesWSSession struct {
	ctx            context.Context
	cancel         context.CancelFunc
	client         *websocket.Conn
	runner         ResponsesWSRequestRunner
	policy         ResponsesWSChannelPolicy
	request        *http.Request
	requestID      string
	nextEventIndex int
	workers        sync.WaitGroup

	clientWriteMu sync.Mutex
	targetWriteMu sync.Mutex
	connectionMu  sync.Mutex
	target        *websocket.Conn
	unregister    func()
	stateMu       sync.Mutex
	current       *responsesWSCallState

	// These fields belong to the serial request worker and describe the
	// established upstream connection. Per-request token/user data is never
	// stored here; every turn authenticates and prices itself again.
	lastResponseID  string
	lockedModel     string
	lockedChannelID int
	lockedGroup     string
	lockedKey       string
	lockedKeyIndex  int
	lockedContext   map[constant.ContextKey]any
	lockedRoute     dto.AdvancedCustomRoute
}

// ResponsesWebSocketHelper relays one client Responses WebSocket. Each
// response.create is a separate request: authenticated, rate limited, priced,
// reserved and settled on its own. The first accepted request binds the
// connection to one model, channel, key and route; later requests revalidate
// that binding and never fail over, because a create sent upstream cannot be
// replayed unambiguously.
func ResponsesWebSocketHelper(c *gin.Context, client *websocket.Conn, runner ResponsesWSRequestRunner, policy ResponsesWSChannelPolicy) {
	ctx, cancel := context.WithCancel(c.Request.Context())
	s := &responsesWSSession{ctx: ctx, cancel: cancel, client: client, runner: runner, policy: policy,
		request: c.Request.Clone(ctx), requestID: c.GetString(common.RequestIdKey)}
	if s.requestID == "" {
		s.requestID = common.NewRequestId()
	}
	maxMB := constant.MaxRequestBodyMB
	if maxMB <= 0 {
		maxMB = 128
	}
	client.SetReadLimit(int64(maxMB) << 20)
	defer func() {
		s.shutdown()
		s.workers.Wait()
	}()

	for {
		_, message, err := client.ReadMessage()
		if err != nil {
			return
		}
		envelope, streamID, err := parseResponsesWSEnvelope(message)
		if err != nil {
			s.sendError(envelope.EventID, streamID, newResponsesWSInvalidRequestError(err))
			continue
		}
		if envelope.Type != responsesWSEventTypeResponseCreate {
			// Controls are owned by the active request too. In particular a
			// cancel arriving during authentication must not precede its create.
			state := s.getCurrent()
			if envelope.Type != responsesWSEventTypeResponseCancel || state == nil {
				s.sendError(envelope.EventID, streamID, newResponsesWSInvalidRequestError(fmt.Errorf("unsupported websocket event %q", envelope.Type)))
				continue
			}
			select {
			case state.controls <- responsesWSControl{body: message, eventID: envelope.EventID, streamID: streamID}:
			case <-state.done:
			case <-s.ctx.Done():
				return
			default:
				s.sendError(envelope.EventID, streamID, newResponsesWSInvalidRequestError(errors.New("a response control event is already pending")))
			}
			continue
		}
		state := &responsesWSCallState{inbox: make(chan responsesWSMessage), controls: make(chan responsesWSControl, 1), done: make(chan struct{})}
		if !s.tryReserveCurrent(state) {
			s.sendError(envelope.EventID, streamID, types.NewErrorWithStatusCode(errors.New("another response.create is already in progress on this websocket connection"), types.ErrorCodeInvalidRequest, http.StatusConflict, types.ErrOptionWithSkipRetry()))
			continue
		}
		requestID := fmt.Sprintf("%s-ws-%d", s.requestID, s.nextEventIndex)
		s.nextEventIndex++
		s.workers.Go(func() { s.runRequest(state, message, envelope, streamID, requestID) })
	}
}

func (s *responsesWSSession) runRequest(state *responsesWSCallState, message []byte, envelope responsesWSCreateEvent, streamID string, requestID string) {
	create, parseErr := normalizeResponsesWSCreateEvent(message, envelope, streamID)
	var apiErr *types.NewAPIError
	defer func() {
		if recovered := recover(); recovered != nil {
			common.SysError(fmt.Sprintf("responses websocket request panic: %v", recovered))
			apiErr = types.NewError(errors.New("responses websocket request failed"), types.ErrorCodeBadResponse, types.ErrOptionWithSkipRetry())
			state.closeAfter = true
		}
		// The middleware already finished this request. Hold admission while
		// publishing its terminal event so an immediate next create cannot race
		// the current request's release; socket close needs neither lock.
		outgoing := state.terminal
		if apiErr != nil {
			if body, err := buildResponsesWSErrorPayload(envelope.EventID, streamID, apiErr); err == nil {
				outgoing = &responsesWSMessage{kind: websocket.TextMessage, body: body}
			}
		}
		s.clientWriteMu.Lock()
		s.stateMu.Lock()
		if outgoing != nil {
			if err := s.client.SetWriteDeadline(time.Now().Add(responsesWSWriteTimeout)); err != nil {
				state.closeAfter = true
			} else if err := s.client.WriteMessage(outgoing.kind, outgoing.body); err != nil {
				state.closeAfter = true
			}
		}
		s.current = nil
		close(state.done)
		s.stateMu.Unlock()
		s.clientWriteMu.Unlock()
		if state.closeAfter {
			s.shutdown()
		}
	}()
	request := s.request.Clone(s.ctx)
	request.Body = io.NopCloser(bytes.NewReader(message))
	request.ContentLength = int64(len(message))
	apiErr = s.runner(request, requestID, func(c *gin.Context) *types.NewAPIError {
		if parseErr != nil {
			return newResponsesWSInvalidRequestError(parseErr)
		}
		c.Request.Body = io.NopCloser(bytes.NewReader(create.Body))
		c.Request.ContentLength = int64(len(create.Body))
		return s.runCall(c, state, create)
	})
	if apiErr != nil && (apiErr.StatusCode == http.StatusUnauthorized || apiErr.StatusCode == http.StatusForbidden) {
		state.closeAfter = true
	}
}

func (s *responsesWSSession) runCall(c *gin.Context, state *responsesWSCallState, create responsesWSCreateRequest) (apiErr *types.NewAPIError) {
	var info *relaycommon.RelayInfo
	defer func() {
		if recovered := recover(); recovered != nil {
			common.SysError(fmt.Sprintf("responses websocket call panic: %v %s", recovered, debug.Stack()))
			apiErr = types.NewError(errors.New("responses websocket request failed"), types.ErrorCodeBadResponse, types.ErrOptionWithSkipRetry())
			state.closeAfter = true
		}
		success := apiErr == nil && info != nil && info.StreamStatus != nil && c.Request.Context().Err() == nil &&
			info.StreamStatus.IsNormalEnd() && info.StreamStatus.EndError == nil && !info.StreamStatus.HasErrors()
		c.Set(limiter.RelayOutcomeKey, success)
		if apiErr == nil {
			return
		}
		logger.LogError(c, fmt.Sprintf("responses websocket request error: %s", common.LocalLogPreview(apiErr.Error())))
		if info == nil {
			return
		}
		// A settled BillingSession never refunds; this only releases the
		// reservation of a request that did not reach settlement.
		apiErr = service.NormalizeViolationFeeError(apiErr)
		if info.Billing != nil {
			info.Billing.Refund(c)
		}
		service.ChargeViolationFeeIfNeeded(c, info, apiErr)
		failed := info
		gopool.Go(func() { perfmetrics.RecordRelaySample(failed, false, 0) })
	}()

	request, err := helper.GetAndValidateResponsesRequest(c)
	if err != nil {
		if common.IsRequestBodyTooLargeError(err) || errors.Is(err, common.ErrRequestBodyTooLarge) {
			return types.NewErrorWithStatusCode(err, types.ErrorCodeReadRequestBodyFailed, http.StatusRequestEntityTooLarge, types.ErrOptionWithSkipRetry())
		}
		return newResponsesWSInvalidRequestError(err)
	}
	modelName := request.Model
	if s.lockedModel != "" && modelName != s.lockedModel {
		return newResponsesWSInvalidRequestError(fmt.Errorf("responses websocket connection is locked to model %q", s.lockedModel))
	}
	if apiErr = checkResponsesWSModelAccess(c, modelName); apiErr != nil {
		return apiErr
	}
	common.SetContextKey(c, constant.ContextKeyOriginalModel, modelName)
	common.SetContextKey(c, constant.ContextKeyRequestStartTime, time.Now())

	if s.lockedChannelID != 0 {
		if apiErr = s.restoreConnectionContext(c, modelName); apiErr != nil {
			return apiErr
		}
		info = newResponsesWSRelayInfo(c, request)
		if apiErr = prepareResponsesWSBilling(c, info, request); apiErr != nil {
			return apiErr
		}
		if apiErr = service.PrepareTieredBillingForSelectedGroup(c, info); apiErr != nil {
			return apiErr
		}
		var payload []byte
		payload, _, apiErr = buildResponsesWSCreatePayload(c, info, request, create.Generate, create.StreamID)
		if apiErr != nil {
			return apiErr
		}
		if err := s.writeTarget(websocket.TextMessage, payload); err != nil {
			state.closeAfter = true
			return types.NewError(errors.New("responses websocket upstream connection closed"), types.ErrorCodeBadResponse, types.ErrOptionWithSkipRetry())
		}
	} else {
		if info, apiErr = s.connect(c, request, create); apiErr != nil {
			return apiErr
		}
	}

	return s.relayResponse(c, state, info, create)
}

// connect selects a channel for the first request, dials it and sends the
// create. Only handshakes are retried: nothing has reached the upstream model
// before the create is written, so a failover cannot duplicate generation.
func (s *responsesWSSession) connect(c *gin.Context, request *dto.OpenAIResponsesRequest, create responsesWSCreateRequest) (info *relaycommon.RelayInfo, apiErr *types.NewAPIError) {
	modelName := request.Model
	retry := &service.RetryParam{
		Ctx:         c,
		TokenGroup:  common.GetContextKeyString(c, constant.ContextKeyUsingGroup),
		ModelName:   modelName,
		RequestPath: ResponsesWSRequestPath,
		Retry:       common.GetPointer(0),
		ChannelFilter: func(channel *model.Channel) bool {
			return responsesWebSocketChannelSupports(channel, modelName)
		},
	}
	for attempt := 0; attempt <= common.RetryTimes; attempt++ {
		if attempt > 0 {
			retry.IncreaseRetry()
		}
		var channel *model.Channel
		channel, apiErr = selectResponsesWSChannel(c, retry, attempt)
		if apiErr != nil {
			if info == nil {
				return nil, apiErr
			}
			// Report the last upstream failure rather than an exhausted pool,
			// and record it as final like the HTTP relay does.
			if s.policy.OnChannelError != nil {
				c.Set("relay_retry_attempt", false)
				s.policy.OnChannelError(c, *types.NewChannelError(c.GetInt("channel_id"), c.GetInt("channel_type"), c.GetString("channel_name"), common.GetContextKeyBool(c, constant.ContextKeyChannelIsMultiKey), common.GetContextKeyString(c, constant.ContextKeyChannelKey), c.GetBool("auto_ban")), info.LastError)
			}
			return info, info.LastError
		}
		c.Set("use_channel", append(c.GetStringSlice("use_channel"), strconv.Itoa(channel.Id)))
		if info == nil {
			info = newResponsesWSRelayInfo(c, request)
			if apiErr = prepareResponsesWSBilling(c, info, request); apiErr != nil {
				return info, apiErr
			}
		} else {
			info.PriceData.GroupRatioInfo = helper.HandleGroupRatio(c, info)
		}
		if apiErr = service.PrepareTieredBillingForSelectedGroup(c, info); apiErr != nil {
			return info, apiErr
		}
		info.RetryIndex = attempt
		payload, adaptor, buildErr := buildResponsesWSCreatePayload(c, info, request, create.Generate, create.StreamID)
		if buildErr != nil {
			return info, buildErr
		}
		target, dialErr := relaychannel.DoWssRequest(adaptor, c, info, nil)
		if dialErr != nil {
			apiErr = types.NewError(dialErr, types.ErrorCodeDoRequestFailed)
			service.ResetStatusCode(apiErr, c.GetString("status_code_mapping"))
			apiErr = service.NormalizeViolationFeeError(apiErr)
			service.NormalizeRelayServiceFault(apiErr)
			info.LastError = apiErr
			retryable := s.ctx.Err() == nil && s.policy.ShouldRetry != nil && s.policy.ShouldRetry(c, apiErr, common.RetryTimes-attempt)
			c.Set("relay_retry_attempt", retryable)
			if s.policy.OnChannelError != nil {
				s.policy.OnChannelError(c, *types.NewChannelError(channel.Id, channel.Type, channel.Name, channel.ChannelInfo.IsMultiKey, common.GetContextKeyString(c, constant.ContextKeyChannelKey), channel.GetAutoBan()), apiErr)
			}
			if retryable {
				continue
			}
			return info, apiErr
		}
		if !s.setTarget(target) {
			return info, types.NewError(context.Canceled, types.ErrorCodeBadResponse, types.ErrOptionWithSkipRetry())
		}
		if err := s.writeTarget(websocket.TextMessage, payload); err != nil {
			s.shutdown()
			return info, types.NewError(errors.New("responses websocket upstream connection closed"), types.ErrorCodeBadResponse, types.ErrOptionWithSkipRetry())
		}
		s.lockConnection(c, channel, info, modelName)
		s.registerChannelClose(channel.Id)
		s.startTargetReader(target)
		info.LastError = nil
		return info, nil
	}
	if info != nil && info.LastError != nil {
		return info, info.LastError
	}
	return info, types.NewError(errors.New("no Responses WebSocket channel is available"), types.ErrorCodeGetChannelFailed, types.ErrOptionWithSkipRetry())
}

// lockConnection records the physical connection a later request must reuse.
func (s *responsesWSSession) lockConnection(c *gin.Context, channel *model.Channel, info *relaycommon.RelayInfo, modelName string) {
	s.lockedModel, s.lockedChannelID, s.lockedGroup = modelName, channel.Id, info.UsingGroup
	s.lockedKey = common.GetContextKeyString(c, constant.ContextKeyChannelKey)
	s.lockedKeyIndex = common.GetContextKeyInt(c, constant.ContextKeyChannelMultiKeyIndex)
	s.lockedRoute, _ = channel.GetOtherSettings().AdvancedCustom.MatchPathForModel(ResponsesWSRequestPath, modelName)
	s.lockedContext = make(map[constant.ContextKey]any)
	for _, key := range []constant.ContextKey{
		constant.ContextKeyChannelId, constant.ContextKeyChannelName, constant.ContextKeyChannelType,
		constant.ContextKeyChannelCreateTime, constant.ContextKeyChannelSetting, constant.ContextKeyChannelOtherSetting,
		constant.ContextKeyChannelParamOverride, constant.ContextKeyChannelHeaderOverride, constant.ContextKeyChannelOrganization,
		constant.ContextKeyChannelAutoBan, constant.ContextKeyChannelModelMapping, constant.ContextKeyChannelStatusCodeMapping,
		constant.ContextKeyChannelIsMultiKey, constant.ContextKeyChannelMultiKeyIndex, constant.ContextKeyChannelKey, constant.ContextKeyChannelBaseUrl,
	} {
		if value, ok := c.Get(string(key)); ok {
			s.lockedContext[key] = value
		}
	}
}

// relayResponse forwards upstream events of the current request to the client
// until a terminal event, and settles exactly once from the observed usage.
func (s *responsesWSSession) relayResponse(c *gin.Context, state *responsesWSCallState, info *relaycommon.RelayInfo, create responsesWSCreateRequest) *types.NewAPIError {
	accumulator := service.NewResponsesUsageAccumulator(info)
	timeout := time.Duration(constant.StreamingTimeout) * time.Second
	if timeout <= 0 {
		timeout = 300 * time.Second
	}
	idle := time.NewTimer(timeout)
	defer idle.Stop()
	accepted := false
	var pendingControl []byte
	var sentControl []byte
	var responseID string
	settle := func(reason relaycommon.StreamEndReason, err error) {
		info.StreamStatus.SetEndReason(reason, err)
		service.PostTextConsumeQuota(c, info, accumulator.Finish(c), nil)
	}
	for {
		select {
		case incoming := <-state.inbox:
			idle.Reset(timeout)
			if incoming.err != nil {
				state.closeAfter = true
				settle(relaycommon.StreamEndReasonScannerErr, errors.New("upstream websocket closed"))
				return nil
			}
			info.SetFirstResponseTime()
			var event struct {
				dto.ResponsesStreamResponse
				StreamID string `json:"stream_id"`
			}
			if err := common.Unmarshal(incoming.body, &event); err != nil {
				accumulator.ObserveMalformed()
				if err := s.writeClient(incoming.kind, incoming.body); err != nil {
					s.shutdown()
				}
				continue
			}
			if event.Type != "error" && event.Type != "response.error" && event.StreamID != "" && event.StreamID != create.StreamID {
				if err := s.writeClient(incoming.kind, incoming.body); err != nil {
					s.shutdown()
				}
				continue
			}
			// A repeated terminal from the previous response must never finish
			// a subsequent request on this persistent connection.
			if event.Response != nil && event.Response.ID != "" && event.Response.ID == s.lastResponseID {
				continue
			}
			if event.Type == "error" || event.Type == "response.error" {
				var rejection responsesWSErrorEvent
				_ = common.Unmarshal(incoming.body, &rejection)
				if rejection.ResponseID != "" && rejection.ResponseID == s.lastResponseID {
					continue
				}
				terminal, ambiguous, controlError := responsesWSErrorEndsRequest(rejection, create.StreamID, responseID, sentControl)
				if !terminal {
					if err := s.writeClient(incoming.kind, incoming.body); err != nil {
						s.shutdown()
					}
					// Only a control error in this stream resolves its control.
					if controlError {
						sentControl = nil
					}
					continue
				}
				if accepted {
					accumulator.Observe(&event.ResponsesStreamResponse)
					fault := s.rejectedRequestError(c, info, rejection)
					incoming.body, _ = buildResponsesWSErrorPayload(rejection.EventID, create.StreamID, fault)
					s.lastResponseID = responseID
					state.terminal, state.closeAfter = &incoming, ambiguous
					settle(relaycommon.StreamEndReasonDone, nil)
					return nil
				}
				return s.rejectedRequestError(c, info, rejection)
			}
			if strings.HasPrefix(event.Type, "response.") {
				if !accepted {
					// Like HTTP, bind the affinity only once upstream accepted.
					service.RecordChannelAffinity(c, s.lockedChannelID)
				}
				accepted = true
				if event.Response != nil && event.Response.ID != "" {
					responseID = event.Response.ID
				}
			}
			accumulator.Observe(&event.ResponsesStreamResponse)
			switch event.Type {
			case "response.completed", "response.done", "response.incomplete", "response.failed", "response.cancelled", "response.canceled":
				if event.Response != nil {
					s.lastResponseID = event.Response.ID
				}
				state.terminal = &incoming
				settle(relaycommon.StreamEndReasonDone, nil)
				return nil
			}
			if err := s.writeClient(incoming.kind, incoming.body); err != nil {
				s.shutdown()
			}
			if accepted && pendingControl != nil {
				if err := s.writeTarget(websocket.TextMessage, pendingControl); err != nil {
					s.shutdown()
				}
				sentControl = pendingControl
				pendingControl = nil
			}
		case control := <-state.controls:
			if pendingControl != nil || sentControl != nil {
				s.sendError(control.eventID, control.streamID, newResponsesWSInvalidRequestError(errors.New("a response control event is already pending")))
				continue
			}
			if !accepted {
				pendingControl = control.body
				continue
			}
			if err := s.writeTarget(websocket.TextMessage, control.body); err != nil {
				s.shutdown()
			}
			sentControl = control.body
		case <-idle.C:
			state.closeAfter = true
			settle(relaycommon.StreamEndReasonTimeout, context.DeadlineExceeded)
			return nil
		case <-s.ctx.Done():
			settle(relaycommon.StreamEndReasonClientGone, s.ctx.Err())
			return nil
		}
	}
}

// rejectedRequestError converts an upstream error that rejected the create
// before any response event into the request's public error. The request is
// refunded by the caller; the established connection stays usable.
func (s *responsesWSSession) rejectedRequestError(c *gin.Context, info *relaycommon.RelayInfo, rejection responsesWSErrorEvent) *types.NewAPIError {
	if rejection.Error == nil {
		// An error frame without an error object still describes the rejected
		// request; keep the client-facing type stable.
		rejection.Error = &types.OpenAIError{Type: "invalid_request_error", Message: rejection.Message, Code: rejection.Code}
	}
	status := rejection.Status
	if status < http.StatusBadRequest || status > 599 {
		status = http.StatusBadRequest
	}
	rejected := types.WithOpenAIError(*rejection.Error, status, types.ErrOptionWithSkipRetry())
	service.ResetStatusCode(rejected, c.GetString("status_code_mapping"))
	rejected = service.NormalizeViolationFeeError(rejected)
	service.NormalizeRelayServiceFault(rejected)
	info.LastError = rejected
	if s.policy.OnChannelError != nil {
		c.Set("relay_retry_attempt", false)
		s.policy.OnChannelError(c, *types.NewChannelError(s.lockedChannelID, common.GetContextKeyInt(c, constant.ContextKeyChannelType), common.GetContextKeyString(c, constant.ContextKeyChannelName), common.GetContextKeyBool(c, constant.ContextKeyChannelIsMultiKey), s.lockedKey, common.GetContextKeyBool(c, constant.ContextKeyChannelAutoBan)), rejected)
	}
	return rejected
}

// A single generation is active, but a cancel can fail independently. Correlate
// available IDs first; uncorrelated control/server errors require a bounded
// connection close because continuing could leave the generation stuck forever.
func responsesWSErrorEndsRequest(event responsesWSErrorEvent, streamID, responseID string, control []byte) (terminal, ambiguous, controlError bool) {
	if len(control) > 0 {
		var pending struct {
			EventID    string `json:"event_id"`
			StreamID   string `json:"stream_id"`
			ResponseID string `json:"response_id"`
		}
		_ = common.Unmarshal(control, &pending)
		if event.EventID != "" && event.EventID == pending.EventID {
			return false, false, true
		}
		if event.ResponseID != "" && event.ResponseID == pending.ResponseID && event.ResponseID != responseID {
			return false, false, true
		}
		if (event.StreamID == "" || event.StreamID == pending.StreamID) && event.Error != nil && event.Error.Type == "invalid_request_error" {
			switch event.Error.Code {
			case "response_not_found", "response_not_active", "response_already_completed":
				return false, false, true
			}
		}
	}
	if event.StreamID != "" && event.StreamID != streamID || responseID != "" && event.ResponseID != "" && event.ResponseID != responseID {
		return false, false, false
	}
	return true, len(control) > 0 && event.ResponseID == "", false
}

// restoreConnectionContext revalidates the established binding for a later
// request and restores the channel context the payload builder reads.
func (s *responsesWSSession) restoreConnectionContext(c *gin.Context, modelName string) *types.NewAPIError {
	reconnect := func(message string) *types.NewAPIError {
		return types.NewErrorWithStatusCode(errors.New(message), types.ErrorCodeAccessDenied, http.StatusForbidden, types.ErrOptionWithSkipRetry())
	}
	channel, err := model.CacheGetChannel(s.lockedChannelID)
	if err != nil || channel == nil || channel.Status != common.ChannelStatusEnabled || !responsesWebSocketChannelSupports(channel, modelName) {
		return reconnect("Responses WebSocket is no longer available on this connection's channel; reconnect required")
	}
	keyEnabled := channel.Key == s.lockedKey
	if channel.ChannelInfo.IsMultiKey {
		keys := channel.GetKeys()
		status, found := channel.ChannelInfo.MultiKeyStatusList[s.lockedKeyIndex]
		keyEnabled = s.lockedKeyIndex >= 0 && s.lockedKeyIndex < len(keys) && keys[s.lockedKeyIndex] == s.lockedKey &&
			(!found || status == common.ChannelStatusEnabled)
	}
	if !keyEnabled {
		return reconnect("the upstream connection credential changed; reconnect required")
	}
	// Changes that alter the physical upstream connection require a new
	// handshake. Request-level settings are refreshed without reconnecting.
	if channel.GetBaseURL() != s.lockedContext[constant.ContextKeyChannelBaseUrl] ||
		!reflect.DeepEqual(channel.GetHeaderOverride(), s.lockedContext[constant.ContextKeyChannelHeaderOverride]) {
		return reconnect("upstream connection settings changed; reconnect required")
	}
	if previous, ok := s.lockedContext[constant.ContextKeyChannelSetting].(dto.ChannelSettings); ok && previous.Proxy != channel.GetSetting().Proxy {
		return reconnect("upstream proxy changed; reconnect required")
	}
	// An Advanced Custom connection was dialed through the route matched for
	// this model. Only the fields that shape the handshake force a reconnect:
	// target path, protocol conversion and credential placement. Other channel
	// types match the zero route on both sides.
	route, _ := channel.GetOtherSettings().AdvancedCustom.MatchPathForModel(ResponsesWSRequestPath, modelName)
	if strings.TrimSpace(route.UpstreamPath) != strings.TrimSpace(s.lockedRoute.UpstreamPath) ||
		route.IsNative() != s.lockedRoute.IsNative() || !reflect.DeepEqual(route.Auth, s.lockedRoute.Auth) {
		return reconnect("upstream route changed; reconnect required")
	}
	if pinned, ok := common.GetContextKey(c, constant.ContextKeyTokenSpecificChannelId); ok {
		if id, err := strconv.Atoi(fmt.Sprint(pinned)); err != nil || id != s.lockedChannelID {
			return reconnect("channel pin changed; reconnect required")
		}
	} else {
		group := common.GetContextKeyString(c, constant.ContextKeyUsingGroup)
		if group == "auto" {
			if !slices.Contains(service.GetRequestAutoGroups(c, common.GetContextKeyString(c, constant.ContextKeyUserGroup)), s.lockedGroup) {
				return reconnect("the connection group is no longer allowed; reconnect required")
			}
			group = s.lockedGroup
			common.SetContextKey(c, constant.ContextKeyAutoGroup, group)
		}
		if !model.IsChannelEnabledForGroupModel(group, modelName, s.lockedChannelID) {
			return reconnect("the connection channel is no longer allowed for this group and model; reconnect required")
		}
	}
	for key, value := range s.lockedContext {
		c.Set(string(key), value)
	}
	c.Set("original_model", modelName)
	common.SetContextKey(c, constant.ContextKeyChannelSetting, channel.GetSetting())
	common.SetContextKey(c, constant.ContextKeyChannelOtherSetting, channel.GetOtherSettings())
	common.SetContextKey(c, constant.ContextKeyChannelParamOverride, channel.GetParamOverride())
	common.SetContextKey(c, constant.ContextKeyChannelModelMapping, channel.GetModelMapping())
	common.SetContextKey(c, constant.ContextKeyChannelStatusCodeMapping, channel.GetStatusCodeMapping())
	common.SetContextKey(c, constant.ContextKeyChannelAutoBan, channel.GetAutoBan())
	c.Set("use_channel", []string{strconv.Itoa(channel.Id)})
	return nil
}

func newResponsesWSRelayInfo(c *gin.Context, request *dto.OpenAIResponsesRequest) *relaycommon.RelayInfo {
	info := relaycommon.GenRelayInfoResponses(c, request)
	info.IsStream = true
	common.SetContextKey(c, constant.ContextKeyIsStream, true)
	info.StreamStatus = relaycommon.NewStreamStatus()
	return info
}

// prepareResponsesWSBilling estimates and reserves one request's charge the
// same way the HTTP relay does before its first attempt.
func prepareResponsesWSBilling(c *gin.Context, info *relaycommon.RelayInfo, request *dto.OpenAIResponsesRequest) *types.NewAPIError {
	needSensitiveCheck := setting.ShouldCheckPromptSensitive()
	meta := &types.TokenCountMeta{TokenType: types.TokenTypeTokenizer, MaxTokens: int(lo.FromPtrOr(request.MaxOutputTokens, uint(0)))}
	if needSensitiveCheck || constant.CountToken {
		meta = request.GetTokenCountMeta()
	}
	if needSensitiveCheck && meta != nil {
		if contains, words := service.CheckSensitiveText(meta.CombineText); contains {
			logger.LogWarn(c, fmt.Sprintf("user sensitive words detected: %s", strings.Join(words, ", ")))
			return types.NewErrorWithStatusCode(errors.New("sensitive words detected"), types.ErrorCodeSensitiveWordsDetected, http.StatusBadRequest, types.ErrOptionWithSkipRetry())
		}
	}
	tokens, err := service.EstimateRequestToken(c, meta, info)
	if err != nil {
		return types.NewError(err, types.ErrorCodeCountTokenFailed, types.ErrOptionWithSkipRetry())
	}
	info.SetEstimatePromptTokens(tokens)
	priceData, err := helper.ModelPriceHelper(c, info, tokens, meta)
	if err != nil {
		return types.NewError(err, types.ErrorCodeModelPriceError, types.ErrOptionWithStatusCode(http.StatusBadRequest), types.ErrOptionWithSkipRetry())
	}
	if priceData.FreeModel {
		logger.LogInfo(c, fmt.Sprintf("模型 %s 免费，跳过预扣费", info.OriginModelName))
		return nil
	}
	return service.PreConsumeBilling(c, priceData.QuotaToPreConsume, info)
}

// buildResponsesWSCreatePayload applies the HTTP Responses request pipeline
// for the selected channel and wraps the result in a response.create event.
func buildResponsesWSCreatePayload(c *gin.Context, info *relaycommon.RelayInfo, request *dto.OpenAIResponsesRequest, generate json.RawMessage, streamID string) ([]byte, relaychannel.Adaptor, *types.NewAPIError) {
	info.InitChannelMeta(c)
	adaptor, body, closer, apiErr := prepareResponsesRequestBody(c, info, request)
	if apiErr != nil {
		return nil, nil, apiErr
	}
	defer closer.Close()
	jsonData, err := io.ReadAll(body)
	if err != nil {
		return nil, nil, types.NewError(err, types.ErrorCodeReadRequestBodyFailed, types.ErrOptionWithSkipRetry())
	}
	event, err := buildResponsesWSCreateEvent(jsonData, generate, streamID)
	if err != nil {
		return nil, nil, types.NewError(err, types.ErrorCodeConvertRequestFailed, types.ErrOptionWithSkipRetry())
	}
	return event, adaptor, nil
}

func (s *responsesWSSession) startTargetReader(target *websocket.Conn) {
	limit := int64(helper.DefaultMaxScannerBufferSize)
	if constant.StreamScannerMaxBufferMB > 0 {
		limit = int64(constant.StreamScannerMaxBufferMB) << 20
	}
	target.SetReadLimit(limit)
	s.workers.Go(func() {
		for {
			kind, body, err := target.ReadMessage()
			incoming := responsesWSMessage{kind: kind, body: body, err: err}
			if state := s.getCurrent(); state != nil {
				select {
				case state.inbox <- incoming:
				case <-state.done:
					if err != nil {
						s.shutdown()
					} else if writeErr := s.writeClient(kind, body); writeErr != nil {
						s.shutdown()
						return
					}
				case <-s.ctx.Done():
					return
				}
			} else if err == nil {
				if writeErr := s.writeClient(kind, body); writeErr != nil {
					s.shutdown()
					return
				}
			} else {
				s.shutdown()
			}
			if err != nil {
				return
			}
		}
	})
}

func (s *responsesWSSession) getCurrent() *responsesWSCallState {
	s.stateMu.Lock()
	defer s.stateMu.Unlock()
	return s.current
}

func (s *responsesWSSession) tryReserveCurrent(state *responsesWSCallState) bool {
	s.stateMu.Lock()
	defer s.stateMu.Unlock()
	if s.current != nil {
		return false
	}
	s.current = state
	return true
}

func (s *responsesWSSession) getTarget() *websocket.Conn {
	s.connectionMu.Lock()
	defer s.connectionMu.Unlock()
	return s.target
}

func (s *responsesWSSession) setTarget(target *websocket.Conn) bool {
	s.connectionMu.Lock()
	defer s.connectionMu.Unlock()
	if s.ctx.Err() != nil {
		_ = target.Close()
		return false
	}
	s.target = target
	return true
}

func (s *responsesWSSession) writeTarget(kind int, message []byte) error {
	s.targetWriteMu.Lock()
	defer s.targetWriteMu.Unlock()
	target := s.getTarget()
	if target == nil {
		return errors.New("responses websocket upstream is not connected")
	}
	if err := target.SetWriteDeadline(time.Now().Add(responsesWSWriteTimeout)); err != nil {
		return err
	}
	return target.WriteMessage(kind, message)
}

func (s *responsesWSSession) writeClient(kind int, message []byte) error {
	s.clientWriteMu.Lock()
	defer s.clientWriteMu.Unlock()
	if err := s.client.SetWriteDeadline(time.Now().Add(responsesWSWriteTimeout)); err != nil {
		return err
	}
	return s.client.WriteMessage(kind, message)
}

func (s *responsesWSSession) sendError(eventID, streamID string, apiErr *types.NewAPIError) {
	payload, err := buildResponsesWSErrorPayload(eventID, streamID, apiErr)
	if err == nil {
		_ = s.writeClient(websocket.TextMessage, payload)
	}
}

func (s *responsesWSSession) closeTarget() {
	s.connectionMu.Lock()
	target, unregister := s.target, s.unregister
	s.target, s.unregister = nil, nil
	s.connectionMu.Unlock()
	if unregister != nil {
		unregister()
	}
	if target != nil {
		_ = target.Close()
	}
}

func (s *responsesWSSession) shutdown() {
	s.cancel()
	s.closeTarget()
	_ = s.client.Close()
}

func (s *responsesWSSession) registerChannelClose(channelID int) {
	unregister := wsmanager.Register(channelID, wsmanager.KindResponses, s.closeForPolicy)
	s.connectionMu.Lock()
	if s.ctx.Err() != nil {
		s.connectionMu.Unlock()
		unregister()
		return
	}
	s.unregister = unregister
	s.connectionMu.Unlock()
}

// closeForPolicy tells both peers why the connection ends, like the realtime
// relay does; WriteControl is safe alongside a blocked data writer.
func (s *responsesWSSession) closeForPolicy(reason string) {
	closeMessage := websocket.FormatCloseMessage(websocket.ClosePolicyViolation, reason)
	deadline := time.Now().Add(time.Second)
	_ = s.client.WriteControl(websocket.CloseMessage, closeMessage, deadline)
	if target := s.getTarget(); target != nil {
		_ = target.WriteControl(websocket.CloseMessage, closeMessage, deadline)
	}
	s.shutdown()
}

// Stream identity belongs to the WebSocket envelope. For the legacy wrapped
// input, the top-level field takes precedence over response.stream_id.
func parseResponsesWSEnvelope(message []byte) (responsesWSCreateEvent, string, error) {
	var event responsesWSCreateEvent
	if err := common.Unmarshal(message, &event); err != nil {
		return event, "", errors.New("invalid websocket event json")
	}
	streamRaw := event.StreamID
	if len(streamRaw) == 0 && len(event.Request) > 0 {
		var wrapped struct {
			StreamID json.RawMessage `json:"stream_id"`
		}
		if err := common.Unmarshal(event.Request, &wrapped); err == nil {
			streamRaw = wrapped.StreamID
		}
	}
	var streamID string
	if len(streamRaw) > 0 {
		if err := common.Unmarshal(streamRaw, &streamID); err != nil || len(streamID) < 1 || len(streamID) > 256 {
			return event, "", errors.New("stream_id must contain 1-256 ASCII letters, digits, underscores, hyphens, or periods")
		}
		for _, char := range streamID {
			if !(char >= 'a' && char <= 'z' || char >= 'A' && char <= 'Z' || char >= '0' && char <= '9' || char == '_' || char == '-' || char == '.') {
				return event, "", errors.New("stream_id must contain only ASCII letters, digits, underscores, hyphens, or periods")
			}
		}
	}
	if strings.TrimSpace(event.Type) == "" {
		return event, streamID, errors.New("websocket event type is required")
	}
	return event, streamID, nil
}

func newResponsesWSInvalidRequestError(err error) *types.NewAPIError {
	return types.NewErrorWithStatusCode(err, types.ErrorCodeInvalidRequest, http.StatusBadRequest, types.ErrOptionWithSkipRetry())
}

// normalizeResponsesWSCreateEvent builds the HTTP-shaped request body from a
// response.create whose envelope the read loop already parsed and validated.
// Transport-only fields never enter the body: the relay always streams, and a
// wrapped request cannot smuggle outer envelope fields.
func normalizeResponsesWSCreateEvent(message []byte, event responsesWSCreateEvent, streamID string) (responsesWSCreateRequest, error) {
	create := responsesWSCreateRequest{StreamID: streamID, Generate: event.Generate}
	source := message
	if len(event.Request) > 0 {
		source = event.Request
	}
	var raw map[string]json.RawMessage
	if err := common.Unmarshal(source, &raw); err != nil {
		return create, errors.New("response.create must be a JSON object")
	}
	if len(event.Request) > 0 {
		if len(create.Generate) == 0 {
			create.Generate = raw["generate"]
		}
	}
	for _, key := range []string{"type", "event_id", "background", "stream", "stream_options", "generate", "stream_id"} {
		delete(raw, key)
	}
	payload, err := common.Marshal(raw)
	if err != nil {
		return create, err
	}
	create.Body = payload
	return create, nil
}

func buildResponsesWSCreateEvent(jsonData []byte, generate json.RawMessage, streamID string) ([]byte, error) {
	var event map[string]json.RawMessage
	if err := common.Unmarshal(jsonData, &event); err != nil {
		return nil, err
	}
	typeData, err := common.Marshal(responsesWSEventTypeResponseCreate)
	if err != nil {
		return nil, err
	}
	event["type"] = typeData
	// The normalized body never carries stream_id; a channel parameter
	// override may inject one, and it must not shadow the envelope's value.
	delete(event, "stream_id")
	if streamID != "" {
		streamData, err := common.Marshal(streamID)
		if err != nil {
			return nil, err
		}
		event["stream_id"] = streamData
	}
	for _, key := range []string{"event_id", "background", "stream", "stream_options"} {
		delete(event, key)
	}
	if len(generate) > 0 {
		event["generate"] = generate
	}
	return common.Marshal(event)
}

func buildResponsesWSErrorPayload(eventID, streamID string, apiErr *types.NewAPIError) ([]byte, error) {
	if apiErr == nil {
		return nil, errors.New("api error is nil")
	}
	status := apiErr.StatusCode
	if status == 0 {
		status = http.StatusInternalServerError
	}
	openaiErr := apiErr.ToOpenAIError()
	return common.Marshal(&responsesWSErrorEvent{
		Type:     "error",
		Status:   status,
		EventID:  eventID,
		StreamID: streamID,
		Error:    &openaiErr,
	})
}

// checkResponsesWSModelAccess applies the token model limit with the HTTP
// distributor's name matching. Unlike HTTP it also runs for admin-pinned
// requests: a persistent connection keeps serving the model after selection.
func checkResponsesWSModelAccess(c *gin.Context, modelName string) *types.NewAPIError {
	if !common.GetContextKeyBool(c, constant.ContextKeyTokenModelLimitEnabled) {
		return nil
	}
	raw, ok := common.GetContextKey(c, constant.ContextKeyTokenModelLimit)
	if !ok {
		return types.NewErrorWithStatusCode(errors.New(i18n.T(c, i18n.MsgDistributorTokenNoModelAccess)), types.ErrorCodeAccessDenied, http.StatusForbidden, types.ErrOptionWithSkipRetry())
	}
	tokenModelLimit, _ := raw.(map[string]bool)
	if _, allowed := tokenModelLimit[ratio_setting.FormatMatchingModelName(modelName)]; !allowed {
		return types.NewErrorWithStatusCode(errors.New(i18n.T(c, i18n.MsgDistributorTokenModelForbidden, map[string]any{"Model": modelName})), types.ErrorCodeAccessDenied, http.StatusForbidden, types.ErrOptionWithSkipRetry())
	}
	return nil
}

// responsesWebSocketChannelSupports reports whether a channel can carry the
// native Responses WebSocket protocol for modelName. Events are forwarded
// without protocol conversion, so only native Responses upstreams qualify and
// an administrator must opt each channel in.
func responsesWebSocketChannelSupports(channel *model.Channel, modelName string) bool {
	if channel == nil || !channel.GetSetting().ResponsesWebSocketEnabled {
		return false
	}
	switch channel.Type {
	case constant.ChannelTypeOpenAI, constant.ChannelTypeCodex, constant.ChannelTypeSub2API,
		constant.ChannelTypeNewAPI, constant.ChannelTypeCodexProxy:
		return true
	case constant.ChannelTypeAdvancedCustom:
		route, ok := channel.GetOtherSettings().AdvancedCustom.MatchPathForModel(ResponsesWSRequestPath, modelName)
		return ok && route.IsNative()
	default:
		return false
	}
}

// selectResponsesWSChannel selects the channel for the first request of a
// connection: an admin-pinned channel, the affinity channel or a random
// channel of the request group that speaks the Responses WebSocket protocol.
func selectResponsesWSChannel(c *gin.Context, retry *service.RetryParam, attempt int) (*model.Channel, *types.NewAPIError) {
	modelName := retry.ModelName
	unavailable := func(message string) *types.NewAPIError {
		return types.NewErrorWithStatusCode(errors.New(message), types.ErrorCodeGetChannelFailed, http.StatusServiceUnavailable, types.ErrOptionWithSkipRetry())
	}
	var channel *model.Channel
	if pinned, ok := common.GetContextKey(c, constant.ContextKeyTokenSpecificChannelId); ok {
		if attempt > 0 {
			return nil, unavailable("the pinned channel cannot be retried")
		}
		id, err := strconv.Atoi(fmt.Sprint(pinned))
		if err != nil {
			return nil, newResponsesWSInvalidRequestError(errors.New(i18n.T(c, i18n.MsgDistributorInvalidChannelId)))
		}
		channel, err = model.GetChannelById(id, true)
		if err != nil {
			return nil, newResponsesWSInvalidRequestError(errors.New(i18n.T(c, i18n.MsgDistributorInvalidChannelId)))
		}
		if channel.Status != common.ChannelStatusEnabled {
			return nil, types.NewErrorWithStatusCode(errors.New(i18n.T(c, i18n.MsgDistributorChannelDisabled)), types.ErrorCodeGetChannelFailed, http.StatusForbidden, types.ErrOptionWithSkipRetry())
		}
		if !responsesWebSocketChannelSupports(channel, modelName) {
			return nil, types.NewErrorWithStatusCode(errors.New("the pinned channel does not support Responses WebSocket"), types.ErrorCodeGetChannelFailed, http.StatusBadRequest, types.ErrOptionWithSkipRetry())
		}
	}
	usingGroup := retry.TokenGroup
	if channel == nil && attempt == 0 {
		channel = preferredResponsesWSAffinityChannel(c, modelName, usingGroup)
	}
	if channel == nil {
		var selectGroup string
		var err error
		channel, selectGroup, err = service.CacheGetRandomSatisfiedChannel(retry)
		if err != nil || channel == nil {
			showGroup := usingGroup
			if usingGroup == "auto" {
				showGroup = fmt.Sprintf("auto(%s)", selectGroup)
			}
			return nil, unavailable(fmt.Sprintf("no Responses WebSocket channel is available for model %s in group %s", modelName, showGroup))
		}
	}
	if apiErr := middleware.SetupContextForSelectedChannel(c, channel, modelName); apiErr != nil {
		return nil, apiErr
	}
	return channel, nil
}

// preferredResponsesWSAffinityChannel applies the HTTP distributor's channel
// affinity rule, restricted to channels that support Responses WebSocket.
func preferredResponsesWSAffinityChannel(c *gin.Context, modelName string, usingGroup string) *model.Channel {
	preferredChannelID, found := service.GetPreferredChannelByAffinity(c, modelName, usingGroup)
	if !found {
		return nil
	}
	preferred, err := model.CacheGetChannel(preferredChannelID)
	if err == nil && preferred != nil && preferred.Status == common.ChannelStatusEnabled && responsesWebSocketChannelSupports(preferred, modelName) {
		if usingGroup != "auto" {
			if model.IsChannelEnabledForGroupModel(usingGroup, modelName, preferred.Id) {
				service.MarkChannelAffinityUsed(c, usingGroup, preferred.Id)
				return preferred
			}
		} else {
			userGroup := common.GetContextKeyString(c, constant.ContextKeyUserGroup)
			for _, group := range service.GetRequestAutoGroups(c, userGroup) {
				if model.IsChannelEnabledForGroupModel(group, modelName, preferred.Id) {
					common.SetContextKey(c, constant.ContextKeyAutoGroup, group)
					service.MarkChannelAffinityUsed(c, group, preferred.Id)
					return preferred
				}
			}
		}
	}
	if !service.ShouldKeepChannelAffinityOnChannelDisabled() {
		service.ClearCurrentChannelAffinityCache(c)
	}
	return nil
}
