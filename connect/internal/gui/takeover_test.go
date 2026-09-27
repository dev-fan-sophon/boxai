package gui

import (
	"context"
	"net"
	"net/http"
	"testing"
	"time"

	"github.com/stretchr/testify/assert"
	"github.com/stretchr/testify/require"
	"github.com/yetone/magpie/internal/gateway"
)

// A magpie that found the gateway taken serves it once the one that had it
// is gone (one left running from before an update, a magpie serve).
func TestGatewayTakenOver(t *testing.T) {
	t.Setenv("HOME", t.TempDir())
	t.Setenv("XDG_CONFIG_HOME", t.TempDir())
	t.Setenv("XDG_CACHE_HOME", t.TempDir())
	ln, err := net.Listen("tcp", "127.0.0.1:0")
	require.NoError(t, err)
	t.Setenv("MAGPIE_ADDR", ln.Addr().String())
	other := &http.Server{Handler: http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		w.Write([]byte(`{"name":"magpie"}`))
	})}
	go other.Serve(ln)
	defer other.Close()
	defer served.Store(nil)
	ctx, cancel := context.WithCancel(context.Background())
	defer cancel()
	require.Nil(t, serveGateway(ctx), "must not replace a running gateway")
	done := make(chan struct{})
	go func() {
		defer close(done)
		watchGateway(ctx, 10*time.Millisecond)
	}()
	defer func() { cancel(); <-done }()
	assert.Nil(t, served.Load())
	require.NoError(t, other.Close())
	require.Eventually(t, func() bool { return served.Load() != nil && gateway.Running() }, 5*time.Second, 10*time.Millisecond)
	cancel()
	<-done
	require.Eventually(t, func() bool { return !gateway.Running() }, 5*time.Second, 10*time.Millisecond)
}
