package controller

import (
	"context"
	"errors"
	"fmt"
	"io"
	"os"
	"path"
	"strconv"
	"strings"
	"time"

	"github.com/dev-fan-sophon/boxai/common"
	"github.com/dev-fan-sophon/boxai/model"
	"github.com/dev-fan-sophon/boxai/service"
	"github.com/dev-fan-sophon/boxai/service/storage"
	"github.com/gin-gonic/gin"
	"github.com/google/uuid"
)

var uploadFinalizeCapacity = make(chan struct{}, 4)

// FinalizePlaygroundUpload verifies one immutable read of the staging object.
// Never HEAD then copy the mutable signed-PUT key: an attacker could overwrite
// between verification and copy. The bounded local snapshot is what we publish.
func FinalizePlaygroundUpload(c *gin.Context) {
	id, err := strconv.Atoi(c.Param("id"))
	if err != nil || id <= 0 {
		common.ApiErrorMsg(c, "invalid asset id")
		return
	}
	asset, err := finalizePlaygroundUpload(c.Request.Context(), id, c.GetInt("id"))
	if err != nil {
		common.ApiError(c, err)
		return
	}
	common.ApiSuccess(c, model.PublicPlaygroundAssetDTO(asset))
}

func finalizePlaygroundUpload(ctx context.Context, id, userID int) (*model.PlaygroundAsset, error) {
	ctx, cancel := context.WithTimeout(ctx, 3*time.Minute)
	defer cancel()
	select {
	case uploadFinalizeCapacity <- struct{}{}:
		defer func() { <-uploadFinalizeCapacity }()
	case <-ctx.Done():
		return nil, ctx.Err()
	}
	asset, err := model.GetPlaygroundUploadIntent(id, userID)
	if err != nil {
		return nil, err
	}
	if asset.UploadState == "ready" || asset.UploadState == "" {
		return asset, nil
	}
	if asset.UploadState != "pending" || asset.UploadExpiresAt <= time.Now().Unix() {
		return nil, errors.New("upload intent expired")
	}
	limit := service.MaxBytesForPlaygroundKind(asset.Kind)
	if asset.Kind == "document" || limit <= 0 || asset.Size <= 0 || asset.Size > limit {
		return nil, errors.New("invalid upload intent")
	}
	store, err := storage.ForBackend(asset.Backend)
	if err != nil {
		return nil, err
	}
	body, err := store.Open(ctx, asset.StorageKey)
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
	size, err := io.Copy(snapshot, io.LimitReader(body, limit+1))
	if err != nil {
		return nil, err
	}
	if size != asset.Size || size > limit {
		return nil, errors.New("uploaded size does not match intent or exceeds limit")
	}
	header := make([]byte, 512)
	n, err := snapshot.ReadAt(header, 0)
	if err != nil && !errors.Is(err, io.EOF) {
		return nil, err
	}
	mime, kind, err := service.SniffPlaygroundMime(header[:n], asset.Mime)
	if err != nil {
		return nil, err
	}
	if kind != asset.Kind || mime != service.NormalizePlaygroundMime(asset.Mime) {
		return nil, errors.New("uploaded content type does not match intent")
	}
	if _, err = snapshot.Seek(0, io.SeekStart); err != nil {
		return nil, err
	}
	key := path.Join("uploads", strconv.Itoa(userID), uuid.NewString())
	err = store.Put(ctx, key, snapshot, size, mime)
	cleanupCtx, cancelCleanup := context.WithTimeout(context.WithoutCancel(ctx), 5*time.Second)
	defer cancelCleanup()
	if err != nil {
		_ = store.Delete(cleanupCtx, key)
		return nil, err
	}
	ready, err := model.FinalizePlaygroundUploadCAS(id, userID, key, mime, playgroundAssetContentURL(id), size, time.Now().Unix())
	if !ready || err != nil {
		_ = store.Delete(cleanupCtx, key)
		if err != nil {
			return nil, err
		}
		// A concurrent same-owner finalize may have won. Return only ready rows.
		return model.GetPlaygroundAsset(id, userID)
	}
	// PUT URLs cannot be revoked. This delete is best effort only: a replay can
	// recreate staging, but cannot mutate the ready object. Configure an R2
	// lifecycle rule ONLY for upload-intents/ (e.g. 1 day), never uploads/.
	_ = store.Delete(cleanupCtx, asset.StorageKey)
	return model.GetPlaygroundAsset(id, userID)
}

// CleanupExpiredPlaygroundUploads is a bounded maintenance pass. Call from the
// maintenance scheduler. Only abandoned pending intents are removed; there is
// deliberately no retention policy for paid generations or ready user assets.
func CleanupExpiredPlaygroundUploads(ctx context.Context, now time.Time, limit int) error {
	before := now.Add(-time.Hour).Unix()
	assets, err := model.ListExpiredPlaygroundUploads(before, limit)
	if err != nil {
		return err
	}
	for _, asset := range assets {
		// Fail closed if corrupt data points outside the staging namespace.
		if !strings.HasPrefix(asset.StorageKey, "upload-intents/") {
			return fmt.Errorf("pending asset %d has non-staging key", asset.Id)
		}
		store, err := storage.ForBackend(asset.Backend)
		if err != nil {
			return err
		}
		if err = store.Delete(ctx, asset.StorageKey); err != nil {
			return err
		}
		if err = model.DeleteExpiredPlaygroundUpload(asset.Id, before); err != nil {
			return err
		}
	}
	return nil
}
