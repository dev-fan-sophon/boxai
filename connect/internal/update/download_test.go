package update

import (
	"context"
	"crypto/ed25519"
	"crypto/rand"
	"crypto/sha256"
	"encoding/base64"
	"encoding/hex"
	"encoding/json"
	"io"
	"net/http"
	"os"
	"path/filepath"
	"strings"
	"testing"

	"github.com/stretchr/testify/assert"
	"github.com/stretchr/testify/require"
)

type roundTripFunc func(*http.Request) (*http.Response, error)

func (f roundTripFunc) RoundTrip(r *http.Request) (*http.Response, error) { return f(r) }

func TestExactInstallerSignature(t *testing.T) {
	key, private, err := ed25519.GenerateKey(rand.Reader)
	require.NoError(t, err)
	body := []byte("installer bytes, not a digest")
	path := filepath.Join(t.TempDir(), "setup.exe")
	require.NoError(t, os.WriteFile(path, body, 0600))
	sig := ed25519.Sign(private, body)
	require.NoError(t, verifySignature(path, sig, key))
	hash := sha256.Sum256(body)
	assert.Error(t, verifySignature(path, ed25519.Sign(private, hash[:]), key), "signing the digest is incompatible")
	other, _, err := ed25519.GenerateKey(rand.Reader)
	require.NoError(t, err)
	assert.Error(t, verifySignature(path, sig, other))
	require.NoError(t, os.WriteFile(path, []byte("Installer bytes, not a digest"), 0600))
	assert.Error(t, verifySignature(path, sig, key), "same-sized tampering must fail")
	assert.Error(t, verifySignature(path, sig[:63], key))
}

func TestTrustedDownloadOriginsAndRedirects(t *testing.T) {
	require.NoError(t, trustedURL(Feed()))
	for _, raw := range []string{
		"http://dl.you-box.com/connect/a", "https://dl.you-box.com.evil.test/connect/a",
		"https://user@dl.you-box.com/connect/a", "https://dl.you-box.com:443/connect/a",
		"https://dl.you-box.com/desktop/a", "https://dl.you-box.com/connect/../desktop/a",
		"https://dl.you-box.com/connect/%2e%2e/a", "https://dl.you-box.com/connect/a?q=x",
		"https://dl.you-box.com/connect/a#x", "https://usemagpie.ai/api/latest",
	} {
		t.Run(raw, func(t *testing.T) {
			assert.Error(t, trustedURL(raw))
			req, err := http.NewRequest("GET", raw, nil)
			require.NoError(t, err)
			assert.Error(t, client.CheckRedirect(req, nil))
		})
	}
	t.Setenv("MAGPIE_UPDATE_FEED", "https://evil.test/feed")
	assert.Equal(t, "https://dl.you-box.com/connect/native-latest.json", Feed())
}

func TestDownloadRejectsTamperingAndRemovesBytes(t *testing.T) {
	body := "not signed by BoxAI"
	digest := sha256.Sum256([]byte(body))
	a := Asset{URL: "https://dl.you-box.com/connect/2.0.0/setup.exe", Size: int64(len(body)), SHA256: hex.EncodeToString(digest[:]), Signature: base64.StdEncoding.EncodeToString(make([]byte, 64))}
	old := client.Transport
	t.Cleanup(func() { client.Transport = old })
	calls := 0
	client.Transport = roundTripFunc(func(req *http.Request) (*http.Response, error) {
		calls++
		return &http.Response{StatusCode: 200, Body: io.NopCloser(strings.NewReader(body)), ContentLength: int64(len(body))}, nil
	})
	for _, mutate := range []func(*Asset){
		func(a *Asset) {}, // Correct checksum is not sufficient: signature fails.
		func(a *Asset) { a.Size++ },
		func(a *Asset) { a.SHA256 = strings.Repeat("0", 64) },
	} {
		asset := a
		mutate(&asset)
		path := filepath.Join(t.TempDir(), "setup.exe")
		assert.Error(t, fetch(context.Background(), asset, path))
		assert.NoFileExists(t, path)
		assert.NoFileExists(t, path+".signature")
	}
	a.URL = "https://evil.test/setup.exe"
	assert.Error(t, fetch(context.Background(), a, filepath.Join(t.TempDir(), "bad.exe")))
	assert.Equal(t, 3, calls, "wrong origin must be rejected before HTTP")
}

func TestLatestBoxAIFeedSchema(t *testing.T) {
	old := client.Transport
	t.Cleanup(func() { client.Transport = old })
	for _, tc := range []struct {
		name   string
		mutate func(*Release)
		valid  bool
	}{
		{"complete", func(r *Release) {}, true},
		{"missing platform", func(r *Release) { delete(r.Platforms, "win32-x64") }, false},
		{"unsigned", func(r *Release) { a := r.Platforms["darwin-arm64"]; a.Signature = ""; r.Platforms["darwin-arm64"] = a }, false},
		{"upstream URL", func(r *Release) {
			a := r.Platforms["darwin-arm64"]
			a.URL = "https://github.com/yetone/magpie/releases/download/app.zip"
			r.Platforms["darwin-arm64"] = a
		}, false},
		{"different version artifact", func(r *Release) { r.Version = "2.0.1" }, false},
	} {
		t.Run(tc.name, func(t *testing.T) {
			r := Release{Version: "2.0.0", Platforms: map[string]Asset{}}
			for _, platform := range []string{"darwin-arm64", "win32-x64"} {
				r.Platforms[platform] = Asset{URL: "https://dl.you-box.com/connect/2.0.0/" + installerName("2.0.0", platform), Size: 42, SHA256: strings.Repeat("a", 64), Signature: base64.StdEncoding.EncodeToString(make([]byte, 64))}
			}
			tc.mutate(&r)
			data, err := json.Marshal(r)
			require.NoError(t, err)
			client.Transport = roundTripFunc(func(req *http.Request) (*http.Response, error) {
				assert.Equal(t, Feed(), req.URL.String())
				return &http.Response{StatusCode: 200, Body: io.NopCloser(strings.NewReader(string(data)))}, nil
			})
			got, err := Latest(context.Background())
			if tc.valid {
				require.NoError(t, err)
				assert.Equal(t, "2.0.0", got.Version)
				assert.Equal(t, Site, got.URL)
			} else {
				assert.Error(t, err)
			}
		})
	}
}
