package service

import (
	"context"
	"encoding/base64"
	"fmt"
	"io"
	"strings"
	"testing"

	"github.com/dev-fan-sophon/boxai/model"
	"github.com/dev-fan-sophon/boxai/service/storage"
	"github.com/stretchr/testify/assert"
	"github.com/stretchr/testify/require"
	"gorm.io/gorm"
)

func TestPersistPlaygroundOutputDataURL(t *testing.T) {
	require.NoError(t, model.DB.AutoMigrate(&model.PlaygroundAsset{}))
	t.Cleanup(func() { model.DB.Exec("DELETE FROM playground_assets") })

	root := t.TempDir()
	t.Setenv("STORAGE_BACKEND", "local")
	t.Setenv("PLAYGROUND_ASSETS_DIR", root)
	storage.Reset()
	t.Cleanup(storage.Reset)

	png := []byte{
		0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a,
		0x00, 0x00, 0x00, 0x0d, 0x49, 0x48, 0x44, 0x52,
		0x00, 0x00, 0x00, 0x01, 0x00, 0x00, 0x00, 0x01,
	}
	dataURL := "data:image/png;base64," + base64.StdEncoding.EncodeToString(png)

	asset, err := PersistPlaygroundOutput(context.Background(), 99, "image", dataURL)
	require.NoError(t, err)
	require.NotNil(t, asset)
	assert.Equal(t, "image", asset.Kind)
	assert.Equal(t, "image/png", asset.Mime)
	assert.Equal(t, "local", asset.Backend)
	assert.True(t, strings.HasPrefix(asset.StorageKey, "outputs/99/"), "key: %s", asset.StorageKey)
	assert.NotZero(t, asset.Id)

	_, body, err := OpenPlaygroundAssetContent(context.Background(), asset.Backend, asset.StorageKey, 0)
	require.NoError(t, err)
	got, err := io.ReadAll(body)
	require.NoError(t, body.Close())
	require.NoError(t, err)
	assert.Equal(t, png, got)
}

func TestPersistPlaygroundVideoDataURL(t *testing.T) {
	require.NoError(t, model.DB.AutoMigrate(&model.PlaygroundAsset{}))
	t.Cleanup(func() { model.DB.Exec("DELETE FROM playground_assets") })

	root := t.TempDir()
	t.Setenv("STORAGE_BACKEND", "local")
	t.Setenv("PLAYGROUND_ASSETS_DIR", root)
	storage.Reset()
	t.Cleanup(storage.Reset)

	// Minimal mp4 ftyp box header + payload; declared mime drives the kind.
	mp4 := append([]byte{0x00, 0x00, 0x00, 0x18, 0x66, 0x74, 0x79, 0x70}, []byte("isom video bytes")...)
	dataURL := "data:video/mp4;base64," + base64.StdEncoding.EncodeToString(mp4)

	asset, err := PersistPlaygroundOutput(context.Background(), 5, "video", dataURL)
	require.NoError(t, err)
	require.NotNil(t, asset)
	assert.Equal(t, "video", asset.Kind)
	assert.Equal(t, "video/mp4", asset.Mime)
	assert.True(t, strings.HasPrefix(asset.StorageKey, "outputs/5/"), "key: %s", asset.StorageKey)
}

func TestPlaygroundRunTaskLinkage(t *testing.T) {
	require.NoError(t, model.DB.AutoMigrate(&model.PlaygroundRun{}))
	t.Cleanup(func() { model.DB.Exec("DELETE FROM playground_runs") })

	_, err := model.GetPlaygroundRunByTaskId("missing", 3)
	assert.Error(t, err)

	run := &model.PlaygroundRun{UserId: 3, Modality: "video", TaskId: "task-abc"}
	require.NoError(t, model.CreatePlaygroundRun(run))
	otherRun := &model.PlaygroundRun{UserId: 4, Modality: "video", TaskId: "task-abc"}
	require.NoError(t, model.CreatePlaygroundRun(otherRun))
	chatRun := &model.PlaygroundRun{UserId: 3, Modality: "chat", TaskId: "task-chat"}
	require.NoError(t, model.CreatePlaygroundRun(chatRun))

	got, err := model.GetPlaygroundRunByTaskId("task-abc", 3)
	require.NoError(t, err)
	assert.Equal(t, run.Id, got.Id)
	assert.Equal(t, 0, got.AssetId)
	otherGot, err := model.GetPlaygroundRunByTaskId("task-abc", 4)
	require.NoError(t, err)
	assert.Equal(t, otherRun.Id, otherGot.Id)
	_, err = model.GetPlaygroundRunByTaskId("task-chat", 3)
	require.ErrorIs(t, err, gorm.ErrRecordNotFound)

	assert.Error(t, model.UpdatePlaygroundRunResult(run.Id, 4, 99, "/wrong-user"))
	got, err = model.GetPlaygroundRunByTaskId("task-abc", 3)
	require.NoError(t, err)
	assert.Equal(t, 0, got.AssetId)
	require.NoError(t, model.UpdatePlaygroundRunResult(run.Id, 3, 77, "/api/playground/assets/77/content"))
	got, err = model.GetPlaygroundRunByTaskId("task-abc", 3)
	require.NoError(t, err)
	assert.Equal(t, 77, got.AssetId)
	assert.Equal(t, "/api/playground/assets/77/content", got.ResultURL)
	otherGot, err = model.GetPlaygroundRunByTaskId("task-abc", 4)
	require.NoError(t, err)
	assert.Equal(t, 0, otherGot.AssetId)
}

