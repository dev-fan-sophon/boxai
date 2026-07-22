package service

import (
	"bytes"
	"context"
	"errors"
	"fmt"
	"io"
	"net/http"
	"path/filepath"
	"strings"
	"time"

	"github.com/QuantumNous/new-api/service/storage"
	"github.com/google/uuid"
)

const TopUpProofMaxBytes int64 = 10 * 1024 * 1024

var (
	ErrTopUpProofTooLarge    = errors.New("top-up proof is too large")
	ErrTopUpProofUnsupported = errors.New("top-up proof type is unsupported")
)

func SaveTopUpProof(ctx context.Context, userID int, data []byte) (key, backend, mimeType string, err error) {
	if len(data) == 0 || int64(len(data)) > TopUpProofMaxBytes {
		return "", "", "", ErrTopUpProofTooLarge
	}
	mimeType = http.DetectContentType(data[:min(len(data), 512)])
	ext := ""
	switch mimeType {
	case "image/jpeg":
		ext = ".jpg"
	case "image/png":
		ext = ".png"
	case "image/webp":
		ext = ".webp"
	default:
		if len(data) >= 12 && string(data[:4]) == "RIFF" && string(data[8:12]) == "WEBP" {
			mimeType, ext = "image/webp", ".webp"
		} else {
			return "", "", "", ErrTopUpProofUnsupported
		}
	}
	key = fmt.Sprintf("topup-proofs/%d/%s%s", userID, strings.ReplaceAll(uuid.NewString(), "-", ""), ext)
	store := storage.Default()
	if err = store.Put(ctx, filepath.ToSlash(key), bytes.NewReader(data), int64(len(data)), mimeType); err != nil {
		return "", "", "", err
	}
	return key, store.Backend(), mimeType, nil
}

func DeleteTopUpProof(ctx context.Context, backend, key string) error {
	if key == "" {
		return nil
	}
	store, err := storage.ForBackend(backend)
	if err != nil {
		return err
	}
	return store.Delete(ctx, key)
}

func OpenTopUpProof(ctx context.Context, backend, key string) (string, io.ReadCloser, error) {
	store, err := storage.ForBackend(backend)
	if err != nil {
		return "", nil, err
	}
	url, err := store.PresignGet(ctx, key, 5*time.Minute)
	if err == nil {
		return url, nil, nil
	}
	if !errors.Is(err, storage.ErrPresignUnsupported) {
		return "", nil, err
	}
	body, err := store.Open(ctx, key)
	return "", body, err
}
