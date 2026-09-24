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

	lower := strings.ToLower(ref)
	switch {
	case strings.HasPrefix(lower, "data:"):
		content, declaredMime, err := decodePlaygroundDataURL(ref)
		if err != nil {
			return nil, err
		}
		return persistPlaygroundOutputContent(ctx, userId, modality, content, declaredMime)
	case strings.HasPrefix(lower, "http://"), strings.HasPrefix(lower, "https://"):
		return persistPlaygroundOutputHTTP(ctx, userId, modality, ref)
	default:
		return nil, nil
	}
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
	return persistPlaygroundOutputStream(ctx, userId, modality, resp.Body, resp.ContentLength, resp.Header.Get("Content-Type"))
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

func persistPlaygroundOutputHTTP(ctx context.Context, userId int, modality, ref string) (*model.PlaygroundAsset, error) {
	req, err := http.NewRequestWithContext(ctx, http.MethodGet, ref, nil)
	if err != nil {
		return nil, fmt.Errorf("create output download request failed")
	}
	resp, err := GetStrictUntrustedMediaHTTPClient().Do(req)
	if err != nil {
		return nil, fmt.Errorf("output download request failed")
	}
	defer resp.Body.Close()
	if resp.StatusCode != http.StatusOK {
		return nil, fmt.Errorf("download failed: status %d", resp.StatusCode)
	}
	return persistPlaygroundOutputStream(ctx, userId, modality, resp.Body, resp.ContentLength, resp.Header.Get("Content-Type"))
}

// persistPlaygroundOutputStream copies a provider body into object storage
// without buffering the whole file. Only the first 512 bytes are peeked so the
// MIME allowlist can still reject unexpected content.
func persistPlaygroundOutputStream(ctx context.Context, userId int, modality string, body io.Reader, contentLength int64, declaredMime string) (*model.PlaygroundAsset, error) {
	header := make([]byte, 512)
	n, readErr := io.ReadFull(body, header)
	if readErr != nil && readErr != io.EOF && readErr != io.ErrUnexpectedEOF {
		return nil, readErr
	}
	header = header[:n]
	mimeType, kind, err := resolveOutputMime(header, declaredMime, modality)
	if err != nil {
		return nil, err
	}
	max := MaxBytesForPlaygroundKind(kind)
	if contentLength > max {
		return nil, fmt.Errorf("output exceeds size limit for %s", kind)
	}
	ext := safeExtFromName("", mimeType)
	key := path.Join("outputs", fmt.Sprintf("%d", userId), uuid.New().String()+ext)
	store := storage.Default()
	limited := io.LimitReader(io.MultiReader(bytes.NewReader(header), body), max+1)
	counting := &countingReader{r: limited}
	if err := store.Put(ctx, key, counting, contentLength, mimeType); err != nil {
		_ = store.Delete(ctx, key)
		return nil, err
	}
	if counting.n > max {
		_ = store.Delete(ctx, key)
		return nil, fmt.Errorf("output exceeds size limit for %s", kind)
	}
	asset := &model.PlaygroundAsset{
		UserId:     userId,
		Kind:       kind,
		Name:       path.Base(key),
		StorageKey: key,
		Backend:    store.Backend(),
		Mime:       mimeType,
		Size:       counting.n,
	}
	if err := model.CreatePlaygroundAsset(asset); err != nil {
		_ = store.Delete(ctx, key)
		return nil, err
	}
	return asset, nil
}

type countingReader struct {
	r io.Reader
	n int64
}

func (c *countingReader) Read(p []byte) (int, error) {
	n, err := c.r.Read(p)
	c.n += int64(n)
	return n, err
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
