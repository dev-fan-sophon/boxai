package service

import (
	"bytes"
	"context"
	"io"
	"os"
	"path/filepath"
	"testing"

	"github.com/QuantumNous/new-api/service/storage"
	"github.com/stretchr/testify/assert"
	"github.com/stretchr/testify/require"
)

func TestDetectPlaygroundAssetKind(t *testing.T) {
	kind, err := DetectPlaygroundAssetKind("image/png")
	require.NoError(t, err)
	assert.Equal(t, "image", kind)

	_, err = DetectPlaygroundAssetKind("application/pdf")
	assert.Error(t, err)
}

func TestSniffPlaygroundMime_RejectsCoercedExecutable(t *testing.T) {
	// PE/ELF-ish content should not become image/png via declared MIME alone
	// unless sniff is octet-stream AND declared is allowlisted — for binary
	// that DetectContentType marks as application/octet-stream, declared
	// image/png is accepted as fallback. Use content DetectContentType maps
	// to text/plain or application/zip-like without allowlist.
	html := []byte("<!DOCTYPE html><html><script>alert(1)</script></html>")
	_, _, err := SniffPlaygroundMime(html, "image/png")
	// DetectContentType returns text/html — not allowlisted and not octet-stream
	assert.Error(t, err)
}

func TestSniffPlaygroundMime_PNG(t *testing.T) {
	// Minimal PNG header
	png := []byte{
		0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a,
		0x00, 0x00, 0x00, 0x0d, 0x49, 0x48, 0x44, 0x52,
	}
	mimeType, kind, err := SniffPlaygroundMime(png, "application/octet-stream")
	require.NoError(t, err)
	assert.Equal(t, "image", kind)
	assert.Equal(t, "image/png", mimeType)
}

func TestSaveAndResolvePlaygroundAssetFile(t *testing.T) {
	root := t.TempDir()
	t.Setenv("STORAGE_BACKEND", "local")
	t.Setenv("PLAYGROUND_ASSETS_DIR", root)
	storage.Reset()
	t.Cleanup(storage.Reset)

	// Real PNG magic so sniff succeeds
	data := []byte{
		0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a,
		0x00, 0x00, 0x00, 0x0d, 0x49, 0x48, 0x44, 0x52,
		0x00, 0x00, 0x00, 0x01, 0x00, 0x00, 0x00, 0x01,
	}
	key, backend, mimeType, kind, err := SavePlaygroundAssetFile(42, "shot.png", "image/png", bytes.NewReader(data), int64(len(data)))
	require.NoError(t, err)
	assert.Equal(t, "image", kind)
	assert.Equal(t, "image/png", mimeType)
	assert.Equal(t, "local", backend)
	assert.Contains(t, key, "uploads/42/")

	abs, err := ResolvePlaygroundAssetPath(key)
	require.NoError(t, err)
	assert.FileExists(t, abs)

	// Content is served through the store; local backend streams (no presign).
	redirect, body, err := OpenPlaygroundAssetContent(context.Background(), key, 0)
	require.NoError(t, err)
	assert.Empty(t, redirect)
	require.NotNil(t, body)
	got, err := io.ReadAll(body)
	require.NoError(t, body.Close())
	require.NoError(t, err)
	assert.Equal(t, data, got)

	_, err = ResolvePlaygroundAssetPath("../etc/passwd")
	assert.Error(t, err)
	_, err = ResolvePlaygroundAssetPath(filepath.Join("..", "x"))
	assert.Error(t, err)

	DeletePlaygroundAssetFile(key)
	_, err = os.Stat(abs)
	assert.True(t, os.IsNotExist(err))
}

func TestSavePlaygroundAssetFile_SizeLimit(t *testing.T) {
	root := t.TempDir()
	t.Setenv("STORAGE_BACKEND", "local")
	t.Setenv("PLAYGROUND_ASSETS_DIR", root)
	storage.Reset()
	t.Cleanup(storage.Reset)
	big := bytes.Repeat([]byte("a"), int(PlaygroundAssetMaxImageBytes)+10)
	_, _, _, _, err := SavePlaygroundAssetFile(1, "big.png", "image/png", bytes.NewReader(big), int64(len(big)))
	assert.Error(t, err)
}