func TestUnpersistedVideoRunQuerySkipsIneligibleRows(t *testing.T) {
	require.NoError(t, model.DB.AutoMigrate(&model.PlaygroundRun{}, &model.Task{}))
	t.Cleanup(func() {
		model.DB.Where("user_id = ?", 303).Delete(&model.PlaygroundRun{})
		model.DB.Where("user_id = ?", 303).Delete(&model.Task{})
	})

	for i := 0; i < 10; i++ {
		taskID := fmt.Sprintf("pending-%d", i)
		require.NoError(t, model.DB.Create(&model.Task{
			TaskID: taskID, UserId: 303, Status: model.TaskStatusSubmitted,
		}).Error)
		require.NoError(t, model.CreatePlaygroundRun(&model.PlaygroundRun{
			UserId: 303, Modality: "video", TaskId: taskID,
		}))
	}
	require.NoError(t, model.DB.Create(&model.Task{
		TaskID: "successful-video", UserId: 303, Status: model.TaskStatusSuccess,
	}).Error)
	require.NoError(t, model.CreatePlaygroundRun(&model.PlaygroundRun{
		UserId: 303, Modality: "video", TaskId: "successful-video",
	}))

	runs, err := model.ListUnpersistedSuccessfulVideoRuns(0, 10)
	require.NoError(t, err)
	require.Len(t, runs, 1)
	assert.Equal(t, "successful-video", runs[0].TaskId)
	assert.True(t, model.HasUnpersistedSuccessfulVideoRuns())
}

func TestSeedAndListPlaygroundAgents(t *testing.T) {
	require.NoError(t, model.DB.AutoMigrate(&model.PlaygroundAgent{}))
	t.Cleanup(func() { model.DB.Exec("DELETE FROM playground_agents") })

	require.NoError(t, model.SeedPlaygroundAgentsIfEmpty())
	// Seeding is idempotent: a second call is a no-op.
	require.NoError(t, model.SeedPlaygroundAgentsIfEmpty())

	agents, err := model.ListPlaygroundAgents()
	require.NoError(t, err)
	assert.Equal(t, 8, len(agents))
	assert.Equal(t, "api-docs", agents[0].Slug) // ordered by sort_order

	require.NoError(t, model.DB.Model(&model.PlaygroundAgent{}).
		Where("slug = ?", "pricing").Update("enabled", false).Error)
	agents, err = model.ListPlaygroundAgents()
	require.NoError(t, err)
	assert.Equal(t, 7, len(agents)) // disabled agents are excluded
}

func TestPersistPlaygroundOutputNotPersistable(t *testing.T) {
	root := t.TempDir()
	t.Setenv("STORAGE_BACKEND", "local")
	t.Setenv("PLAYGROUND_ASSETS_DIR", root)
	storage.Reset()
	t.Cleanup(storage.Reset)

	for _, ref := range []string{"", "   ", "/api/playground/assets/1/content", "ftp://example.com/x.png"} {
		asset, err := PersistPlaygroundOutput(context.Background(), 1, "image", ref)
		require.NoError(t, err, "ref=%q", ref)
		assert.Nil(t, asset, "ref=%q", ref)
	}
}

func TestResolveOutputMimeRejectsSpoofedOrMismatchedContent(t *testing.T) {
	_, _, err := resolveOutputMime([]byte("<html>not an image</html>"), "image/png", "image")
	assert.Error(t, err)

	png := []byte{0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 0x00, 0x00, 0x00, 0x0d}
	_, _, err = resolveOutputMime(png, "image/png", "video")
	assert.Error(t, err)
}

func TestResolveOutputMimeRecognizesMediaContainers(t *testing.T) {
	tests := []struct {
		name, declared, modality, wantMime, wantKind string
		content                                      []byte
	}{
		{name: "mp4 video", declared: "video/mp4", modality: "video", wantMime: "video/mp4", wantKind: "video", content: []byte{0, 0, 0, 24, 'f', 't', 'y', 'p', 'i', 's', 'o', 'm'}},
		{name: "quicktime", declared: "video/quicktime", modality: "video", wantMime: "video/quicktime", wantKind: "video", content: []byte{0, 0, 0, 24, 'f', 't', 'y', 'p', 'q', 't', ' ', ' '}},
		{name: "m4a audio", declared: "audio/m4a", modality: "audio", wantMime: "audio/m4a", wantKind: "audio", content: []byte{0, 0, 0, 24, 'f', 't', 'y', 'p', 'M', '4', 'A', ' '}},
		{name: "webm video", declared: "video/webm", modality: "video", wantMime: "video/webm", wantKind: "video", content: []byte{0x1a, 0x45, 0xdf, 0xa3}},
		{name: "webm audio", declared: "audio/webm", modality: "audio", wantMime: "audio/webm", wantKind: "audio", content: []byte{0x1a, 0x45, 0xdf, 0xa3}},
		{name: "ogg audio", declared: "audio/ogg", modality: "audio", wantMime: "audio/ogg", wantKind: "audio", content: []byte("OggS")},
	}

	for _, test := range tests {
		t.Run(test.name, func(t *testing.T) {
			mimeType, kind, err := resolveOutputMime(test.content, test.declared, test.modality)
			require.NoError(t, err)
			assert.Equal(t, test.wantMime, mimeType)
			assert.Equal(t, test.wantKind, kind)
		})
	}
}
