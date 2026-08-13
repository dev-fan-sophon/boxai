package channel

import (
	"bytes"
	"context"
	"crypto/tls"
	"fmt"
	"io"
	"net"
	"net/http"
	"net/http/httptest"
	"reflect"
	"sync/atomic"
	"testing"
	"time"

	basecommon "github.com/dev-fan-sophon/boxai/common"
	relaycommon "github.com/dev-fan-sophon/boxai/relay/common"
	"github.com/dev-fan-sophon/boxai/service"
	"github.com/gin-gonic/gin"
	"github.com/stretchr/testify/assert"
	"github.com/stretchr/testify/require"
	"golang.org/x/net/http2"
	"golang.org/x/net/http2/hpack"
)

func TestApplyUpstreamBodyMetadataSetsReplayableMetadata(t *testing.T) {
	payload := []byte(`{"model":"test-model","messages":[{"role":"user","content":"hi"}]}`)
	body, closer, err := relaycommon.NewOutboundJSONBody(payload)
	require.NoError(t, err)
	defer closer.Close()

	req, err := http.NewRequest(http.MethodPost, "https://example.com/v1/chat/completions", body)
	require.NoError(t, err)
	assert.Nil(t, req.GetBody)
	assert.Zero(t, req.ContentLength)

	ApplyUpstreamBodyMetadata(req, body)
	assert.EqualValues(t, len(payload), req.ContentLength)
	require.NotNil(t, req.GetBody)

	sent, err := io.ReadAll(req.Body)
	require.NoError(t, err)
	assert.Equal(t, payload, sent)
	for range 2 {
		replayBody, err := req.GetBody()
		require.NoError(t, err)
		replay, err := io.ReadAll(replayBody)
		require.NoError(t, err)
		require.NoError(t, replayBody.Close())
		assert.Equal(t, payload, replay)
	}
}

func TestApplyUpstreamBodyMetadataHidesRawStorageCloser(t *testing.T) {
	payload := []byte("raw storage")
	storage, err := basecommon.CreateBodyStorage(payload)
	require.NoError(t, err)
	defer storage.Close()

	req, err := http.NewRequest(http.MethodPost, "https://example.com", storage)
	require.NoError(t, err)
	_, exposesStorage := req.Body.(basecommon.BodyStorage)
	require.True(t, exposesStorage)

	ApplyUpstreamBodyMetadata(req, storage)
	_, exposesStorage = req.Body.(basecommon.BodyStorage)
	assert.False(t, exposesStorage)
	require.NoError(t, req.Body.Close())

	replayBody, err := req.GetBody()
	require.NoError(t, err)
	replay, err := io.ReadAll(replayBody)
	require.NoError(t, err)
	require.NoError(t, replayBody.Close())
	assert.Equal(t, payload, replay)
}

type replayH2Result struct {
	err      error
	attempts [][]byte
}

func runReplayH2Server(listener net.Listener) <-chan replayH2Result {
	resultCh := make(chan replayH2Result, 1)
	go func() {
		result := replayH2Result{}
		defer func() { resultCh <- result }()

		conn, err := listener.Accept()
		if err != nil {
			result.err = err
			return
		}
		defer conn.Close()
		_ = conn.SetDeadline(time.Now().Add(10 * time.Second))

		preface := make([]byte, len(http2.ClientPreface))
		if _, err := io.ReadFull(conn, preface); err != nil {
			result.err = err
			return
		}
		framer := http2.NewFramer(conn, conn)
		framer.ReadMetaHeaders = hpack.NewDecoder(4096, nil)
		if err := framer.WriteSettings(); err != nil {
			result.err = err
			return
		}

		for attempt := 0; attempt < 2; attempt++ {
			streamID, body, err := readReplayH2Request(framer)
			if err != nil {
				result.err = err
				return
			}
			result.attempts = append(result.attempts, body)
			if attempt == 0 {
				if err := framer.WriteRSTStream(streamID, http2.ErrCodeRefusedStream); err != nil {
					result.err = err
					return
				}
				continue
			}

			var header bytes.Buffer
			encoder := hpack.NewEncoder(&header)
			if err := encoder.WriteField(hpack.HeaderField{Name: ":status", Value: "200"}); err != nil {
				result.err = err
				return
			}
			if err := framer.WriteHeaders(http2.HeadersFrameParam{
				StreamID:      streamID,
				BlockFragment: header.Bytes(),
				EndHeaders:    true,
			}); err != nil {
				result.err = err
				return
			}
			result.err = framer.WriteData(streamID, true, []byte(`{}`))
		}
	}()
	return resultCh
}

func readReplayH2Request(framer *http2.Framer) (uint32, []byte, error) {
	var streamID uint32
	var body []byte
	for {
		frame, err := framer.ReadFrame()
		if err != nil {
			return 0, nil, fmt.Errorf("read frame: %w", err)
		}
		switch frame := frame.(type) {
		case *http2.SettingsFrame:
			if !frame.IsAck() {
				if err := framer.WriteSettingsAck(); err != nil {
					return 0, nil, err
				}
			}
		case *http2.MetaHeadersFrame:
			streamID = frame.Header().StreamID
			if frame.StreamEnded() {
				return streamID, body, nil
			}
		case *http2.DataFrame:
			if streamID == 0 {
				streamID = frame.Header().StreamID
			}
			if frame.Header().StreamID != streamID {
				continue
			}
			body = append(body, frame.Data()...)
			if frame.StreamEnded() {
				return streamID, body, nil
			}
		}
	}
}

