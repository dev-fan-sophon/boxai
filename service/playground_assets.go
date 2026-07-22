package service

import (
	"bytes"
	"context"
	"errors"
	"fmt"
	"io"
	"mime"
	"net/http"
	"path"
	"path/filepath"
	"strings"
	"time"

	"github.com/QuantumNous/new-api/service/storage"
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

// PlaygroundAssetsRoot returns the absolute directory for the local storage
// backend. Kept for the local content path and backfill tooling.
func PlaygroundAssetsRoot() string {
	return storage.LocalRoot()
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

// SavePlaygroundAssetFile stores uploaded content through the configured asset
// store under a user-scoped "uploads/" key. It sniffs the first bytes to
// enforce the MIME allowlist (declared is only a hint) and caps size by kind.
// Returns the storage key and the backend that persisted it.
func SavePlaygroundAssetFile(userId int, originalName, declaredMime string, r io.Reader, size int64) (storageKey string, backend string, mimeType string, kind string, err error) {
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

	// Read the remaining bytes with a hard cap (media sizes are bounded).
	limitedRest := io.LimitReader(r, max+1-int64(len(header)))
	rest, err := io.ReadAll(limitedRest)
	if err != nil {
		return "", "", "", "", err
	}
	content := make([]byte, 0, len(header)+len(rest))
	content = append(content, header...)
	content = append(content, rest...)
	if int64(len(content)) > max {
		return "", "", "", "", fmt.Errorf("file exceeds size limit (%d bytes)", max)
	}

	ext := safeExtFromName(originalName, mimeType)
	storageKey = path.Join("uploads", fmt.Sprintf("%d", userId), uuid.New().String()+ext)

	store := storage.Default()
	if err := store.Put(context.Background(), storageKey, bytes.NewReader(content), int64(len(content)), mimeType); err != nil {
		return "", "", "", "", err
	}
	return storageKey, store.Backend(), mimeType, kind, nil
}

// OpenPlaygroundAssetContent resolves an asset for delivery. When the backend
// supports presigned URLs (R2) it returns a redirect URL; otherwise it returns
// a reader for streaming (local). Exactly one of redirectURL/body is non-empty.
func OpenPlaygroundAssetContent(ctx context.Context, storageKey string, ttl time.Duration) (redirectURL string, body io.ReadCloser, err error) {
	store := storage.Default()
	url, perr := store.PresignGet(ctx, storageKey, ttl)
	if perr == nil {
		return url, nil, nil
	}
	if !errors.Is(perr, storage.ErrPresignUnsupported) {
		return "", nil, perr
	}
	rc, oerr := store.Open(ctx, storageKey)
	if oerr != nil {
		return "", nil, oerr
	}
	return "", rc, nil
}

// ResolvePlaygroundAssetPath maps a storage key to a local absolute path. Only
// valid for the local backend (used by the local content path and backfill).
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

// DeletePlaygroundAssetFile removes the stored object if it exists.
func DeletePlaygroundAssetFile(storageKey string) {
	_ = storage.Default().Delete(context.Background(), storageKey)
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
