package router

import (
	"fmt"
	"net/http"
	"net/http/httptest"
	"os"
	"strings"
	"testing"

	"github.com/dev-fan-sophon/boxai/common"
	"github.com/dev-fan-sophon/boxai/constant"
	"github.com/dev-fan-sophon/boxai/model"
	"github.com/gin-gonic/gin"
	"github.com/stretchr/testify/assert"
	"github.com/stretchr/testify/require"
)

const relayModelsTestKey = "relaymodelstestkey"

func TestElevenLabsRoutesAreRegisteredWithoutClaimingOpenAIAudio(t *testing.T) {
	gin.SetMode(gin.TestMode)
	engine := gin.New()
	SetRelayRouter(engine)
	routes := make(map[string]struct{})
	for _, route := range engine.Routes() {
		routes[route.Method+" "+route.Path] = struct{}{}
	}
	for _, route := range []string{
		"POST /v1/audio/speech",
		"POST /v1/audio/transcriptions",
		"POST /v1/sound-generation",
		"POST /v1/music/stream",
		"POST /v1/speech-to-speech/*path",
		"GET /elevenlabs/*path",
		"POST /elevenlabs/*path",
	} {
		assert.Contains(t, routes, route)
	}
}

func TestModelRoutesSupportOpenAIAndGeminiAuthentication(t *testing.T) {
	setupRelayRouterTestDB(t)

	engine := gin.New()
	SetRelayRouter(engine)

	tests := []struct {
		name       string
		path       string
		headerName string
		header     string
		wantField  string
		wantValue  string
	}{
		{
			name:       "OpenAI list with bearer token",
			path:       "/v1/models",
			headerName: "Authorization",
			header:     "Bearer " + relayModelsTestKey,
			wantField:  "object",
			wantValue:  "list",
		},
		{
			name:       "Gemini stable list with API key header",
			path:       "/v1/models",
			headerName: "x-goog-api-key",
			header:     relayModelsTestKey,
			wantField:  "models",
		},
		{
			name:      "Gemini stable list with query key",
			path:      "/v1/models?key=" + relayModelsTestKey,
			wantField: "models",
		},
		{
			name:       "Gemini beta list with bearer token",
			path:       "/v1beta/models",
			headerName: "Authorization",
			header:     "Bearer " + relayModelsTestKey,
			wantField:  "models",
		},
		{
			name:      "Gemini stable retrieve with query key",
			path:      "/v1/models/gemini-2.0-flash?key=" + relayModelsTestKey,
			wantField: "name",
			wantValue: "gemini-2.0-flash",
		},
		{
			name:       "Gemini stable retrieve with API key header",
			path:       "/v1/models/gemini-2.0-flash",
			headerName: "x-goog-api-key",
			header:     relayModelsTestKey,
			wantField:  "name",
			wantValue:  "gemini-2.0-flash",
		},
		{
			name:       "Gemini beta retrieve with bearer token",
			path:       "/v1beta/models/gemini-2.0-flash",
			headerName: "Authorization",
			header:     "Bearer " + relayModelsTestKey,
			wantField:  "name",
			wantValue:  "gemini-2.0-flash",
		},
	}

	for _, test := range tests {
		t.Run(test.name, func(t *testing.T) {
			recorder := httptest.NewRecorder()
			request := httptest.NewRequest(http.MethodGet, test.path, nil)
			if test.headerName != "" {
				request.Header.Set(test.headerName, test.header)
			}

			engine.ServeHTTP(recorder, request)

			require.Equal(t, http.StatusOK, recorder.Code)
			var payload map[string]any
			require.NoError(t, common.Unmarshal(recorder.Body.Bytes(), &payload))
			assert.Contains(t, payload, test.wantField)
			assert.NotContains(t, payload, "error")
			if test.wantValue != "" {
				assert.Equal(t, test.wantValue, payload[test.wantField])
			}
		})
	}
}

func setupRelayRouterTestDB(t *testing.T) {
	t.Helper()

	gin.SetMode(gin.TestMode)
	originalDB := model.DB
	originalLogDB := model.LOG_DB
	originalIsMasterNode := common.IsMasterNode
	originalRedisEnabled := common.RedisEnabled
	originalSQLitePath := common.SQLitePath
	originalMainDatabaseType := common.MainDatabaseType()
	originalLogDatabaseType := common.LogDatabaseType()
	originalSQLDSN, hadSQLDSN := os.LookupEnv("SQL_DSN")

	common.IsMasterNode = false
	common.RedisEnabled = false
	common.SQLitePath = fmt.Sprintf("file:%s?mode=memory&cache=shared", strings.ReplaceAll(t.Name(), "/", "_"))
	common.SetDatabaseTypes(common.DatabaseTypeSQLite, common.DatabaseTypeSQLite)
	require.NoError(t, os.Setenv("SQL_DSN", "local"))
	require.NoError(t, model.InitDB())
	model.LOG_DB = model.DB
	require.NoError(t, model.DB.AutoMigrate(&model.User{}, &model.Token{}, &model.Channel{}, &model.Ability{}))

	user := model.User{
		Username: "models-user",
		Status:   common.UserStatusEnabled,
		Group:    "default",
		Quota:    100,
	}
	require.NoError(t, model.DB.Create(&user).Error)
	require.NoError(t, model.DB.Create(&model.Token{
		UserId:             user.Id,
		Key:                relayModelsTestKey,
		Status:             common.TokenStatusEnabled,
		ExpiredTime:        -1,
		UnlimitedQuota:     true,
		ModelLimitsEnabled: true,
		ModelLimits:        "gemini-2.0-flash",
	}).Error)
	channel := model.Channel{
		Type:   constant.ChannelTypeGemini,
		Name:   "gemini-models",
		Key:    "upstream-key",
		Status: common.ChannelStatusEnabled,
		Group:  "default",
		Models: "gemini-2.0-flash",
	}
	require.NoError(t, model.DB.Create(&channel).Error)
	require.NoError(t, model.DB.Create(&model.Ability{
		Group:     "default",
		Model:     "gemini-2.0-flash",
		ChannelId: channel.Id,
		Enabled:   true,
	}).Error)

	t.Cleanup(func() {
		if sqlDB, err := model.DB.DB(); err == nil {
			_ = sqlDB.Close()
		}
		model.DB = originalDB
		model.LOG_DB = originalLogDB
		common.IsMasterNode = originalIsMasterNode
		common.RedisEnabled = originalRedisEnabled
		common.SQLitePath = originalSQLitePath
		common.SetDatabaseTypes(originalMainDatabaseType, originalLogDatabaseType)
		if hadSQLDSN {
			require.NoError(t, os.Setenv("SQL_DSN", originalSQLDSN))
		} else {
			require.NoError(t, os.Unsetenv("SQL_DSN"))
		}
	})
}
