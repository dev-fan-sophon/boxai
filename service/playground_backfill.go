package service

import (
	"context"
	"strconv"

	"github.com/QuantumNous/new-api/common"
	"github.com/QuantumNous/new-api/model"
	"github.com/QuantumNous/new-api/service/storage"
)

// BackfillResult summarizes a local-to-R2 migration pass.
type BackfillResult struct {
	Scanned  int  `json:"scanned"`
	Migrated int  `json:"migrated"`
	Failed   int  `json:"failed"`
	DryRun   bool `json:"dry_run"`
}

// BackfillPlaygroundAssetsToR2 copies assets still stored on the local backend
// to Cloudflare R2, preserving their storage keys, and marks them backend="r2".
// Public copies (visibility=public) are re-uploaded and their public URL
// refreshed to the CDN. When dryRun is true nothing is written and only the
// candidate count is reported. limit <= 0 processes all matching assets.
func BackfillPlaygroundAssetsToR2(ctx context.Context, limit int, dryRun bool) (BackfillResult, error) {
	result := BackfillResult{DryRun: dryRun}

	assets, err := model.ListPlaygroundAssetsForBackfill(limit)
	if err != nil {
		return result, err
	}
	result.Scanned = len(assets)
	if dryRun || len(assets) == 0 {
		return result, nil
	}

	dst, err := storage.NewR2Store()
	if err != nil {
		return result, err
	}
	src := storage.NewLocalStore(storage.LocalRoot())

	migrated, failed := migratePlaygroundAssets(ctx, src, dst, assets)
	result.Migrated = migrated
	result.Failed = failed
	return result, nil
}

// migratePlaygroundAssets copies each asset's object (and public copy, if any)
// from src to dst and updates its backend marker. Failures are counted and
// logged without aborting the batch so a single bad object does not block the
// migration. It is separated from the public entry point so it can be exercised
// with two local stores in tests without live R2 credentials.
func migratePlaygroundAssets(ctx context.Context, src, dst storage.AssetStore, assets []model.PlaygroundAsset) (migrated, failed int) {
	for i := range assets {
		asset := assets[i]
		if err := copyObject(ctx, src, dst, asset.StorageKey, asset.Mime, asset.Size); err != nil {
			common.SysError("playground backfill: copy failed for asset " + strconv.Itoa(asset.Id) + ": " + err.Error())
			failed++
			continue
		}

		publicURL := ""
		if asset.Visibility == "public" && asset.PublicKey != "" {
			if err := copyObject(ctx, src, dst, asset.PublicKey, asset.Mime, asset.Size); err != nil {
				common.SysError("playground backfill: public copy failed for asset " + strconv.Itoa(asset.Id) + ": " + err.Error())
			} else if url, ok := dst.PublicURL(asset.PublicKey); ok {
				publicURL = url
			}
		}

		if err := model.SetPlaygroundAssetBackend(asset.Id, dst.Backend(), publicURL); err != nil {
			common.SysError("playground backfill: db update failed for asset " + strconv.Itoa(asset.Id) + ": " + err.Error())
			failed++
			continue
		}
		migrated++
	}
	return migrated, failed
}

func copyObject(ctx context.Context, src, dst storage.AssetStore, key, mime string, size int64) error {
	rc, err := src.Open(ctx, key)
	if err != nil {
		return err
	}
	defer rc.Close()
	return dst.Put(ctx, key, rc, size, mime)
}