func TestReplayableBodyRetriesCompletePayloadAfterHTTP2Reset(t *testing.T) {
	payload := []byte(`{"model":"test-model","messages":[{"role":"user","content":"retry me"}]}`)
	listener, err := net.Listen("tcp", "127.0.0.1:0")
	require.NoError(t, err)
	defer listener.Close()
	resultCh := runReplayH2Server(listener)

	transport := &http2.Transport{
		AllowHTTP: true,
		DialTLSContext: func(ctx context.Context, network, _ string, _ *tls.Config) (net.Conn, error) {
			return (&net.Dialer{}).DialContext(ctx, network, listener.Addr().String())
		},
	}
	defer transport.CloseIdleConnections()
	client := &http.Client{Transport: transport, Timeout: 10 * time.Second}

	body, closer, err := relaycommon.NewOutboundJSONBody(payload)
	require.NoError(t, err)
	defer closer.Close()
	req, err := http.NewRequest(http.MethodPost, "http://upstream.test/v1/chat/completions", body)
	require.NoError(t, err)
	ApplyUpstreamBodyMetadata(req, body)

	resp, err := client.Do(req)
	require.NoError(t, err)
	require.NoError(t, resp.Body.Close())
	assert.Equal(t, http.StatusOK, resp.StatusCode)

	select {
	case result := <-resultCh:
		require.NoError(t, result.err)
		require.Len(t, result.attempts, 2)
		assert.Equal(t, payload, result.attempts[0])
		assert.Equal(t, payload, result.attempts[1])
	case <-time.After(15 * time.Second):
		t.Fatal("timed out waiting for HTTP/2 server")
	}
}

type replayTestTaskAdaptor struct {
	TaskAdaptor
	baseURL     string
	capturedReq *http.Request
}

func (a *replayTestTaskAdaptor) BuildRequestURL(*relaycommon.RelayInfo) (string, error) {
	return a.baseURL, nil
}

func (a *replayTestTaskAdaptor) BuildRequestHeader(_ *gin.Context, req *http.Request, _ *relaycommon.RelayInfo) error {
	a.capturedReq = req
	return nil
}

func TestDoTaskApiRequestKeepsNativeGetBody(t *testing.T) {
	service.InitHttpClient()
	payload := []byte(`{"model":"test-model","prompt":"hello"}`)
	server := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		got, err := io.ReadAll(r.Body)
		require.NoError(t, err)
		assert.Equal(t, payload, got)
		w.WriteHeader(http.StatusOK)
	}))
	defer server.Close()

	c, _ := gin.CreateTestContext(httptest.NewRecorder())
	c.Request = httptest.NewRequest(http.MethodPost, "/v1/video/generations", bytes.NewReader(payload))
	info := &relaycommon.RelayInfo{ChannelMeta: &relaycommon.ChannelMeta{}}
	adaptor := &replayTestTaskAdaptor{baseURL: server.URL}

	resp, err := DoTaskApiRequest(adaptor, c, info, bytes.NewReader(payload))
	require.NoError(t, err)
	defer resp.Body.Close()

	require.NotNil(t, adaptor.capturedReq.GetBody)
	for range 2 {
		replayBody, err := adaptor.capturedReq.GetBody()
		require.NoError(t, err)
		replay, err := io.ReadAll(replayBody)
		require.NoError(t, err)
		require.NoError(t, replayBody.Close())
		assert.Equal(t, payload, replay)
	}
}

func TestDoRequestReturnsUpstreamRedirectWithoutFollowing(t *testing.T) {
	service.InitHttpClient()
	sharedClient := service.GetHttpClient()
	require.NotNil(t, sharedClient)
	require.NotNil(t, sharedClient.CheckRedirect)
	originalPolicy := reflect.ValueOf(sharedClient.CheckRedirect).Pointer()

	var targetRequests atomic.Int32
	target := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, _ *http.Request) {
		targetRequests.Add(1)
		w.WriteHeader(http.StatusTeapot)
	}))
	defer target.Close()

	for _, status := range []int{301, 302, 303, 307, 308} {
		t.Run(http.StatusText(status), func(t *testing.T) {
			targetRequests.Store(0)
			source := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, _ *http.Request) {
				w.Header().Set("Location", target.URL)
				w.WriteHeader(status)
				_, _ = io.WriteString(w, "redirect response")
			}))

			c, _ := gin.CreateTestContext(httptest.NewRecorder())
			c.Request = httptest.NewRequest(http.MethodPost, "/relay", nil)
			req, err := http.NewRequest(http.MethodPost, source.URL, bytes.NewReader([]byte("body")))
			require.NoError(t, err)
			resp, err := doRequest(c, req, &relaycommon.RelayInfo{ChannelMeta: &relaycommon.ChannelMeta{}})
			require.NoError(t, err)
			require.NoError(t, resp.Body.Close())
			source.Close()

			assert.Equal(t, status, resp.StatusCode)
			assert.Zero(t, targetRequests.Load())
		})
	}
	assert.Equal(t, originalPolicy, reflect.ValueOf(sharedClient.CheckRedirect).Pointer())
}
