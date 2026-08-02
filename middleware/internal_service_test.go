package middleware

import (
	"net/http"
	"net/http/httptest"
	"testing"

	"github.com/dev-fan-sophon/boxai/common"
	"github.com/dev-fan-sophon/boxai/model"
	"github.com/gin-contrib/sessions"
	"github.com/gin-contrib/sessions/cookie"
	"github.com/gin-gonic/gin"
	"github.com/stretchr/testify/assert"
	"github.com/stretchr/testify/require"
)

func setupInternalServiceRouter(t *testing.T) *gin.Engine {
	t.Helper()
	db := setupSessionAuthTestDB(t)
	require.NoError(t, db.Create(&model.User{
		Id:       7,
		Username: "acted-user",
		Password: "password",
		Role:     common.RoleCommonUser,
		Status:   common.UserStatusEnabled,
		Group:    "vip",
		AffCode:  "aff-acted",
	}).Error)
	require.NoError(t, db.Create(&model.User{
		Id:       8,
		Username: "banned-user",
		Password: "password",
		Role:     common.RoleCommonUser,
		Status:   common.UserStatusDisabled,
		Group:    "default",
		AffCode:  "aff-banned",
	}).Error)

	gin.SetMode(gin.TestMode)
	router := gin.New()
	router.Use(sessions.Sessions("session", cookie.NewStore([]byte("internal-service-test"))))
	router.POST("/pg/echo", UserOrInternalServiceAuth(), func(c *gin.Context) {
		c.JSON(http.StatusOK, gin.H{
			"id":       c.GetInt("id"),
			"group":    c.GetString("group"),
			"internal": c.GetBool("internal_service"),
		})
	})
	router.GET("/internal/ping", InternalServiceSecretAuth(), func(c *gin.Context) {
		c.JSON(http.StatusOK, gin.H{"ok": true})
	})
	router.GET("/v1/content", TokenOrUserAuth(), func(c *gin.Context) {
		c.JSON(http.StatusOK, gin.H{
			"id":       c.GetInt("id"),
			"internal": c.GetBool("internal_service"),
		})
	})
	return router
}

func TestInternalServiceAuthActAsBilling(t *testing.T) {
	t.Setenv("INTERNAL_SERVICE_SECRET", "test-secret")
	router := setupInternalServiceRouter(t)

	request := httptest.NewRequest(http.MethodPost, "/pg/echo", nil)
	request.Header.Set("X-BoxAI-Internal-Secret", "test-secret")
	request.Header.Set("X-BoxAI-Act-As-User", "7")
	response := httptest.NewRecorder()
	router.ServeHTTP(response, request)

	require.Equal(t, http.StatusOK, response.Code)
	var body struct {
		Id       int    `json:"id"`
		Group    string `json:"group"`
		Internal bool   `json:"internal"`
	}
	require.NoError(t, common.UnmarshalJsonStr(response.Body.String(), &body))
	assert.Equal(t, 7, body.Id)
	assert.Equal(t, "vip", body.Group)
	assert.True(t, body.Internal)
}

func TestTokenOrUserAuthAcceptsInternalActAs(t *testing.T) {
	t.Setenv("INTERNAL_SERVICE_SECRET", "test-secret")
	router := setupInternalServiceRouter(t)

	request := httptest.NewRequest(http.MethodGet, "/v1/content", nil)
	request.Header.Set("X-BoxAI-Internal-Secret", "test-secret")
	request.Header.Set("X-BoxAI-Act-As-User", "7")
	response := httptest.NewRecorder()
	router.ServeHTTP(response, request)

	require.Equal(t, http.StatusOK, response.Code)
	var body struct {
		Id       int  `json:"id"`
		Internal bool `json:"internal"`
	}
	require.NoError(t, common.UnmarshalJsonStr(response.Body.String(), &body))
	assert.Equal(t, 7, body.Id)
	assert.True(t, body.Internal)
}

func TestTokenOrUserAuthRejectsInvalidInternalActAs(t *testing.T) {
	t.Setenv("INTERNAL_SERVICE_SECRET", "test-secret")
	router := setupInternalServiceRouter(t)

	tests := []struct {
		name   string
		secret string
		actAs  string
		want   int
	}{
		{"wrong secret", "bad-secret", "7", http.StatusUnauthorized},
		{"banned user", "test-secret", "8", http.StatusForbidden},
	}
	for _, tt := range tests {
		t.Run(tt.name, func(t *testing.T) {
			request := httptest.NewRequest(http.MethodGet, "/v1/content", nil)
			request.Header.Set("X-BoxAI-Internal-Secret", tt.secret)
			request.Header.Set("X-BoxAI-Act-As-User", tt.actAs)
			response := httptest.NewRecorder()
			router.ServeHTTP(response, request)
			assert.Equal(t, tt.want, response.Code)
		})
	}
}

func TestInternalServiceAuthRejections(t *testing.T) {
	t.Setenv("INTERNAL_SERVICE_SECRET", "test-secret")
	router := setupInternalServiceRouter(t)

	tests := []struct {
		name   string
		secret string
		actAs  string
		want   int
	}{
		{"wrong secret", "bad-secret", "7", http.StatusUnauthorized},
		{"missing act-as", "test-secret", "", http.StatusUnauthorized},
		{"unknown user", "test-secret", "999", http.StatusUnauthorized},
		{"banned user", "test-secret", "8", http.StatusForbidden},
	}
	for _, tt := range tests {
		t.Run(tt.name, func(t *testing.T) {
			request := httptest.NewRequest(http.MethodPost, "/pg/echo", nil)
			request.Header.Set("X-BoxAI-Internal-Secret", tt.secret)
			if tt.actAs != "" {
				request.Header.Set("X-BoxAI-Act-As-User", tt.actAs)
			}
			response := httptest.NewRecorder()
			router.ServeHTTP(response, request)
			assert.Equal(t, tt.want, response.Code)
		})
	}
}

func TestInternalServiceAuthDisabledWithoutSecret(t *testing.T) {
	t.Setenv("INTERNAL_SERVICE_SECRET", "")
	router := setupInternalServiceRouter(t)

	// Presenting any secret while the feature is unconfigured must fail: an
	// empty configured secret never matches.
	request := httptest.NewRequest(http.MethodPost, "/pg/echo", nil)
	request.Header.Set("X-BoxAI-Internal-Secret", "anything")
	request.Header.Set("X-BoxAI-Act-As-User", "7")
	response := httptest.NewRecorder()
	router.ServeHTTP(response, request)
	assert.Equal(t, http.StatusUnauthorized, response.Code)

	pingRequest := httptest.NewRequest(http.MethodGet, "/internal/ping", nil)
	pingRequest.Header.Set("X-BoxAI-Internal-Secret", "")
	pingResponse := httptest.NewRecorder()
	router.ServeHTTP(pingResponse, pingRequest)
	assert.Equal(t, http.StatusUnauthorized, pingResponse.Code)
}

func TestUserOrInternalServiceAuthFallsBackToUserAuth(t *testing.T) {
	t.Setenv("INTERNAL_SERVICE_SECRET", "test-secret")
	router := setupInternalServiceRouter(t)

	// No internal header, no session: the normal user auth path must reject.
	request := httptest.NewRequest(http.MethodPost, "/pg/echo", nil)
	response := httptest.NewRecorder()
	router.ServeHTTP(response, request)
	assert.Equal(t, http.StatusUnauthorized, response.Code)
}
