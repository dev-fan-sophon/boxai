package helper

import (
	"context"
	"net/http"
	"net/http/httptest"
	"strings"
	"sync"
	"testing"
	"time"

	"github.com/gin-gonic/gin"
	"github.com/stretchr/testify/assert"
	"github.com/stretchr/testify/require"
)

// pingRecorder is a goroutine-safe response recorder that reports each write.
type pingRecorder struct {
	mu     sync.Mutex
	header http.Header
	body   strings.Builder
	status int
	writes chan struct{}
}

func newPingRecorder() *pingRecorder {
	return &pingRecorder{header: http.Header{}, writes: make(chan struct{}, 64)}
}

func (r *pingRecorder) Header() http.Header { return r.header }

func (r *pingRecorder) WriteHeader(status int) {
	r.mu.Lock()
	defer r.mu.Unlock()
	if r.status == 0 {
		r.status = status
	}
}

func (r *pingRecorder) Write(data []byte) (int, error) {
	r.mu.Lock()
	if r.status == 0 {
		r.status = http.StatusOK
	}
	n, err := r.body.Write(data)
	r.mu.Unlock()
	select {
	case r.writes <- struct{}{}:
	default:
	}
	return n, err
}

func (r *pingRecorder) Flush() {}

func (r *pingRecorder) Body() string {
	r.mu.Lock()
	defer r.mu.Unlock()
	return r.body.String()
}

func waitForWrite(t *testing.T, recorder *pingRecorder) {
	t.Helper()
	select {
	case <-recorder.writes:
	case <-time.After(5 * time.Second):
		t.Fatal("keepalive never pinged")
	}
}

func newKeepAliveContext(t *testing.T, recorder *pingRecorder) *gin.Context {
	t.Helper()
	c, _ := gin.CreateTestContext(recorder)
	c.Request = httptest.NewRequest(http.MethodPost, "/v1/messages", nil)
	return c
}

func TestStreamKeepAliveHandsOverOnFirstRelayWrite(t *testing.T) {
	recorder := newPingRecorder()
	c := newKeepAliveContext(t, recorder)
	stop := StartStreamKeepAlive(c, time.Millisecond)
	defer stop()
	assert.Equal(t, "text/event-stream", recorder.Header().Get("Content-Type"))

	waitForWrite(t, recorder)
	assert.True(t, StreamResponseCommitted(c), "a ping commits the stream headers")
	assert.False(t, c.Writer.Written(), "pings are not relay output, so the request can still be retried")
	// A nested request reuses the running keepalive and cannot end it.
	StartStreamKeepAlive(c, time.Millisecond)()
	waitForWrite(t, recorder)

	_, err := c.Writer.WriteString("data: hello\n\n")
	require.NoError(t, err)
	assert.True(t, c.Writer.Written())
	body := recorder.Body()
	assert.True(t, strings.HasPrefix(body, ": PING\n\n"), body)
	assert.True(t, strings.HasSuffix(body, "data: hello\n\n"), "no ping may follow the handover: %q", body)
}

func TestStreamKeepAliveStopsWhenHandlerEditsHeaders(t *testing.T) {
	recorder := newPingRecorder()
	c := newKeepAliveContext(t, recorder)
	stop := StartStreamKeepAlive(c, time.Hour)
	defer stop()

	c.Writer.Header().Set("X-Upstream", "1")
	StopStreamKeepAlive(c)
	assert.False(t, StreamResponseCommitted(c))
	assert.Empty(t, recorder.Body())
}

func TestStreamKeepAliveStopsOnClientCancellation(t *testing.T) {
	recorder := newPingRecorder()
	c := newKeepAliveContext(t, recorder)
	requestContext, cancel := context.WithCancel(context.Background())
	c.Request = c.Request.WithContext(requestContext)
	stop := StartStreamKeepAlive(c, time.Hour)
	cancel()
	stopped := make(chan struct{})
	go func() {
		stop()
		close(stopped)
	}()
	select {
	case <-stopped:
	case <-time.After(5 * time.Second):
		t.Fatal("keepalive did not stop after client cancellation")
	}
	_, err := c.Writer.WriteString("data: done\n\n")
	require.NoError(t, err)
	assert.Equal(t, "data: done\n\n", recorder.Body())
}

func TestStreamKeepAliveRestartsAfterAFinishedOne(t *testing.T) {
	recorder := newPingRecorder()
	c := newKeepAliveContext(t, recorder)
	StartStreamKeepAlive(c, time.Hour)()
	stop := StartStreamKeepAlive(c, time.Millisecond)
	defer stop()
	waitForWrite(t, recorder)
	assert.Contains(t, recorder.Body(), ": PING\n\n")
}
