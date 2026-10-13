package middleware

import (
	"net/http"
	"sync"
	"time"

	"github.com/bytedance/gopkg/util/gopool"
	"github.com/gin-gonic/gin"
)

// ResponseKeepaliveHeader opts a non-streaming JSON request into keepalive.
// Callers must accept a 200 response whose body carries {"error": ...}.
const ResponseKeepaliveHeader = "X-BoxAI-Keepalive"

// ResponseKeepalive keeps a slow non-streaming JSON response alive behind an
// edge proxy that closes idle origin connections (Cloudflare Free cuts after
// 125 seconds without a byte). When the handler has not started its response
// by the first tick, it commits a 200 JSON header and writes one space per
// interval; JSON parsers ignore the leading whitespace. Later status codes
// become part of the body only, so callers read errors from the body.
func ResponseKeepalive(interval time.Duration) gin.HandlerFunc {
	return func(c *gin.Context) {
		if c.GetHeader(ResponseKeepaliveHeader) != "1" {
			c.Next()
			return
		}
		writer := &keepaliveWriter{ResponseWriter: c.Writer}
		c.Writer = writer
		done := make(chan struct{})
		stopped := make(chan struct{})
		gopool.Go(func() {
			defer close(stopped)
			ticker := time.NewTicker(interval)
			defer ticker.Stop()
			for {
				select {
				case <-done:
					return
				case <-c.Request.Context().Done():
					return
				case <-ticker.C:
					if !writer.ping() {
						return
					}
				}
			}
		})
		c.Next()
		close(done)
		<-stopped
	}
}

// keepaliveWriter serializes keepalive pings with the handler's response and
// reports Written only for handler output, so relay retries still run while
// pings are flowing.
type keepaliveWriter struct {
	gin.ResponseWriter
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
	if !w.committed {
		w.ResponseWriter.WriteHeaderNow()
	}
}

func (w *keepaliveWriter) Write(data []byte) (int, error) {
	w.mu.Lock()
	defer w.mu.Unlock()
	w.handlerWrote = true
	return w.ResponseWriter.Write(data)
}

func (w *keepaliveWriter) WriteString(s string) (int, error) {
	w.mu.Lock()
	defer w.mu.Unlock()
	w.handlerWrote = true
	return w.ResponseWriter.WriteString(s)
}

func (w *keepaliveWriter) Flush() {
	w.mu.Lock()
	defer w.mu.Unlock()
	w.ResponseWriter.Flush()
}

func (w *keepaliveWriter) Written() bool {
	w.mu.Lock()
	defer w.mu.Unlock()
	return w.handlerWrote
}
