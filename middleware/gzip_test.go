package middleware

import (
	"bytes"
	"compress/gzip"
	"errors"
	"io"
	"net/http"
	"net/http/httptest"
	"testing"

	"github.com/andybalholm/brotli"
	"github.com/dev-fan-sophon/boxai/constant"
	"github.com/gin-gonic/gin"
	"github.com/klauspost/compress/zstd"
	"github.com/stretchr/testify/assert"
	"github.com/stretchr/testify/require"
)

func TestDecompressRequestMiddlewareSupportsRequestEncodings(t *testing.T) {
	payload := []byte(`{"model":"gpt-test","input":"hello"}`)
	tests := []struct {
		name     string
		encoding string
		encode   func(*testing.T, []byte) []byte
	}{
		{name: "uncompressed", encode: func(_ *testing.T, payload []byte) []byte { return payload }},
		{name: "gzip", encoding: "gzip", encode: gzipTestEncode},
		{name: "brotli", encoding: "br", encode: brotliTestEncode},
		{name: "zstd", encoding: "zstd", encode: zstdTestEncode},
		{name: "zstd case insensitive", encoding: " ZSTD ", encode: zstdTestEncode},
	}

	for _, tt := range tests {
		t.Run(tt.name, func(t *testing.T) {
			encoded := tt.encode(t, payload)
			body, seenEncoding, seenLength, status := runDecompressionRequest(t, tt.encoding, encoded)
			require.Equal(t, http.StatusOK, status)
			assert.Equal(t, payload, body)
			assert.Zero(t, seenEncoding)
			assert.Equal(t, int64(len(encoded)), seenLength)
		})
	}
}

func TestDecompressRequestMiddlewareRejectsOversizedDecompressedBodies(t *testing.T) {
	oldLimit := constant.MaxRequestBodyMB
	constant.MaxRequestBodyMB = 1
	t.Cleanup(func() { constant.MaxRequestBodyMB = oldLimit })

	payload := bytes.Repeat([]byte("a"), (1<<20)+1)
	tests := []struct {
		name     string
		encoding string
		encode   func(*testing.T, []byte) []byte
	}{
		{name: "uncompressed", encode: func(_ *testing.T, payload []byte) []byte { return payload }},
		{name: "gzip", encoding: "gzip", encode: gzipTestEncode},
		{name: "brotli", encoding: "br", encode: brotliTestEncode},
		{name: "zstd zip bomb", encoding: "zstd", encode: zstdTestEncode},
	}

	for _, tt := range tests {
		t.Run(tt.name, func(t *testing.T) {
			compressed := tt.encode(t, payload)
			if tt.encoding == "zstd" {
				assert.Less(t, len(compressed), len(payload)/100)
			}
			_, _, _, status := runDecompressionRequest(t, tt.encoding, compressed)
			assert.Equal(t, http.StatusRequestEntityTooLarge, status)
		})
	}
}

func TestDecompressRequestMiddlewareRejectsMalformedCompressedBodies(t *testing.T) {
	validZstd := zstdTestEncode(t, []byte("payload that must pass checksum validation"))
	require.Greater(t, len(validZstd), 8)

	tests := []struct {
		name     string
		encoding string
		body     []byte
	}{
		{name: "invalid gzip header", encoding: "gzip", body: []byte("not gzip")},
		{name: "invalid zstd frame", encoding: "zstd", body: []byte("not zstd")},
		{name: "truncated zstd frame", encoding: "zstd", body: validZstd[:len(validZstd)-4]},
	}

	for _, tt := range tests {
		t.Run(tt.name, func(t *testing.T) {
			_, _, _, status := runDecompressionRequest(t, tt.encoding, tt.body)
			assert.Equal(t, http.StatusBadRequest, status)
		})
	}
}

func TestDecompressRequestMiddlewarePreservesUnsupportedEncoding(t *testing.T) {
	body := []byte("encoded bytes")
	got, seenEncoding, seenLength, status := runDecompressionRequest(t, "deflate", body)

	require.Equal(t, http.StatusOK, status)
	assert.Equal(t, body, got)
	assert.Equal(t, "deflate", seenEncoding)
	assert.Equal(t, int64(len(body)), seenLength)
}

func runDecompressionRequest(t *testing.T, encoding string, body []byte) ([]byte, string, int64, int) {
	t.Helper()
	gin.SetMode(gin.TestMode)

	var got []byte
	var seenEncoding string
	var seenLength int64
	router := gin.New()
	router.Use(DecompressRequestMiddleware())
	router.POST("/relay", func(c *gin.Context) {
		seenEncoding = c.GetHeader("Content-Encoding")
		seenLength = c.Request.ContentLength
		defer c.Request.Body.Close()

		var err error
		got, err = io.ReadAll(c.Request.Body)
		if err != nil {
			var maxBytesErr *http.MaxBytesError
			if errors.As(err, &maxBytesErr) {
				c.Status(http.StatusRequestEntityTooLarge)
				return
			}
			c.Status(http.StatusBadRequest)
			return
		}
		c.Status(http.StatusOK)
	})

	request := httptest.NewRequest(http.MethodPost, "/relay", bytes.NewReader(body))
	request.Header.Set("Content-Type", "application/json")
	if encoding != "" {
		request.Header.Set("Content-Encoding", encoding)
	}
	recorder := httptest.NewRecorder()
	router.ServeHTTP(recorder, request)
	return got, seenEncoding, seenLength, recorder.Code
}

func gzipTestEncode(t *testing.T, payload []byte) []byte {
	t.Helper()
	var compressed bytes.Buffer
	writer := gzip.NewWriter(&compressed)
	_, err := writer.Write(payload)
	require.NoError(t, err)
	require.NoError(t, writer.Close())
	return compressed.Bytes()
}

func brotliTestEncode(t *testing.T, payload []byte) []byte {
	t.Helper()
	var compressed bytes.Buffer
	writer := brotli.NewWriter(&compressed)
	_, err := writer.Write(payload)
	require.NoError(t, err)
	require.NoError(t, writer.Close())
	return compressed.Bytes()
}

func zstdTestEncode(t *testing.T, payload []byte) []byte {
	t.Helper()
	var compressed bytes.Buffer
	writer, err := zstd.NewWriter(&compressed)
	require.NoError(t, err)
	_, err = writer.Write(payload)
	require.NoError(t, err)
	require.NoError(t, writer.Close())
	return compressed.Bytes()
}
