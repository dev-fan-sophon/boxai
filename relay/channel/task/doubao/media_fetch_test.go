package doubao

import (
	"context"
	"net/http"
	"net/http/httptest"
	"strconv"
	"strings"
	"testing"

	"github.com/dev-fan-sophon/boxai/common"
	"github.com/dev-fan-sophon/boxai/model"
	relaycommon "github.com/dev-fan-sophon/boxai/relay/common"
	"github.com/dev-fan-sophon/boxai/service"
	"github.com/dev-fan-sophon/boxai/setting/system_setting"
	"github.com/gin-gonic/gin"
	"github.com/glebarez/sqlite"
	"github.com/stretchr/testify/assert"
	"github.com/stretchr/testify/require"
	"gorm.io/gorm"
)

func TestPrivateMediaReferences(t *testing.T) {
	t.Setenv("CRYPTO_SECRET", "doubao-test-secret")
	db, err := gorm.Open(sqlite.Open(":memory:"), &gorm.Config{})
	require.NoError(t, err)
	oldDB, oldOrigin := model.DB, system_setting.ServerAddress
	model.DB, system_setting.ServerAddress = db, "https://you-box.com"
	t.Cleanup(func() { model.DB, system_setting.ServerAddress = oldDB, oldOrigin })
	require.NoError(t, db.AutoMigrate(&model.PlaygroundAsset{}))
	for _, kind := range []string{"image", "video", "audio"} {
		t.Run(kind, func(t *testing.T) {
			asset := model.PlaygroundAsset{UserId: 7, Kind: kind, StorageKey: kind, UploadState: "ready"}
			require.NoError(t, db.Create(&asset).Error)
			for _, user := range []int{7, 8} {
				c, _ := gin.CreateTestContext(httptest.NewRecorder())
				c.Set("task_request", relaycommon.TaskSubmitReq{Model: "seedance-2-0", Prompt: "animate", Metadata: map[string]any{"content": []any{
					map[string]any{"type": kind + "_url", kind + "_url": map[string]any{"url": "/api/playground/assets/" + strconv.Itoa(asset.Id) + "/content"}},
				}}})
				body, err := (&TaskAdaptor{}).BuildRequestBody(c, &relaycommon.RelayInfo{UserId: user, ChannelMeta: &relaycommon.ChannelMeta{}})
				if user == 8 {
					require.Error(t, err)
					continue
				}
				require.NoError(t, err)
				var payload requestPayload
				require.NoError(t, common.DecodeJson(body, &payload))
				item := payload.Content[0]
				for _, media := range []*MediaURL{item.ImageURL, item.VideoURL, item.AudioURL} {
					if media != nil {
						u, id, ok := service.ConsumeMediaFetchGrant(strings.TrimPrefix(media.URL, "https://you-box.com/api/playground/media-fetch/"))
						require.True(t, ok)
						assert.Equal(t, 7, u)
						assert.Equal(t, asset.Id, id)
					}
				}
			}
		})
	}
}

func TestInputReferenceReachesNativeRequest(t *testing.T) {
	c, _ := gin.CreateTestContext(httptest.NewRecorder())
	c.Request = httptest.NewRequest(http.MethodPost, "/v1/videos", strings.NewReader(`{"model":"seedance-2-0-mini","prompt":"animate","input_reference":"https://example.com/reference.png"}`))
	c.Request.Header.Set("Content-Type", "application/json")
	info := &relaycommon.RelayInfo{ChannelMeta: &relaycommon.ChannelMeta{}, TaskRelayInfo: &relaycommon.TaskRelayInfo{}}
	a := &TaskAdaptor{}
	require.Nil(t, a.ValidateRequestAndSetAction(c, info))
	body, err := a.BuildRequestBody(c, info)
	require.NoError(t, err)
	var payload requestPayload
	require.NoError(t, common.DecodeJson(body, &payload))
	require.NotEmpty(t, payload.Content)
	require.NotNil(t, payload.Content[0].ImageURL)
	assert.Equal(t, "https://example.com/reference.png", payload.Content[0].ImageURL.URL)
}

func TestFetchTaskContext(t *testing.T) {
	server := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		assert.Equal(t, "/api/v3/contents/generations/tasks/cgt-test", r.URL.Path)
		assert.Equal(t, "Bearer test-key", r.Header.Get("Authorization"))
		w.WriteHeader(http.StatusOK)
	}))
	defer server.Close()
	a := &TaskAdaptor{}
	resp, err := a.FetchTask(server.URL, "test-key", map[string]any{"task_id": "cgt-test"}, "")
	require.NoError(t, err)
	resp.Body.Close()
	ctx, cancel := context.WithCancel(context.Background())
	cancel()
	_, err = a.FetchTaskWithContext(ctx, server.URL, "test-key", map[string]any{"task_id": "cgt-test"}, "")
	require.ErrorIs(t, err, context.Canceled)
}
