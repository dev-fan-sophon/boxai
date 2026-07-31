package service

import (
	"bytes"
	"context"
	"encoding/base64"
	"fmt"
	"io"
	"net/http"
	"path"
	"strings"

	"github.com/dev-fan-sophon/boxai/model"
	"github.com/dev-fan-sophon/boxai/service/storage"
	"github.com/google/uuid"
)

// PersistPlaygroundOutput downloads (http/https, SSRF-protected) or decodes
// (data URL) a generation result and stores it under an "outputs/<uid>/" key,
// creating a PlaygroundAsset. It returns nil (no error) when resultRef is not
// persistable (empty, or an app-relative/other reference), so callers can fall
// back to the original reference.
func PersistPlaygroundOutput(ctx context.Context, userId int, modality, resultRef string) (*model.PlaygroundAsset, error) {
	ref := strings.TrimSpace(resultRef)
	if ref == "" {
		return nil, nil
	}

	content, declaredMime, err := fetchPlaygroundOutput(ctx, ref)
	if err != nil {
		return nil, err
	}
	if content == nil {
		return nil, nil // not persistable
	}

	return persistPlaygroundOutputContent(ctx, userId, modality, content, declaredMime)
}

// PersistPlaygroundOutputRequest stores media returned by an operator-managed
// provider request. Callers must construct the URL and authorization headers;
// this path is not for user-controlled URLs.
func PersistPlaygroundOutputRequest(ctx context.Context, userId int, modality string, req *http.Request, client *http.Client) (*model.PlaygroundAsset, error) {
	resp, err := client.Do(req)
	if err != nil {
		return nil, fmt.Errorf("provider media request failed")
	}
	defer resp.Body.Close()
	if resp.StatusCode != http.StatusOK {
		return nil, fmt.Errorf("provider media request failed: status %d", resp.StatusCode)
	}
	body, err := io.ReadAll(io.LimitReader(resp.Body, PlaygroundAssetMaxVideoBytes+1))
	if err != nil {
		return nil, err
	}
	if len(body) > PlaygroundAssetMaxVideoBytes {
		return nil, fmt.Errorf("output exceeds size limit")
	}
	return persistPlaygroundOutputContent(ctx, userId, modality, body, resp.Header.Get("Content-Type"))
}

func persistPlaygroundOutputContent(ctx context.Context, userId int, modality string, content []byte, declaredMime string) (*model.PlaygroundAsset, error) {
	mimeType, kind, err := resolveOutputMime(content, declaredMime, modality)
	if err != nil {
		return nil, err
	}
	if int64(len(content)) > MaxBytesForPlaygroundKind(kind) {
		return nil, fmt.Errorf("output exceeds size limit for %s", kind)
	}

	ext := safeExtFromName("", mimeType)
	key := path.Join("outputs", fmt.Sprintf("%d", userId), uuid.New().String()+ext)

	store := storage.Default()
	if err := store.Put(ctx, key, bytes.NewReader(content), int64(len(content)), mimeType); err != nil {
		return nil, err
	}

	asset := &model.PlaygroundAsset{
		UserId:     userId,
		Kind:       kind,
		Name:       path.Base(key),
		StorageKey: key,
		Backend:    store.Backend(),
		Mime:       mimeType,
		Size:       int64(len(content)),
	}
	if err := model.CreatePlaygroundAsset(asset); err != nil {
		_ = store.Delete(ctx, key)
		return nil, err
	}
	return asset, nil
}

// fetchPlaygroundOutput returns the raw bytes and declared mime for a result
// reference. Only data:, http:// and https:// refs are persistable; other refs
// yield (nil, "", nil).
func fetchPlaygroundOutput(ctx context.Context, ref string) ([]byte, string, error) {
	lower := strings.ToLower(ref)
	switch {
	case strings.HasPrefix(lower, "data:"):
		return decodePlaygroundDataURL(ref)
	case strings.HasPrefix(lower, "http://"), strings.HasPrefix(lower, "https://"):
		req, err := http.NewRequestWithContext(ctx, http.MethodGet, ref, nil)
		if err != nil {
			return nil, "", fmt.Errorf("create output download request failed")
		}
		resp, err := GetStrictUntrustedMediaHTTPClient().Do(req)
		if err != nil {
			return nil, "", fmt.Errorf("output download request failed")
		}
		defer resp.Body.Close()
		if resp.StatusCode != 200 {
			return nil, "", fmt.Errorf("download failed: status %d", resp.StatusCode)
		}
		// Read with a hard cap; video is the largest allowed kind.
		var max int64 = PlaygroundAssetMaxVideoBytes
		body, err := io.ReadAll(io.LimitReader(resp.Body, max+1))
		if err != nil {
			return nil, "", err
		}
		if int64(len(body)) > max {
			return nil, "", fmt.Errorf("output exceeds size limit")
		}
		return body, resp.Header.Get("Content-Type"), nil
	default:
		return nil, "", nil
	}
}

// resolveOutputMime validates content against the allowlist, preferring the
// declared mime, then a content sniff, falling back to modality only when a
// sniff succeeds.
func resolveOutputMime(content []byte, declaredMime, modality string) (mimeType string, kind string, err error) {
	header := content
	if len(header) > 512 {
		header = header[:512]
	}
	sniffed, dk, serr := SniffPlaygroundMime(header, declaredMime)
	if serr != nil {
		return "", "", fmt.Errorf("unsupported output content (%v)", serr)
	}
	// Sanity: sniffed kind should match the requested modality when known.
	if modality != "" && modality != "chat" && dk != modality {
		return "", "", fmt.Errorf("output kind %q does not match modality %q", dk, modality)
	}
	return sniffed, dk, nil
}

func decodePlaygroundDataURL(ref string) ([]byte, string, error) {
	rest := strings.TrimPrefix(ref, "data:")
	comma := strings.IndexByte(rest, ',')
	if comma < 0 {
		return nil, "", fmt.Errorf("invalid data url")
	}
	meta := rest[:comma]
	payload := rest[comma+1:]
	mimeType := meta
	if i := strings.IndexByte(meta, ';'); i >= 0 {
		mimeType = meta[:i]
	}
	if strings.Contains(meta, ";base64") {
		content, err := base64.StdEncoding.DecodeString(payload)
		if err != nil {
			return nil, "", fmt.Errorf("invalid base64 data url: %w", err)
		}
		return content, mimeType, nil
	}
	return []byte(payload), mimeType, nil
}
