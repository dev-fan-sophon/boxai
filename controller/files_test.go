package controller

import (
	"bytes"
	"encoding/json"
	"mime/multipart"
	"net/http"
	"net/http/httptest"
	"strconv"
	"strings"
	"testing"

	"github.com/dev-fan-sophon/boxai/model"
	"github.com/dev-fan-sophon/boxai/service/storage"
	"github.com/gin-gonic/gin"
	"github.com/glebarez/sqlite"
	"github.com/stretchr/testify/assert"
	"github.com/stretchr/testify/require"
	"gorm.io/gorm"
)

// pngBytes is a 1x1 PNG so content sniffing classifies the upload as an image.
var pngBytes = []byte{
	0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a,
	0x00, 0x00, 0x00, 0x0d, 0x49, 0x48, 0x44, 0x52,
	0x00, 0x00, 0x00, 0x01, 0x00, 0x00, 0x00, 0x01,
}

func setupFilesAPITest(t *testing.T) *gin.Engine {
	t.Helper()
	oldDB := model.DB
	db, err := gorm.Open(sqlite.Open(":memory:"), &gorm.Config{})
	require.NoError(t, err)
	require.NoError(t, db.AutoMigrate(&model.PlaygroundAsset{}))
	model.DB = db
	t.Setenv("STORAGE_BACKEND", "local")
	t.Setenv("PLAYGROUND_ASSETS_DIR", t.TempDir())
	storage.Reset()
	t.Cleanup(func() {
		model.DB = oldDB
		storage.Reset()
		sqlDB, dbErr := db.DB()
		require.NoError(t, dbErr)
		require.NoError(t, sqlDB.Close())
	})

	gin.SetMode(gin.TestMode)
	engine := gin.New()
	// Stand-in for TokenAuth: the caller's user id, overridable per request.
	engine.Use(func(c *gin.Context) {
		userID := 42
		if raw := c.GetHeader("X-Test-User"); raw != "" {
			parsed, err := strconv.Atoi(raw)
			require.NoError(t, err)
			userID = parsed
		}
		c.Set("id", userID)
	})
	engine.POST("/v1/files", UploadFile)
	engine.GET("/v1/files", ListFiles)
	engine.GET("/v1/files/:id", GetFile)
	engine.GET("/v1/files/:id/content", DownloadFile)
	engine.DELETE("/v1/files/:id", DeleteFile)
	return engine
}

func uploadTestFile(t *testing.T, engine *gin.Engine, userID int, name string, content []byte) *httptest.ResponseRecorder {
	t.Helper()
	var body bytes.Buffer
	writer := multipart.NewWriter(&body)
	part, err := writer.CreateFormFile("file", name)
	require.NoError(t, err)
	_, err = part.Write(content)
	require.NoError(t, err)
	require.NoError(t, writer.WriteField("purpose", "vision"))
	require.NoError(t, writer.Close())

	request := httptest.NewRequest(http.MethodPost, "/v1/files", &body)
	request.Header.Set("Content-Type", writer.FormDataContentType())
	request.Header.Set("X-Test-User", strconv.Itoa(userID))
	recorder := httptest.NewRecorder()
	engine.ServeHTTP(recorder, request)
	return recorder
}

