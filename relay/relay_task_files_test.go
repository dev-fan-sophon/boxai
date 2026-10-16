package relay

import (
	"net/http"
	"net/http/httptest"
	"strconv"
	"testing"

	"github.com/dev-fan-sophon/boxai/model"
	relaycommon "github.com/dev-fan-sophon/boxai/relay/common"
	"github.com/dev-fan-sophon/boxai/service/storage"
	"github.com/dev-fan-sophon/boxai/setting/system_setting"
	"github.com/gin-gonic/gin"
	"github.com/glebarez/sqlite"
	"github.com/stretchr/testify/assert"
	"github.com/stretchr/testify/require"
	"gorm.io/gorm"
)

func setupTaskFileReferenceTest(t *testing.T) *model.PlaygroundAsset {
	t.Helper()
	oldDB, oldAddress := model.DB, system_setting.ServerAddress
	db, err := gorm.Open(sqlite.Open(":memory:"), &gorm.Config{})
	require.NoError(t, err)
	require.NoError(t, db.AutoMigrate(&model.PlaygroundAsset{}))
	model.DB = db
	system_setting.ServerAddress = "https://example.test"
	t.Setenv("STORAGE_BACKEND", "local")
	t.Setenv("PLAYGROUND_ASSETS_DIR", t.TempDir())
	t.Setenv("CRYPTO_SECRET", "task-file-reference-secret")
	storage.Reset()
	t.Cleanup(func() {
		model.DB = oldDB
		system_setting.ServerAddress = oldAddress
		storage.Reset()
		sqlDB, dbErr := db.DB()
		require.NoError(t, dbErr)
		require.NoError(t, sqlDB.Close())
	})

	asset := &model.PlaygroundAsset{
		UserId:     9,
		Kind:       "image",
		Source:     model.PlaygroundAssetSourceAttachment,
		Name:       "frame.png",
		StorageKey: "uploads/9/frame.png",
		Backend:    "local",
		Mime:       "image/png",
		Size:       8,
	}
	require.NoError(t, model.CreatePlaygroundAsset(asset))
	return asset
}

func TestTaskSubmitResolvesFileReferences(t *testing.T) {
	asset := setupTaskFileReferenceTest(t)
	handle := "file-" + strconv.Itoa(asset.Id)

	c, _ := gin.CreateTestContext(httptest.NewRecorder())
	c.Set("id", 9)
	c.Set("task_request", relaycommon.TaskSubmitReq{
		Prompt:          "animate the frame",
		Images:          []string{handle},
		ReferenceVideos: []string{"https://example.com/motion.mp4"},
		FirstFrame:      handle,
		Duration:        5,
	})

	require.Nil(t, resolveTaskFileReferences(c))
	resolved, err := relaycommon.GetTaskRequest(c)
	require.NoError(t, err)
	require.Len(t, resolved.Images, 1)
	assert.Contains(t, resolved.Images[0], "media-fetch")
	assert.Contains(t, resolved.FirstFrame, "media-fetch")
	assert.Equal(t, "https://example.com/motion.mp4", resolved.ReferenceVideos[0], "plain URLs stay untouched")
}

func TestTaskSubmitRejectsUnknownFileReference(t *testing.T) {
	setupTaskFileReferenceTest(t)

	c, _ := gin.CreateTestContext(httptest.NewRecorder())
	c.Set("id", 9)
	c.Set("task_request", relaycommon.TaskSubmitReq{Prompt: "animate", Images: []string{"file-9999"}, Duration: 5})

	taskErr := resolveTaskFileReferences(c)
	require.NotNil(t, taskErr)
	assert.Equal(t, http.StatusBadRequest, taskErr.StatusCode)
	assert.True(t, taskErr.LocalError)
	assert.Contains(t, taskErr.Message, "not found")
}
