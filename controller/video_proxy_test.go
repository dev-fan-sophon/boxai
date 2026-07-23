package controller

import (
	"fmt"
	"net/http"
	"net/http/httptest"
	"strconv"
	"strings"
	"testing"

	"github.com/QuantumNous/new-api/common"
	"github.com/QuantumNous/new-api/constant"
	"github.com/QuantumNous/new-api/model"
	"github.com/QuantumNous/new-api/service"
	"github.com/gin-gonic/gin"
	"github.com/glebarez/sqlite"
	"github.com/stretchr/testify/assert"
	"github.com/stretchr/testify/require"
	"gorm.io/gorm"
)

func setupVideoProxyTestDB(t *testing.T) *gorm.DB {
	t.Helper()

	gin.SetMode(gin.TestMode)
	common.SetDatabaseTypes(common.DatabaseTypeSQLite, common.DatabaseTypeSQLite)
	common.MemoryCacheEnabled = false

	dsn := fmt.Sprintf("file:%s?mode=memory&cache=shared", strings.ReplaceAll(t.Name(), "/", "_"))
	db, err := gorm.Open(sqlite.Open(dsn), &gorm.Config{})
	require.NoError(t, err)
	model.DB = db
	require.NoError(t, db.AutoMigrate(&model.Channel{}, &model.Task{}))

	t.Cleanup(func() {
		sqlDB, err := db.DB()
		if err == nil {
			_ = sqlDB.Close()
		}
	})
	return db
}

func TestVideoProxyUsesStoredResultForXAITaskOnOpenAIChannel(t *testing.T) {
	db := setupVideoProxyTestDB(t)
	baseURL := "https://sub2api.example"
	require.NoError(t, db.Create(&model.Channel{
		Id:      7,
		Type:    constant.ChannelTypeOpenAI,
		Key:     "upstream-key",
		Name:    "grok",
		BaseURL: &baseURL,
	}).Error)
	require.NoError(t, db.Create(&model.Task{
		TaskID:    "task_xai_video",
		Platform:  constant.TaskPlatform(strconv.Itoa(constant.ChannelTypeXai)),
		UserId:    42,
		ChannelId: 7,
		Status:    model.TaskStatusSuccess,
		PrivateData: model.TaskPrivateData{
			UpstreamTaskID: "upstream-request-id",
			ResultURL:      "data:video/mp4;base64,AAAAGGZ0eXBpc29t",
		},
	}).Error)

	router := gin.New()
	router.GET("/v1/videos/:task_id/content", func(c *gin.Context) {
		c.Set("id", 42)
		VideoProxy(c)
	})

	recorder := httptest.NewRecorder()
	request := httptest.NewRequest(http.MethodGet, "/v1/videos/task_xai_video/content", nil)
	router.ServeHTTP(recorder, request)

	require.Equal(t, http.StatusOK, recorder.Code)
	assert.Equal(t, "video/mp4", recorder.Header().Get("Content-Type"))
	assert.Equal(t, "private, no-store", recorder.Header().Get("Cache-Control"))
	assert.Equal(t, "nosniff", recorder.Header().Get("X-Content-Type-Options"))
	assert.Equal(t, []byte{0, 0, 0, 24, 'f', 't', 'y', 'p', 'i', 's', 'o', 'm'}, recorder.Body.Bytes())
}

func TestVideoProxyDoesNotExposeAnotherUsersTask(t *testing.T) {
	db := setupVideoProxyTestDB(t)
	require.NoError(t, db.Create(&model.Task{
		TaskID:   "task_private_video",
		Platform: constant.TaskPlatform(strconv.Itoa(constant.ChannelTypeXai)),
		UserId:   42,
		Status:   model.TaskStatusSuccess,
		PrivateData: model.TaskPrivateData{
			ResultURL: "data:video/mp4;base64,dmlkZW8=",
		},
	}).Error)

	router := gin.New()
	router.GET("/v1/videos/:task_id/content", func(c *gin.Context) {
		c.Set("id", 99)
		VideoProxy(c)
	})

	recorder := httptest.NewRecorder()
	request := httptest.NewRequest(http.MethodGet, "/v1/videos/task_private_video/content", nil)
	router.ServeHTTP(recorder, request)

	assert.Equal(t, http.StatusNotFound, recorder.Code)
}

