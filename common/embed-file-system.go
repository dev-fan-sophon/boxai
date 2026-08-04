package common

import (
	"embed"
	"io/fs"
	"net/http"
	"os"
	"path/filepath"
	"strings"

	"github.com/gin-contrib/static"
)

// Credit: https://github.com/gin-contrib/static/issues/19

type embedFileSystem struct {
	http.FileSystem
}

func (e *embedFileSystem) Exists(prefix string, path string) bool {
	_, err := e.Open(path)
	if err != nil {
		return false
	}
	return true
}

func (e *embedFileSystem) Open(name string) (http.File, error) {
	if name == "/" {
		// This will make sure the index page goes to NoRouter handler,
		// which will use the replaced index bytes with analytic codes.
		return nil, os.ErrNotExist
	}
	return e.FileSystem.Open(name)
}

func EmbedFolder(fsEmbed embed.FS, targetPath string) static.ServeFileSystem {
	efs, err := fs.Sub(fsEmbed, targetPath)
	if err != nil {
		panic(err)
	}
	return &embedFileSystem{
		FileSystem: http.FS(efs),
	}
}

// preferDiskFileSystem serves SPA assets from DistDir when that path currently
// contains index.html; otherwise it falls back to embed. DistDir may be a
// symlink (e.g. /opt/boxai/web → web-releases/<id>). Each Open/Exists re-checks
// and re-follows the symlink so deploy-web can flip it without restarting Go,
// and so the first successful deploy-web after enabling WEB_DIST_DIR is picked
// up without a process bounce. "/" always misses so SPA shells hit NoRoute.
type preferDiskFileSystem struct {
	distDir string
	embed   static.ServeFileSystem
}

func (p *preferDiskFileSystem) disk() http.FileSystem {
	dir := ResolveWebDistDir(p.distDir)
	if dir == "" {
		return nil
	}
	return http.Dir(dir)
}

func (p *preferDiskFileSystem) Exists(prefix string, path string) bool {
	if path == "/" || path == "" {
		return false
	}
	if root := p.disk(); root != nil {
		f, err := root.Open(path)
		if err == nil {
			defer f.Close()
			if st, err := f.Stat(); err == nil && !st.IsDir() {
				return true
			}
		}
	}
	return p.embed.Exists(prefix, path)
}

func (p *preferDiskFileSystem) Open(name string) (http.File, error) {
	if name == "/" {
		return nil, os.ErrNotExist
	}
	if root := p.disk(); root != nil {
		f, err := root.Open(name)
		if err == nil {
			if st, statErr := f.Stat(); statErr == nil && !st.IsDir() {
				return f, nil
			}
			_ = f.Close()
		}
	}
	return p.embed.Open(name)
}

// PreferDiskFolder serves from distDir when usable, else embedFS at embedPath.
// distDir may be empty (embed-only).
func PreferDiskFolder(distDir string, embedFS embed.FS, embedPath string) static.ServeFileSystem {
	return &preferDiskFileSystem{
		distDir: strings.TrimSpace(distDir),
		embed:   EmbedFolder(embedFS, embedPath),
	}
}

// ResolveWebDistDir returns a cleaned path that currently contains a usable SPA
// build (index.html present), or "" when unset/invalid. When dir is a symlink,
// the returned path is the symlink path itself (not EvalSymlinks) so later
// reads re-follow an atomic ln -sfn switch.
func ResolveWebDistDir(dir string) string {
	dir = strings.TrimSpace(dir)
	if dir == "" {
		return ""
	}
	cleaned := filepath.Clean(dir)
	info, err := os.Lstat(cleaned)
	if err != nil {
		return ""
	}
	if info.Mode()&os.ModeSymlink == 0 && !info.IsDir() {
		return ""
	}
	indexPath := filepath.Join(cleaned, "index.html")
	st, err := os.Stat(indexPath)
	if err != nil || st.IsDir() {
		return ""
	}
	return cleaned
}

// ReadWebIndexHTML loads index.html from distDir when usable; otherwise returns
// fallback (typically the embedded shell).
func ReadWebIndexHTML(distDir string, fallback []byte) []byte {
	dir := ResolveWebDistDir(distDir)
	if dir == "" {
		return fallback
	}
	raw, err := os.ReadFile(filepath.Join(dir, "index.html"))
	if err != nil || len(raw) == 0 {
		return fallback
	}
	return raw
}
