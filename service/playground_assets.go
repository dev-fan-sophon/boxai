package service

import (
	"bytes"
	"fmt"
	"io"
	"mime"
	"net/http"
	"os"
	"path/filepath"
	"strings"

	"github.com/QuantumNous/new-api/common"
	"github.com/google/uuid"
)

const (
	PlaygroundAssetMaxImageBytes = 10 * 1024 * 1024 // 10MB
	PlaygroundAssetMaxVideoBytes = 50 * 1024 * 1024 // 50MB
	PlaygroundAssetMaxAudioBytes = 20 * 1024 * 1024 // 20MB
)

var playgroundImageMimes = map[string]bool{
	"image/jpeg": true,
	"image/jpg":  true,
	"image/png":  true,
	"image/webp": true,
	"image/gif":  true,
}

var playgroundVideoMimes = map[string]bool{
	"video/mp4":       true,
	"video/webm":      true,
	"video/quicktime": true,
}

var playgroundAudioMimes = map[string]bool{
	"audio/mpeg":  true,
	"audio/mp3":   true,
	"audio/wav":   true,
	"audio/x-wav": true,
	"audio/webm":  true,
	"audio/ogg":   true,
	"audio/mp4":   true,
	"audio/m4a":   true,
}

// PlaygroundAssetsRoot returns the absolute directory for playground asset files.
func PlaygroundAssetsRoot() string {
	root := common.GetEnvOrDefaultString("PLAYGROUND_ASSETS_DIR", "")
	if root == "" {
		root = filepath.Join("data", "playground-assets")
	}
	abs, err := filepath.Abs(root)
	if err != nil {
		return root
	}
	return abs
}

// NormalizePlaygroundMime maps common sniff/browser variants onto the allowlist key.
func NormalizePlaygroundMime(mimeType string) string {
	mimeType = strings.ToLower(strings.TrimSpace(mimeType))
	if i := strings.Index(mimeType, ";"); i >= 0 {
		mimeType = strings.TrimSpace(mimeType[:i])
	}
	switch mimeType {
	case "image/jpg":
		return "image/jpeg"
	case "audio/mp3":
		return "audio/mpeg"
	case "audio/x-wav":
		return "audio/wav"
	default:
		return mimeType
	}
}

// DetectPlaygroundAssetKind maps mime to kind (image|video|audio).
func DetectPlaygroundAssetKind(mimeType string) (string, error) {
	mimeType = NormalizePlaygroundMime(mimeType)
	if playgroundImageMimes[mimeType] {
		return "image", nil
	}
	if playgroundVideoMimes[mimeType] {
		return "video", nil
	}
	if playgroundAudioMimes[mimeType] {
		return "audio", nil
	}
	return "", fmt.Errorf("unsupported mime type: %s", mimeType)
}

// IsPlaygroundMimeAllowed reports whether mime is on the allowlist.
func IsPlaygroundMimeAllowed(mimeType string) bool {
	_, err := DetectPlaygroundAssetKind(mimeType)
	return err == nil
}

// SniffPlaygroundMime reads up to 512 bytes (does not consume beyond peek via Tee/multi),
// detects content type, and maps to an allowlisted MIME when possible.
// declared may be used as a secondary hint only when sniff is generic (octet-stream).
func SniffPlaygroundMime(header []byte, declared string) (mimeType string, kind string, err error) {
	sniffed := http.DetectContentType(header)
	sniffed = NormalizePlaygroundMime(sniffed)
	declared = NormalizePlaygroundMime(declared)

	// Prefer sniffed when it is allowlisted
	if k, e := DetectPlaygroundAssetKind(sniffed); e == nil {
		return sniffed, k, nil
	}

	// DetectContentType often returns application/octet-stream for webp/wav/etc.
	// Only then may we fall back to a declared allowlisted type.
	if sniffed == "application/octet-stream" || sniffed == "text/plain" {
		if k, e := DetectPlaygroundAssetKind(declared); e == nil {
			return declared, k, nil
		}
		// magic for webp: RIFF....WEBP
		if len(header) >= 12 && string(header[0:4]) == "RIFF" && string(header[8:12]) == "WEBP" {
			return "image/webp", "image", nil
		}
		// wav: RIFF....WAVE
		if len(header) >= 12 && string(header[0:4]) == "RIFF" && string(header[8:12]) == "WAVE" {
			return "audio/wav", "audio", nil
		}
	}

	// If declared is allowlisted and sniff is a compatible family (e.g. image/*)
	if k, e := DetectPlaygroundAssetKind(declared); e == nil {
		if strings.HasPrefix(sniffed, "image/") && k == "image" {
			return declared, k, nil
		}
		if strings.HasPrefix(sniffed, "video/") && k == "video" {
			return declared, k, nil
		}
		if strings.HasPrefix(sniffed, "audio/") && k == "audio" {
			return declared, k, nil
		}
		// sniff failed family match — reject declared alone without sniff support
	}

	return "", "", fmt.Errorf("unsupported or unrecognizable file type (sniffed %s, declared %s)", sniffed, declared)
}