func TestFilesAPIRoundTrip(t *testing.T) {
	engine := setupFilesAPITest(t)

	recorder := uploadTestFile(t, engine, 42, "shot.png", pngBytes)
	require.Equal(t, http.StatusOK, recorder.Code, recorder.Body.String())
	var uploaded struct {
		ID       string `json:"id"`
		Object   string `json:"object"`
		Bytes    int64  `json:"bytes"`
		Filename string `json:"filename"`
		Purpose  string `json:"purpose"`
	}
	require.NoError(t, json.Unmarshal(recorder.Body.Bytes(), &uploaded))
	assert.Equal(t, "file", uploaded.Object)
	assert.Equal(t, "vision", uploaded.Purpose)
	assert.Equal(t, "shot.png", uploaded.Filename)
	assert.Equal(t, int64(len(pngBytes)), uploaded.Bytes)
	require.True(t, strings.HasPrefix(uploaded.ID, "file-"), uploaded.ID)

	// Retrieve and list the same handle.
	request := httptest.NewRequest(http.MethodGet, "/v1/files/"+uploaded.ID, nil)
	request.Header.Set("X-Test-User", "42")
	recorder = httptest.NewRecorder()
	engine.ServeHTTP(recorder, request)
	require.Equal(t, http.StatusOK, recorder.Code, recorder.Body.String())
	assert.Contains(t, recorder.Body.String(), uploaded.ID)

	request = httptest.NewRequest(http.MethodGet, "/v1/files", nil)
	request.Header.Set("X-Test-User", "42")
	recorder = httptest.NewRecorder()
	engine.ServeHTTP(recorder, request)
	require.Equal(t, http.StatusOK, recorder.Code, recorder.Body.String())
	assert.Contains(t, recorder.Body.String(), uploaded.ID)

	// Download the exact bytes back.
	request = httptest.NewRequest(http.MethodGet, "/v1/files/"+uploaded.ID+"/content", nil)
	request.Header.Set("X-Test-User", "42")
	recorder = httptest.NewRecorder()
	engine.ServeHTTP(recorder, request)
	require.Equal(t, http.StatusOK, recorder.Code, recorder.Body.String())
	assert.Equal(t, pngBytes, recorder.Body.Bytes())
	assert.Equal(t, "image/png", recorder.Header().Get("Content-Type"))

	// Another account cannot read or delete the file.
	for _, method := range []string{http.MethodGet, http.MethodDelete} {
		request = httptest.NewRequest(method, "/v1/files/"+uploaded.ID, nil)
		request.Header.Set("X-Test-User", "43")
		recorder = httptest.NewRecorder()
		engine.ServeHTTP(recorder, request)
		assert.Equal(t, http.StatusNotFound, recorder.Code, method)
	}

	request = httptest.NewRequest(http.MethodDelete, "/v1/files/"+uploaded.ID, nil)
	request.Header.Set("X-Test-User", "42")
	recorder = httptest.NewRecorder()
	engine.ServeHTTP(recorder, request)
	require.Equal(t, http.StatusOK, recorder.Code, recorder.Body.String())
	assert.Contains(t, recorder.Body.String(), `"deleted":true`)

	request = httptest.NewRequest(http.MethodGet, "/v1/files/"+uploaded.ID, nil)
	request.Header.Set("X-Test-User", "42")
	recorder = httptest.NewRecorder()
	engine.ServeHTTP(recorder, request)
	assert.Equal(t, http.StatusNotFound, recorder.Code)
}

func TestFilesAPIRejectsUnsupportedUpload(t *testing.T) {
	engine := setupFilesAPITest(t)

	// An ELF header is outside the media allowlist.
	recorder := uploadTestFile(t, engine, 42, "payload.bin", []byte{0x7f, 'E', 'L', 'F', 0x02, 0x01, 0x01, 0x00})
	require.Equal(t, http.StatusBadRequest, recorder.Code, recorder.Body.String())
	assert.Contains(t, recorder.Body.String(), "invalid_request_error")

	request := httptest.NewRequest(http.MethodPost, "/v1/files", strings.NewReader("not a form"))
	request.Header.Set("Content-Type", "application/json")
	request.Header.Set("X-Test-User", "42")
	recorder = httptest.NewRecorder()
	engine.ServeHTTP(recorder, request)
	assert.Equal(t, http.StatusBadRequest, recorder.Code)
}

func TestFilesAPIRejectsUnknownHandle(t *testing.T) {
	engine := setupFilesAPITest(t)

	request := httptest.NewRequest(http.MethodGet, "/v1/files/file-9999", nil)
	request.Header.Set("X-Test-User", "42")
	recorder := httptest.NewRecorder()
	engine.ServeHTTP(recorder, request)
	assert.Equal(t, http.StatusNotFound, recorder.Code)

	request = httptest.NewRequest(http.MethodGet, "/v1/files/not-a-file", nil)
	request.Header.Set("X-Test-User", "42")
	recorder = httptest.NewRecorder()
	engine.ServeHTTP(recorder, request)
	assert.Equal(t, http.StatusBadRequest, recorder.Code)
}
