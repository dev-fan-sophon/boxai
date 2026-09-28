package storage

import (
	"context"
	"errors"
	"io"
	"os"
)

// SnapshotUpload fixes an uploaded object at a fresh, server-only key and returns
// its first 512 bytes for type validation. The caller must delete the destination
// on error or failed validation. R2 copies inside the bucket, never through the app.
func SnapshotUpload(ctx context.Context, store AssetStore, source, destination string, size int64, contentType string) ([]byte, error) {
	if source == destination || size <= 0 {
		return nil, errors.New("storage: invalid upload snapshot")
	}
	if r2, ok := store.(*r2Store); ok {
		return r2.snapshotUpload(ctx, source, destination, size, contentType)
	}
	body, err := store.Open(ctx, source)
	if err != nil {
		return nil, err
	}
	defer body.Close()
	snapshot, err := os.CreateTemp("", "boxai-upload-*")
	if err != nil {
		return nil, err
	}
	defer os.Remove(snapshot.Name())
	defer snapshot.Close()
	n, err := io.Copy(snapshot, io.LimitReader(body, size+1))
	if err != nil {
		return nil, err
	}
	if n != size {
		return nil, errors.New("uploaded size does not match intent")
	}
	header := make([]byte, min(size, 512))
	if _, err = snapshot.ReadAt(header, 0); err != nil {
		return nil, err
	}
	if _, err = snapshot.Seek(0, io.SeekStart); err != nil {
		return nil, err
	}
	if err = store.Put(ctx, destination, snapshot, size, contentType); err != nil {
		return nil, err
	}
	return header, nil
}