// MaxBytesForPlaygroundKind returns the upload size cap for a kind.
func MaxBytesForPlaygroundKind(kind string) int64 {
	switch kind {
	case "video":
		return PlaygroundAssetMaxVideoBytes
	case "audio":
		return PlaygroundAssetMaxAudioBytes
	default:
		return PlaygroundAssetMaxImageBytes
	}
}

// SavePlaygroundAssetFile writes file content under the user-scoped assets directory.
// Returns storage key relative to root (never absolute path for clients).
// Sniffs the first bytes to enforce MIME allowlist (declared is only a hint).
func SavePlaygroundAssetFile(userId int, originalName, declaredMime string, r io.Reader, size int64) (storageKey string, absPath string, mimeType string, kind string, err error) {
	// Peek for sniff
	header := make([]byte, 512)
	n, readErr := io.ReadFull(r, header)
	if readErr != nil && readErr != io.EOF && readErr != io.ErrUnexpectedEOF {
		return "", "", "", "", readErr
	}
	header = header[:n]
	mimeType, kind, err = SniffPlaygroundMime(header, declaredMime)
	if err != nil {
		return "", "", "", "", err
	}

	max := MaxBytesForPlaygroundKind(kind)
	if size > 0 && size > max {
		return "", "", "", "", fmt.Errorf("file exceeds size limit (%d bytes)", max)
	}

	ext := safeExtFromName(originalName, mimeType)
	id := uuid.New().String()
	storageKey = filepath.ToSlash(filepath.Join(fmt.Sprintf("%d", userId), id+ext))

	absPath = filepath.Join(PlaygroundAssetsRoot(), filepath.FromSlash(storageKey))
	if err := os.MkdirAll(filepath.Dir(absPath), 0o750); err != nil {
		return "", "", "", "", err
	}

	f, err := os.OpenFile(absPath, os.O_CREATE|os.O_WRONLY|os.O_EXCL, 0o640)
	if err != nil {
		return "", "", "", "", err
	}
	defer f.Close()

	// write sniffed header then rest, with size cap
	limitedRest := io.LimitReader(r, max+1-int64(len(header)))
	body := io.MultiReader(bytes.NewReader(header), limitedRest)
	written, err := io.Copy(f, body)
	if err != nil {
		_ = os.Remove(absPath)
		return "", "", "", "", err
	}
	if written > max {
		_ = os.Remove(absPath)
		return "", "", "", "", fmt.Errorf("file exceeds size limit (%d bytes)", max)
	}
	return storageKey, absPath, mimeType, kind, nil
}

// ResolvePlaygroundAssetPath maps a storage key to an absolute path, rejecting traversal.
func ResolvePlaygroundAssetPath(storageKey string) (string, error) {
	if storageKey == "" || strings.Contains(storageKey, "..") {
		return "", fmt.Errorf("invalid storage key")
	}
	clean := filepath.Clean(filepath.FromSlash(storageKey))
	if strings.HasPrefix(clean, "..") || filepath.IsAbs(clean) {
		return "", fmt.Errorf("invalid storage key")
	}
	root := PlaygroundAssetsRoot()
	full := filepath.Join(root, clean)
	rel, err := filepath.Rel(root, full)
	if err != nil || strings.HasPrefix(rel, "..") {
		return "", fmt.Errorf("invalid storage key")
	}
	return full, nil
}

// DeletePlaygroundAssetFile removes the file if it exists.
func DeletePlaygroundAssetFile(storageKey string) {
	path, err := ResolvePlaygroundAssetPath(storageKey)
	if err != nil {
		return
	}
	_ = os.Remove(path)
}

func safeExtFromName(name, mimeType string) string {
	ext := strings.ToLower(filepath.Ext(name))
	if ext == "" || len(ext) > 8 || strings.ContainsAny(ext, "/\\") {
		if exts, _ := mime.ExtensionsByType(mimeType); len(exts) > 0 {
			ext = exts[0]
		} else {
			ext = ".bin"
		}
	}
	switch ext {
	case ".jpg", ".jpeg", ".png", ".webp", ".gif",
		".mp4", ".webm", ".mov",
		".mp3", ".wav", ".ogg", ".m4a", ".mpeg":
		return ext
	default:
		return ".bin"
	}
}
