package openai

import (
	"bytes"
	"context"
	"encoding/binary"
	"io"
	"net/http"
	"net/http/httptest"
	"os"
	"testing"
	"time"

	"github.com/dev-fan-sophon/boxai/constant"
	"github.com/dev-fan-sophon/boxai/dto"
	relaycommon "github.com/dev-fan-sophon/boxai/relay/common"
	"github.com/gin-gonic/gin"
	"github.com/stretchr/testify/assert"
	"github.com/stretchr/testify/require"
)

func TestTTSBinaryDeliveryBeforeUpstreamEOF(t *testing.T) {
	// One second of 24 kHz signed 16-bit mono PCM, split across a gate.
	pcm := bytes.Repeat([]byte{0x12, 0x34}, 24000)
	upstream, producer := io.Pipe()
	defer upstream.Close()
	defer producer.Close()
	release := make(chan struct{})
	defer close(release)
	produced := make(chan error, 1)
	go func() {
		_, err := producer.Write(pcm[:1000])
		if err == nil {
			<-release
			_, err = producer.Write(pcm[1000:])
		}
		producer.Close()
		produced <- err
	}()
	usageCh := make(chan *dto.Usage, 1)
	server := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		c, _ := gin.CreateTestContext(w)
		c.Request = r
		info := &relaycommon.RelayInfo{Request: &dto.AudioRequest{ResponseFormat: "pcm"}}
		info.SetEstimatePromptTokens(7)
		usageCh <- OpenaiTTSHandler(c, &http.Response{StatusCode: 200, Header: http.Header{"Content-Type": {"audio/pcm"}}, Body: upstream}, info)
	}))
	defer server.Close()
	// Also unblock a regressed read-all handler before waiting for server shutdown.
	defer upstream.Close()
	ctx, cancel := context.WithTimeout(context.Background(), 5*time.Second)
	defer cancel()
	req, err := http.NewRequestWithContext(ctx, http.MethodGet, server.URL, nil)
	require.NoError(t, err)
	response, err := server.Client().Do(req)
	require.NoError(t, err)
	defer response.Body.Close()
	first := make([]byte, 1000)
	_, err = io.ReadFull(response.Body, first)
	require.NoError(t, err, "first bytes must arrive while upstream EOF is gated")
	assert.Equal(t, pcm[:1000], first)
	release <- struct{}{}
	rest, err := io.ReadAll(response.Body)
	require.NoError(t, err)
	assert.Equal(t, pcm, append(first, rest...))
	require.NoError(t, <-produced)
	usage := <-usageCh
	assert.Equal(t, 7, usage.PromptTokensDetails.TextTokens)
	assert.Equal(t, 17, usage.CompletionTokens)
	assert.Equal(t, 17, usage.CompletionTokenDetails.AudioTokens)
	assert.Equal(t, 24, usage.TotalTokens)
}

func TestTTSBinaryProbeAndFallback(t *testing.T) {
	// Canonical PCM WAV header with one second of silence.
	wav := make([]byte, 44+48000)
	copy(wav, "RIFF")
	binary.LittleEndian.PutUint32(wav[4:], uint32(len(wav)-8))
	copy(wav[8:], "WAVEfmt ")
	binary.LittleEndian.PutUint32(wav[16:], 16)
	binary.LittleEndian.PutUint16(wav[20:], 1)
	binary.LittleEndian.PutUint16(wav[22:], 1)
	binary.LittleEndian.PutUint32(wav[24:], 24000)
	binary.LittleEndian.PutUint32(wav[28:], 48000)
	binary.LittleEndian.PutUint16(wav[32:], 2)
	binary.LittleEndian.PutUint16(wav[34:], 16)
	copy(wav[36:], "data")
	binary.LittleEndian.PutUint32(wav[40:], 48000)
	oldLimit := constant.MaxFileDownloadMB
	constant.MaxFileDownloadMB = 1
	t.Cleanup(func() { constant.MaxFileDownloadMB = oldLimit })
	for _, tc := range []struct {
		name    string
		body    []byte
		tokens  int
		noSpool bool
	}{
		{name: "wav duration", body: wav, tokens: 17},
		{name: "invalid wav fallback", body: make([]byte, 1001), tokens: 2},
		{name: "probe cap preserves delivery", body: make([]byte, (1<<20)+1), tokens: 1049},
		{name: "spool unavailable", body: wav, tokens: 49, noSpool: true},
	} {
		t.Run(tc.name, func(t *testing.T) {
			dir := t.TempDir()
			if tc.noSpool {
				t.Setenv("TMPDIR", dir+"/missing")
			} else {
				t.Setenv("TMPDIR", dir)
			}
			w := httptest.NewRecorder()
			c, _ := gin.CreateTestContext(w)
			c.Request = httptest.NewRequest(http.MethodGet, "/", nil)
			info := &relaycommon.RelayInfo{Request: &dto.AudioRequest{ResponseFormat: "wav"}}
			info.SetEstimatePromptTokens(7)
			usage := OpenaiTTSHandler(c, &http.Response{StatusCode: 200, Header: make(http.Header), Body: io.NopCloser(bytes.NewReader(tc.body))}, info)
			assert.Equal(t, tc.body, w.Body.Bytes())
			assert.Equal(t, tc.tokens, usage.CompletionTokens)
			assert.Equal(t, tc.tokens+7, usage.TotalTokens)
			entries, err := os.ReadDir(dir)
			require.NoError(t, err)
			assert.Empty(t, entries, "temporary audio must be removed")
		})
	}
}

func TestTTSBinaryInterruptedUpstream(t *testing.T) {
	for _, cancelRequest := range []bool{false, true} {
		t.Run(map[bool]string{false: "read failure", true: "cancellation"}[cancelRequest], func(t *testing.T) {
			dir := t.TempDir()
			t.Setenv("TMPDIR", dir)
			upstream, producer := io.Pipe()
			defer upstream.Close()
			defer producer.Close()
			ctx, cancel := context.WithCancel(context.Background())
			defer cancel()
			w := httptest.NewRecorder()
			c, _ := gin.CreateTestContext(w)
			c.Request = httptest.NewRequest(http.MethodGet, "/", nil).WithContext(ctx)
			info := &relaycommon.RelayInfo{Request: &dto.AudioRequest{ResponseFormat: "wav"}}
			info.SetEstimatePromptTokens(7)
			done := make(chan *dto.Usage, 1)
			go func() {
				done <- OpenaiTTSHandler(c, &http.Response{StatusCode: 200, Header: make(http.Header), Body: upstream}, info)
			}()
			_, err := producer.Write([]byte("partial audio"))
			require.NoError(t, err)
			if cancelRequest {
				cancel()
			} else {
				require.NoError(t, producer.CloseWithError(io.ErrUnexpectedEOF))
			}
			select {
			case usage := <-done:
				assert.Equal(t, 7, usage.TotalTokens, "interrupted upstream retains prompt-only accounting")
				assert.Zero(t, usage.CompletionTokens)
			case <-time.After(5 * time.Second):
				t.Fatal("handler did not stop after upstream interruption")
			}
			entries, err := os.ReadDir(dir)
			require.NoError(t, err)
			assert.Empty(t, entries)
		})
	}
}
