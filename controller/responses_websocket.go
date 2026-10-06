package controller

import (
	"bytes"
	"context"
	"errors"
	"net"
	"net/http"
	"sync"
	"time"

	"github.com/dev-fan-sophon/boxai/common"
	"github.com/dev-fan-sophon/boxai/constant"
	"github.com/dev-fan-sophon/boxai/middleware"
	"github.com/dev-fan-sophon/boxai/relay"
	"github.com/dev-fan-sophon/boxai/types"

	"github.com/gin-gonic/gin"
	"github.com/gorilla/websocket"
)

type responsesWSRequestContextKey struct{}

type responsesWSRequestState struct {
	requestID string
	handle    func(*gin.Context) *types.NewAPIError
	apiError  *types.NewAPIError
}

// Each response.create runs the ordinary token authentication and request
// limiter to completion, without routing another HTTP request or retaining a
// pooled Gin context between turns.
var responsesWSRequestEngine = sync.OnceValue(func() *gin.Engine {
	engine := gin.New()
	engine.ForwardedByClientIP = false
	_ = engine.SetTrustedProxies(nil)
	engine.POST(relay.ResponsesWSRequestPath, func(c *gin.Context) {
		state := c.Request.Context().Value(responsesWSRequestContextKey{}).(*responsesWSRequestState)
		c.Set(common.RequestIdKey, state.requestID)
		common.SetContextKey(c, constant.ContextKeyRequestStartTime, time.Now())
		c.Next()
	}, middleware.BodyStorageCleanup(), middleware.TokenAuth(), middleware.ModelRequestRateLimit(), func(c *gin.Context) {
		state := c.Request.Context().Value(responsesWSRequestContextKey{}).(*responsesWSRequestState)
		state.apiError = state.handle(c)
		if state.apiError != nil {
			status := state.apiError.StatusCode
			if status < http.StatusBadRequest {
				status = http.StatusInternalServerError
			}
			c.Status(status)
		}
	})
	return engine
})

type responsesWSResponseWriter struct {
	header http.Header
	status int
	body   bytes.Buffer
}

func (w *responsesWSResponseWriter) Header() http.Header {
	return w.header
}

func (w *responsesWSResponseWriter) WriteHeader(status int) {
	if w.status == 0 {
		w.status = status
	}
}

func (w *responsesWSResponseWriter) Write(data []byte) (int, error) {
	w.WriteHeader(http.StatusOK)
	// Middleware rejections are small JSON errors; never buffer more.
	if w.body.Len() < 64<<10 {
		w.body.Write(data)
	}
	return len(data), nil
}

func newResponsesWSRequestRunner(c *gin.Context) relay.ResponsesWSRequestRunner {
	// Capture credentials before channel selection or header overrides, and
	// resolve the peer once with the public router's trusted-proxy rules.
	headers := c.Request.Header.Clone()
	for _, name := range []string{"Connection", "Upgrade", "Sec-WebSocket-Key", "Sec-WebSocket-Version", "Sec-WebSocket-Extensions", "Sec-WebSocket-Protocol", "Content-Length", "Content-Encoding"} {
		headers.Del(name)
	}
	remoteAddr := net.JoinHostPort(common.RealClientIP(c), "0")
	return func(request *http.Request, requestID string, handle func(*gin.Context) *types.NewAPIError) *types.NewAPIError {
		state := &responsesWSRequestState{requestID: requestID, handle: handle}
		ctx := context.WithValue(request.Context(), responsesWSRequestContextKey{}, state)
		request = request.Clone(ctx)
		request.Method = http.MethodPost
		request.URL.Path = relay.ResponsesWSRequestPath
		request.URL.RawPath = ""
		request.URL.RawQuery = ""
		request.RequestURI = relay.ResponsesWSRequestPath
		request.Header = headers.Clone()
		request.Header.Set("Content-Type", "application/json")
		request.RemoteAddr = remoteAddr
		response := &responsesWSResponseWriter{header: make(http.Header)}
		responsesWSRequestEngine().ServeHTTP(response, request)
		if state.apiError != nil {
			return state.apiError
		}
		if response.status < http.StatusBadRequest {
			return nil
		}
		var body struct {
			Error *types.OpenAIError `json:"error"`
		}
		if common.Unmarshal(response.body.Bytes(), &body) == nil && body.Error != nil {
			return types.WithOpenAIError(*body.Error, response.status, types.ErrOptionWithSkipRetry(), types.ErrOptionWithNoRecordErrorLog())
		}
		// The in-memory request limiter answers with a bare 429.
		return types.NewErrorWithStatusCode(errors.New(http.StatusText(response.status)), types.ErrorCodeInvalidRequest, response.status, types.ErrOptionWithSkipRetry(), types.ErrOptionWithNoRecordErrorLog())
	}
}

// responsesWSUpgrader accepts the Responses subprotocol so browser clients
// that authenticate through Sec-WebSocket-Protocol get a protocol back.
var responsesWSUpgrader = websocket.Upgrader{
	Subprotocols: []string{"responses", "realtime"},
	CheckOrigin: func(r *http.Request) bool {
		return true
	},
}

// ResponsesWebSocket serves GET /v1/responses as a persistent Responses
// WebSocket. The handshake is already token-authenticated; every
// response.create is then authenticated, limited, routed and billed again.
func ResponsesWebSocket(c *gin.Context) {
	runner := newResponsesWSRequestRunner(c)
	ws, err := responsesWSUpgrader.Upgrade(c.Writer, c.Request, nil)
	if err != nil {
		return
	}
	defer ws.Close()
	relay.ResponsesWebSocketHelper(c, ws, runner, relay.ResponsesWSChannelPolicy{
		ShouldRetry:    shouldRetry,
		OnChannelError: processChannelError,
	})
}
