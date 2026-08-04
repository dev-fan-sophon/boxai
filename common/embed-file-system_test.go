package common

import (
	"io"
	"net/http"
	"os"
	"path/filepath"
	"testing"

	"github.com/stretchr/testify/assert"
	"github.com/stretchr/testify/require"
)

func TestResolveWebDistDir(t *testing.T) {
	t.Parallel()

	assert.Equal(t, "", ResolveWebDistDir(""))
	assert.Equal(t, "", ResolveWebDistDir("   "))
	assert.Equal(t, "", ResolveWebDistDir("/no/such/path"))

	root := t.TempDir()
	assert.Equal(t, "", ResolveWebDistDir(root))

	require.NoError(t, os.WriteFile(filepath.Join(root, "index.html"), []byte("<html/>"), 0o644))
	assert.Equal(t, filepath.Clean(root), ResolveWebDistDir(root))

	link := filepath.Join(t.TempDir(), "web")
	require.NoError(t, os.Symlink(root, link))
	assert.Equal(t, filepath.Clean(link), ResolveWebDistDir(link))
}

func TestReadWebIndexHTML(t *testing.T) {
	t.Parallel()

	fallback := []byte("embedded")
	assert.Equal(t, fallback, ReadWebIndexHTML("", fallback))
	assert.Equal(t, fallback, ReadWebIndexHTML("/missing", fallback))

	root := t.TempDir()
	require.NoError(t, os.WriteFile(filepath.Join(root, "index.html"), []byte("disk-index"), 0o644))
	assert.Equal(t, []byte("disk-index"), ReadWebIndexHTML(root, fallback))
}

// neverFileSystem always misses so prefer-disk tests isolate the disk path.
type neverFileSystem struct{}

func (neverFileSystem) Open(name string) (http.File, error) {
	return nil, os.ErrNotExist
}

func (neverFileSystem) Exists(prefix string, path string) bool {
	return false
}

func TestPreferDiskFolderFollowsSymlinkSwitch(t *testing.T) {
	t.Parallel()

	base := t.TempDir()
	relA := filepath.Join(base, "a")
	relB := filepath.Join(base, "b")
	require.NoError(t, os.MkdirAll(filepath.Join(relA, "static"), 0o755))
	require.NoError(t, os.MkdirAll(filepath.Join(relB, "static"), 0o755))
	require.NoError(t, os.WriteFile(filepath.Join(relA, "index.html"), []byte("index-a"), 0o644))
	require.NoError(t, os.WriteFile(filepath.Join(relB, "index.html"), []byte("index-b"), 0o644))
	require.NoError(t, os.WriteFile(filepath.Join(relA, "static", "app.js"), []byte("js-a"), 0o644))
	require.NoError(t, os.WriteFile(filepath.Join(relB, "static", "app.js"), []byte("js-b"), 0o644))

	link := filepath.Join(base, "web")
	require.NoError(t, os.Symlink(relA, link))

	fsys := &preferDiskFileSystem{
		distDir: link,
		embed:   neverFileSystem{},
	}

	assert.False(t, fsys.Exists("", "/"))
	assert.True(t, fsys.Exists("", "/static/app.js"))
	assert.False(t, fsys.Exists("", "/static/missing.js"))

	f, err := fsys.Open("/static/app.js")
	require.NoError(t, err)
	body, err := io.ReadAll(f)
	require.NoError(t, err)
	require.NoError(t, f.Close())
	assert.Equal(t, "js-a", string(body))
	assert.Equal(t, []byte("index-a"), ReadWebIndexHTML(link, []byte("fallback")))

	// Atomic-style switch: rename a new symlink over the live link.
	tmpLink := link + ".next"
	_ = os.Remove(tmpLink)
	require.NoError(t, os.Symlink(relB, tmpLink))
	require.NoError(t, os.Rename(tmpLink, link))

	f, err = fsys.Open("/static/app.js")
	require.NoError(t, err)
	body, err = io.ReadAll(f)
	require.NoError(t, err)
	require.NoError(t, f.Close())
	assert.Equal(t, "js-b", string(body))
	assert.Equal(t, []byte("index-b"), ReadWebIndexHTML(link, []byte("fallback")))
}

func TestPreferDiskFolderFallsBackWhenDistMissing(t *testing.T) {
	t.Parallel()

	embedRoot := t.TempDir()
	require.NoError(t, os.WriteFile(filepath.Join(embedRoot, "static-app.js"), []byte("from-embed"), 0o644))

	fsys := &preferDiskFileSystem{
		distDir: filepath.Join(t.TempDir(), "not-yet"),
		embed:   &embedFileSystem{FileSystem: http.Dir(embedRoot)},
	}

	assert.True(t, fsys.Exists("", "/static-app.js"))
	f, err := fsys.Open("/static-app.js")
	require.NoError(t, err)
	body, err := io.ReadAll(f)
	require.NoError(t, err)
	require.NoError(t, f.Close())
	assert.Equal(t, "from-embed", string(body))
}
