package service

import (
	"context"
	"encoding/base64"
	"io"
	"os"
	"path/filepath"
	"testing"
	"time"

	"github.com/dev-fan-sophon/boxai/model"
	"github.com/dev-fan-sophon/boxai/service/storage"
	"github.com/stretchr/testify/assert"
	"github.com/stretchr/testify/require"
	"gorm.io/gorm"
)

func TestVideoOutputReconciliationOrdinaryAPIRecovery(t *testing.T) {
	truncate(t)
	require.NoError(t, model.DB.AutoMigrate(&model.PlaygroundRun{}, &model.PlaygroundAsset{}))
	t.Cleanup(func() {
		model.DB.Exec("DELETE FROM playground_runs")
		model.DB.Exec("DELETE FROM playground_assets")
	})
	t.Setenv("STORAGE_BACKEND", "local")
	root := t.TempDir()
	t.Setenv("PLAYGROUND_ASSETS_DIR", root)
	// Block the output directory to simulate unavailable object storage.
	require.NoError(t, os.WriteFile(filepath.Join(root, "outputs"), []byte("blocked"), 0600))
	storage.Reset()
	t.Cleanup(storage.Reset)
	mp4 := []byte{0, 0, 0, 24, 'f', 't', 'y', 'p', 'i', 's', 'o', 'm'}
	ref := "data:video/mp4;base64," + base64.StdEncoding.EncodeToString(mp4)
	task := &model.Task{TaskID: "ordinary-output", UserId: 77, Platform: "2", Status: model.TaskStatusSuccess,
		FinishTime: time.Now().Unix(), Quota: 123, BillingSettled: true,
		PrivateData: model.TaskPrivateData{ResultURL: ref}}
	require.NoError(t, model.DB.Create(task).Error)
	historic := &model.Task{TaskID: "historic-output", UserId: 77, Platform: "2", Status: model.TaskStatusSuccess,
		CreatedAt: 100, FinishTime: 100, PrivateData: model.TaskPrivateData{ResultURL: ref}}
	require.NoError(t, model.DB.Create(historic).Error)

	require.NoError(t, RunVideoOutputReconciliation(context.Background()))
	require.NoError(t, model.DB.First(task, task.ID).Error)
	assert.Zero(t, task.OutputAssetID)
	assert.Equal(t, 1, task.OutputAttempts)
	assert.Greater(t, task.OutputNextAt, time.Now().Unix())
	assert.Equal(t, model.TaskStatus(model.TaskStatusSuccess), task.Status)
	assert.Equal(t, 123, task.Quota)
	assert.True(t, task.BillingSettled)
	require.NoError(t, RunVideoOutputReconciliation(context.Background()))
	require.NoError(t, model.DB.First(task, task.ID).Error)
	assert.Equal(t, 1, task.OutputAttempts, "backoff must survive another scheduler pass")

	// An expired claim (process died mid-download) is durable retryable work.
	require.NoError(t, os.Remove(filepath.Join(root, "outputs")))
	require.NoError(t, model.DB.Model(task).Updates(map[string]any{"private_data": task.PrivateData, "output_next_at": time.Now().Unix() - 1}).Error)
	require.NoError(t, RunVideoOutputReconciliation(context.Background()))
	require.NoError(t, model.DB.First(task, task.ID).Error)
	require.NotZero(t, task.OutputAssetID)
	assert.Equal(t, 2, task.OutputAttempts)
	assert.Equal(t, "/v1/videos/ordinary-output/content", task.GetResultURL())
	asset, err := model.GetPlaygroundAsset(task.OutputAssetID, task.UserId)
	require.NoError(t, err)
	body, err := OpenPlaygroundAssetContentDirect(context.Background(), asset.Backend, asset.StorageKey)
	require.NoError(t, err)
	got, err := io.ReadAll(body)
	require.NoError(t, body.Close())
	require.NoError(t, err)
	assert.Equal(t, mp4, got)
	require.NoError(t, RunVideoOutputReconciliation(context.Background()))
	var count int64
	require.NoError(t, model.DB.Model(&model.PlaygroundAsset{}).Count(&count).Error)
	assert.EqualValues(t, 1, count)
	require.NoError(t, model.DB.First(historic, historic.ID).Error)
	assert.Zero(t, historic.OutputAttempts)

	// A run linked after storage completion is repaired without re-downloading.
	run := &model.PlaygroundRun{TaskId: task.TaskID, UserId: task.UserId, Modality: "video"}
	require.NoError(t, model.CreatePlaygroundRun(run))
	require.NoError(t, RunVideoOutputReconciliation(context.Background()))
	require.NoError(t, model.DB.First(run, run.Id).Error)
	assert.Equal(t, task.OutputAssetID, run.AssetId)
}

