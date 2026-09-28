package storage

import (
	"bytes"
	"context"
	"fmt"
	"io"
	"net/http"
	"net/http/httptest"
	"net/url"
	"strconv"
	"sync"
	"testing"

	"github.com/stretchr/testify/assert"
	"github.com/stretchr/testify/require"
)

func TestR2PublicURL(t *testing.T) {
	s := &r2Store{bucket: "boxai-playground", publicBase: "https://assets.you-box.com"}

	url, ok := s.PublicURL("public/42/a.png")
	require.True(t, ok)
	assert.Equal(t, "https://assets.you-box.com/public/42/a.png", url)

	url, ok = s.PublicURL("inspiration/hero/cover.webp")
	require.True(t, ok)
	assert.Equal(t, "https://assets.you-box.com/inspiration/hero/cover.webp", url)

	_, ok = s.PublicURL("uploads/42/a.png")
	assert.False(t, ok, "private prefixes are not public")

	_, ok = s.PublicURL("../etc/passwd")
	assert.False(t, ok, "invalid keys are not public")
}

func TestR2PublicURLWithoutBase(t *testing.T) {
	s := &r2Store{bucket: "boxai-playground"}
	_, ok := s.PublicURL("public/42/a.png")
	assert.False(t, ok)
}

func TestNewR2StoreRequiresConfig(t *testing.T) {
	t.Setenv("R2_ENDPOINT", "")
	t.Setenv("R2_BUCKET", "")
	t.Setenv("R2_ACCESS_KEY_ID", "")
	t.Setenv("R2_SECRET_ACCESS_KEY", "")
	_, err := newR2Store()
	assert.Error(t, err)
}

func TestR2UploadSnapshot(t *testing.T) {
	for _, tc := range []struct {
		name    string
		size    int64
		etag    string
		changed bool
		calls   []string
	}{
		{"200 MiB stays in R2", 200 << 20, `"original"`, false, []string{"HEAD", "PUT", "GET"}},
		{"actual size exceeds intent", (200 << 20) + 1, `"original"`, false, []string{"HEAD"}},
		{"missing version", 200 << 20, "", false, []string{"HEAD"}},
		{"upload replay before copy", 200 << 20, `"original"`, true, []string{"HEAD", "PUT"}},
	} {
		t.Run(tc.name, func(t *testing.T) {
			var mu sync.Mutex
			var calls []string
			header := bytes.Repeat([]byte{0x37}, 512)
			server := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
				mu.Lock()
				defer mu.Unlock()
				calls = append(calls, r.Method)
				switch r.Method {
				case http.MethodHead:
					assert.Equal(t, "/test-bucket/upload-intents/42/reference video.mp4", r.URL.Path)
					w.Header().Set("Content-Length", strconv.FormatInt(tc.size, 10))
					w.Header().Set("ETag", tc.etag)
				case http.MethodPut:
					assert.Equal(t, "/test-bucket/uploads/42/fixed", r.URL.Path)
					source, err := url.PathUnescape(r.Header.Get("X-Amz-Copy-Source"))
					assert.NoError(t, err)
					assert.Equal(t, "test-bucket/upload-intents/42/reference video.mp4", source)
					assert.Equal(t, `"original"`, r.Header.Get("X-Amz-Copy-Source-If-Match"))
					assert.Equal(t, "REPLACE", r.Header.Get("X-Amz-Metadata-Directive"))
					assert.Equal(t, "video/mp4", r.Header.Get("Content-Type"))
					body, err := io.ReadAll(r.Body)
					assert.NoError(t, err)
					assert.Empty(t, body, "copy must not upload file bytes")
					if tc.changed {
						w.WriteHeader(http.StatusPreconditionFailed)
						fmt.Fprint(w, `<Error><Code>PreconditionFailed</Code></Error>`)
						return
					}
					fmt.Fprint(w, `<CopyObjectResult><ETag>"fixed"</ETag></CopyObjectResult>`)
				case http.MethodGet:
					assert.Equal(t, "/test-bucket/uploads/42/fixed", r.URL.Path, "inspect destination, never the replayable source")
					assert.Equal(t, "bytes=0-511", r.Header.Get("Range"))
					w.Header().Set("Content-Range", "bytes 0-511/209715200")
					w.WriteHeader(http.StatusPartialContent)
					_, _ = w.Write(header)
				default:
					t.Errorf("unexpected storage request: %s", r.Method)
					w.WriteHeader(http.StatusBadRequest)
				}
			}))
			defer server.Close()
			t.Setenv("R2_ENDPOINT", server.URL)
			t.Setenv("R2_BUCKET", "test-bucket")
			t.Setenv("R2_ACCESS_KEY_ID", "test-key")
			t.Setenv("R2_SECRET_ACCESS_KEY", "test-secret")
			store, err := newR2Store()
			require.NoError(t, err)
			got, err := SnapshotUpload(context.Background(), store, "upload-intents/42/reference video.mp4", "uploads/42/fixed", 200<<20, "video/mp4")
			if len(tc.calls) == 3 {
				require.NoError(t, err)
				assert.Equal(t, header, got)
			} else {
				require.Error(t, err)
				assert.Nil(t, got)
			}
			mu.Lock()
			defer mu.Unlock()
			assert.Equal(t, tc.calls, calls)
		})
	}
}