func TestCopyVideoResponseHeadersExcludesCookies(t *testing.T) {
	source := http.Header{
		"Content-Type":  {"video/mp4"},
		"Content-Range": {"bytes 0-9/10"},
		"Set-Cookie":    {"session=attacker"},
		"Location":      {"https://private.example"},
		"Connection":    {"keep-alive"},
	}
	destination := http.Header{}

	copyVideoResponseHeaders(destination, source)

	assert.Empty(t, destination.Get("Content-Type"))
	assert.Equal(t, "bytes 0-9/10", destination.Get("Content-Range"))
	assert.Empty(t, destination.Get("Set-Cookie"))
	assert.Empty(t, destination.Get("Location"))
	assert.Empty(t, destination.Get("Connection"))
}

func TestUntrustedVideoResultURLIncludesNonXAIProviders(t *testing.T) {
	assert.True(t, isUntrustedVideoResultURL(false, constant.ChannelTypeGemini))
	assert.True(t, isUntrustedVideoResultURL(false, constant.ChannelTypeVertexAi))
	assert.True(t, isUntrustedVideoResultURL(false, constant.ChannelTypeKling))
	assert.True(t, isUntrustedVideoResultURL(true, constant.ChannelTypeOpenAI))
	assert.False(t, isUntrustedVideoResultURL(false, constant.ChannelTypeOpenAI))
	assert.False(t, isUntrustedVideoResultURL(false, constant.ChannelTypeSora))
}

func TestVideoProxyResolvesRelativeXAIResultAgainstChannel(t *testing.T) {
	db := setupVideoProxyTestDB(t)
	service.InitHttpClient()
	video := []byte{0, 0, 0, 24, 'f', 't', 'y', 'p', 'i', 's', 'o', 'm'}
	upstream := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		assert.Equal(t, "/v1/videos/upstream-id/content", r.URL.Path)
		assert.Equal(t, "Bearer selected-key", r.Header.Get("Authorization"))
		w.Header().Set("Content-Type", "video/mp4")
		_, _ = w.Write(video)
	}))
	t.Cleanup(upstream.Close)
	require.NoError(t, db.Create(&model.Channel{Id: 8, Type: constant.ChannelTypeOpenAI, Key: "fallback-key", BaseURL: &upstream.URL}).Error)
	require.NoError(t, db.Create(&model.Task{
		TaskID: "task_relative_xai", Platform: constant.TaskPlatform(strconv.Itoa(constant.ChannelTypeXai)),
		UserId: 42, ChannelId: 8, Status: model.TaskStatusSuccess,
		PrivateData: model.TaskPrivateData{Key: "selected-key", ResultURL: "/v1/videos/upstream-id/content"},
	}).Error)

	router := gin.New()
	router.GET("/v1/videos/:task_id/content", func(c *gin.Context) {
		c.Set("id", 42)
		VideoProxy(c)
	})
	recorder := httptest.NewRecorder()
	router.ServeHTTP(recorder, httptest.NewRequest(http.MethodGet, "/v1/videos/task_relative_xai/content", nil))

	require.Equal(t, http.StatusOK, recorder.Code)
	assert.Equal(t, video, recorder.Body.Bytes())
}

func TestVideoProxyDoesNotTrustProtocolRelativeXAIResult(t *testing.T) {
	db := setupVideoProxyTestDB(t)
	baseURL := "https://operator.example"
	require.NoError(t, db.Create(&model.Channel{Id: 9, Type: constant.ChannelTypeOpenAI, Key: "fallback-key", BaseURL: &baseURL}).Error)
	require.NoError(t, db.Create(&model.Task{
		TaskID: "task_protocol_relative", Platform: constant.TaskPlatform(strconv.Itoa(constant.ChannelTypeXai)),
		UserId: 42, ChannelId: 9, Status: model.TaskStatusSuccess,
		PrivateData: model.TaskPrivateData{Key: "selected-key", ResultURL: "//127.0.0.1/video"},
	}).Error)

	router := gin.New()
	router.GET("/v1/videos/:task_id/content", func(c *gin.Context) {
		c.Set("id", 42)
		VideoProxy(c)
	})
	recorder := httptest.NewRecorder()
	router.ServeHTTP(recorder, httptest.NewRequest(http.MethodGet, "/v1/videos/task_protocol_relative/content", nil))

	assert.Equal(t, http.StatusForbidden, recorder.Code)
}