func TestVideoOutputBacklogDoesNotHideFreshCompletions(t *testing.T) {
	truncate(t)
	require.NoError(t, model.DB.AutoMigrate(&model.PlaygroundRun{}, &model.PlaygroundAsset{}))
	t.Setenv("STORAGE_BACKEND", "local")
	t.Setenv("PLAYGROUND_ASSETS_DIR", t.TempDir())
	storage.Reset()
	t.Cleanup(func() { storage.Reset(); model.DB.Exec("DELETE FROM playground_assets") })
	ref := "data:video/mp4;base64," + base64.StdEncoding.EncodeToString([]byte{0, 0, 0, 24, 'f', 't', 'y', 'p', 'i', 's', 'o', 'm'})
	var tasks []*model.Task
	for i := 0; i < 10; i++ {
		task := &model.Task{TaskID: "backlog-" + time.Unix(int64(i), 0).Format("150405"), UserId: 77, Platform: "2", Status: model.TaskStatusSuccess, FinishTime: time.Now().Unix() - int64(10-i), PrivateData: model.TaskPrivateData{ResultURL: ref}}
		require.NoError(t, model.DB.Create(task).Error)
		tasks = append(tasks, task)
	}
	require.NoError(t, RunVideoOutputReconciliation(context.Background()))
	for _, index := range []int{0, 9} {
		require.NoError(t, model.DB.First(tasks[index], tasks[index].ID).Error)
		assert.NotZero(t, tasks[index].OutputAssetID, "both oldest and latest must progress")
	}
}

func TestVideoOutputLostClaimCleansOrphan(t *testing.T) {
	truncate(t)
	require.NoError(t, model.DB.AutoMigrate(&model.PlaygroundRun{}, &model.PlaygroundAsset{}))
	t.Cleanup(func() {
		model.DB.Exec("DELETE FROM playground_runs")
		model.DB.Exec("DELETE FROM playground_assets")
	})
	root := t.TempDir()
	t.Setenv("STORAGE_BACKEND", "local")
	t.Setenv("PLAYGROUND_ASSETS_DIR", root)
	storage.Reset()
	t.Cleanup(storage.Reset)
	mp4 := []byte{0, 0, 0, 24, 'f', 't', 'y', 'p', 'i', 's', 'o', 'm'}
	task := &model.Task{TaskID: "lost-claim", UserId: 77, Platform: "2", Status: model.TaskStatusSuccess,
		FinishTime: time.Now().Unix(), PrivateData: model.TaskPrivateData{ResultURL: "data:video/mp4;base64," + base64.StdEncoding.EncodeToString(mp4)}}
	require.NoError(t, model.DB.Create(task).Error)
	// Deterministically simulate another worker obtaining a newer claim while
	// this worker is storing the media, before the final attachment CAS.
	const callback = "test:video-output-lost-claim"
	require.NoError(t, model.DB.Callback().Create().After("gorm:commit_or_rollback_transaction").Register(callback, func(tx *gorm.DB) {
		if tx.Statement.Table == "playground_assets" {
			require.NoError(t, model.DB.Model(&model.Task{}).Where("id = ?", task.ID).Update("output_attempts", 2).Error)
		}
	}))
	t.Cleanup(func() { model.DB.Callback().Create().Remove(callback) })
	require.NoError(t, RunVideoOutputReconciliation(context.Background()))
	require.NoError(t, model.DB.First(task, task.ID).Error)
	assert.Zero(t, task.OutputAssetID)
	assert.Equal(t, 2, task.OutputAttempts)
	var count int64
	require.NoError(t, model.DB.Model(&model.PlaygroundAsset{}).Count(&count).Error)
	assert.Zero(t, count)
	files, err := filepath.Glob(filepath.Join(root, "outputs", "77", "*"))
	require.NoError(t, err)
	assert.Empty(t, files)
}
