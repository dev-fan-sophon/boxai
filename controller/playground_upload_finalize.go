package controller

import (
	"context"
	"errors"
	"fmt"
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

// FinalizePlaygroundUpload checks create-only R2 objects in place. Legacy
// replayable uploads retain their snapshot path until clients reload.
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
	data := model.PublicPlaygroundAssetDTO(asset)
	if store, storeErr := storage.ForBackend(asset.Backend); storeErr == nil {
		if fetchURL, signErr := store.PresignGet(c.Request.Context(), asset.StorageKey, 24*time.Hour); signErr == nil {
			data["fetch_url"] = fetchURL
		}
	}
	common.ApiSuccess(c, data)
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
	key := path.Join("uploads", strconv.Itoa(userID), uuid.NewString())
	direct := strings.HasPrefix(asset.StorageKey, storage.DirectUploadPrefix+strconv.Itoa(userID)+"/")
	keepObject := direct
	if direct {
		key = asset.StorageKey
	}
	defer func() {
		if !keepObject {
			cleanupCtx, cancelCleanup := context.WithTimeout(context.WithoutCancel(ctx), 5*time.Second)
			defer cancelCleanup()
			_ = store.Delete(cleanupCtx, key)
		}
	}()
	var header []byte
	if direct {
		header, err = storage.InspectUpload(ctx, store, key, asset.Size)
	} else {
		header, err = storage.SnapshotUpload(ctx, store, asset.StorageKey, key, asset.Size, asset.Mime)
	}
	if err != nil {
		return nil, err
	}
	mime, kind, err := service.SniffPlaygroundMime(header, asset.Mime)
	if err != nil {
		return nil, err
	}
	if kind != asset.Kind || mime != service.NormalizePlaygroundMime(asset.Mime) {
		return nil, errors.New("uploaded content type does not match intent")
	}
	ready, err := model.FinalizePlaygroundUploadCAS(id, userID, key, mime, playgroundAssetContentURL(id), asset.Size, time.Now().Unix())
	if !ready || err != nil {
		if err != nil {
			return nil, err
		}
		// A concurrent same-owner finalize may have won. Return only ready rows.
		return model.GetPlaygroundAsset(id, userID)
	}
	keepObject = true
	if direct {
		return model.GetPlaygroundAsset(id, userID)
	}
	// PUT URLs cannot be revoked. This delete is best effort only: a replay can
	// recreate staging, but cannot mutate the ready object. Configure an R2
	// lifecycle rule ONLY for upload-intents/ (e.g. 1 day), never uploads/.
	cleanupCtx, cancelCleanup := context.WithTimeout(context.WithoutCancel(ctx), 5*time.Second)
	defer cancelCleanup()
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
		// Only expired pending uploads, never ready references or library assets.
		if !strings.HasPrefix(asset.StorageKey, "upload-intents/") &&
			!strings.HasPrefix(asset.StorageKey, storage.DirectUploadPrefix+strconv.Itoa(asset.UserId)+"/") {
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
