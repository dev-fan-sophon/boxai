package middleware

import (
	"net/http"
	"strings"
	"sync"
	"time"

	"github.com/bytedance/gopkg/util/gopool"
	"github.com/dev-fan-sophon/boxai/common"
	"github.com/gin-gonic/gin"
	"github.com/tidwall/gjson"
)

// ResponseKeepaliveHeader asks for keepalive pings from the first interval
// instead of only after the route's idle delay. Callers must accept a 200
// response whose body carries {"error": ...}.
const ResponseKeepaliveHeader = "X-BoxAI-Keepalive"

// ResponseKeepalive keeps a slow non-streaming JSON response alive behind an
// edge proxy that closes idle origin connections (Cloudflare Free cuts after
// 125 seconds without a byte). When the handler has produced no response after
// idle, it commits a 200 JSON header and writes one space per interval; JSON
// parsers ignore the leading whitespace. Any later status is then reported
// only in the body. Streaming and non-JSON requests are left untouched, and
// idle 0 limits the route to requests that opt in with the header.
func ResponseKeepalive(idle, interval time.Duration) gin.HandlerFunc {
	return func(c *gin.Context) {
		start := idle
		if c.GetHeader(ResponseKeepaliveHeader) == "1" {
			start = interval
		}
		if start <= 0 || !isNonStreamingJSONRequest(c) {
			c.Next()
			return
		}
		original := c.Writer
		writer := &keepaliveWriter{ResponseWriter: original, header: original.Header().Clone()}
		c.Writer = writer
		done := make(chan struct{})
		stopped := make(chan struct{})
		gopool.Go(func() {
			defer close(stopped)
			timer := time.NewTimer(start)
			defer timer.Stop()
			for {
				select {
				case <-done:
					return
				case <-c.Request.Context().Done():
					return
				case <-timer.C:
					if !writer.ping() {
						return
					}
					timer.Reset(interval)
				}
			}
		})
		c.Next()
		close(done)
		<-stopped
		// gin writes a status-only response after the handlers return.
		writer.syncHeader()
		c.Writer = original
	}
}

// isNonStreamingJSONRequest reports whether the response will be a single JSON
// document: a JSON body without "stream": true, outside Gemini's streaming
// actions. Multipart bodies are skipped because their stream flag would need a
// full form parse here.
func isNonStreamingJSONRequest(c *gin.Context) bool {
	if !strings.HasPrefix(c.GetHeader("Content-Type"), "application/json") {
		return false
	}
	if strings.Contains(c.Request.URL.Path, ":streamGenerateContent") || c.Query("alt") == "sse" {
		return false
	}
	storage, err := common.GetBodyStorage(c)
	if err != nil {
		return false
	}
	body, err := storage.Bytes()
	if err != nil {
		return false
	}
	return !gjson.GetBytes(body, "stream").Bool()
}

// keepaliveWriter serializes keepalive pings with the handler's response. The
// handler edits a private header map that is copied to the connection when it
// responds, so pings never race its header writes. Written reports only
// handler output, so relay retries still run while pings are flowing.
type keepaliveWriter struct {
	gin.ResponseWriter
	header       http.Header
	mu           sync.Mutex
	committed    bool
	handlerWrote bool
}

func (w *keepaliveWriter) ping() bool {
	w.mu.Lock()
	defer w.mu.Unlock()
	if w.handlerWrote {
		return false
	}
	if !w.committed {
		header := w.ResponseWriter.Header()
		header.Set("Content-Type", "application/json; charset=utf-8")
		header.Set("Cache-Control", "no-cache, no-transform")
		header.Set("X-Accel-Buffering", "no")
		header.Del("Content-Length")
		w.ResponseWriter.WriteHeader(http.StatusOK)
		w.committed = true
	}
	if _, err := w.ResponseWriter.Write([]byte(" ")); err != nil {
		return false
	}
	w.ResponseWriter.Flush()
	return true
}

// syncHeader copies the handler's headers to the connection until the
// keepalive has already sent its own. Callers hold mu or have stopped pings.
func (w *keepaliveWriter) syncHeader() {
	if w.committed {
		return
	}
	target := w.ResponseWriter.Header()
	for key := range target {
		if _, ok := w.header[key]; !ok {
			delete(target, key)
		}
	}
	for key, values := range w.header {
		target[key] = values
	}
}

func (w *keepaliveWriter) Header() http.Header {
	return w.header
}

// WriteHeader only records the status, as in gin, until the body is written.
func (w *keepaliveWriter) WriteHeader(code int) {
	w.mu.Lock()
	defer w.mu.Unlock()
	if !w.committed {
		w.ResponseWriter.WriteHeader(code)
	}
}

func (w *keepaliveWriter) WriteHeaderNow() {
	w.mu.Lock()
	defer w.mu.Unlock()
	w.handlerWrote = true
	w.syncHeader()
	if !w.committed {
		w.ResponseWriter.WriteHeaderNow()
	}
}

func (w *keepaliveWriter) Write(data []byte) (int, error) {
	w.mu.Lock()
	defer w.mu.Unlock()
	w.handlerWrote = true
	w.syncHeader()
	return w.ResponseWriter.Write(data)
}

func (w *keepaliveWriter) WriteString(s string) (int, error) {
	w.mu.Lock()
	defer w.mu.Unlock()
	w.handlerWrote = true
	w.syncHeader()
	return w.ResponseWriter.WriteString(s)
}

func (w *keepaliveWriter) Flush() {
	w.mu.Lock()
	defer w.mu.Unlock()
	w.handlerWrote = true
	w.syncHeader()
	w.ResponseWriter.Flush()
}

func (w *keepaliveWriter) Written() bool {
	w.mu.Lock()
	defer w.mu.Unlock()
	return w.handlerWrote
}
