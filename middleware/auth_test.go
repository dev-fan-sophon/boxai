package middleware

import (
	"fmt"
	"net/http"
	"net/http/httptest"
	"strings"
	"testing"

	"github.com/dev-fan-sophon/boxai/common"
	"github.com/dev-fan-sophon/boxai/model"
	"github.com/dev-fan-sophon/boxai/service/authz"
	"github.com/gin-contrib/sessions"
	"github.com/gin-contrib/sessions/cookie"
	"github.com/gin-gonic/gin"
	"github.com/glebarez/sqlite"
	"github.com/stretchr/testify/assert"
	"github.com/stretchr/testify/require"
	"gorm.io/gorm"
)

func setupSessionAuthTestDB(t *testing.T) *gorm.DB {
	t.Helper()

	previousDB := model.DB
	dsn := fmt.Sprintf("file:%s?mode=memory&cache=shared", strings.ReplaceAll(t.Name(), "/", "_"))
	db, err := gorm.Open(sqlite.Open(dsn), &gorm.Config{})
	require.NoError(t, err)
	require.NoError(t, db.AutoMigrate(&model.User{}))
	model.DB = db

	t.Cleanup(func() {
		model.DB = previousDB
		sqlDB, dbErr := db.DB()
		if dbErr == nil {
			require.NoError(t, sqlDB.Close())
		}
	})
	return db
}

func performStaleRoleRequest(t *testing.T, dbRole int, status int) (*httptest.ResponseRecorder, bool) {
	t.Helper()

	db := setupSessionAuthTestDB(t)
	require.NoError(t, db.Create(&model.User{
		Id:       2,
		Username: "root@example.com",
		Password: "password",
		Role:     dbRole,
		Status:   status,
		Group:    "current-group",
	}).Error)

	gin.SetMode(gin.TestMode)
	router := gin.New()
	router.Use(sessions.Sessions("session", cookie.NewStore([]byte("session-auth-test"))))
	router.GET("/login", func(c *gin.Context) {
		session := sessions.Default(c)
		session.Set("id", 2)
		session.Set("username", "root@example.com")
		session.Set("role", common.RoleAdminUser)
		session.Set("status", common.UserStatusEnabled)
		session.Set("group", "stale-group")
		require.NoError(t, session.Save())
		c.Status(http.StatusNoContent)
	})

	handlerCalled := false
	router.GET(
		"/protected",
		AdminAuth(),
		RequirePermission(authz.ChannelSensitiveWrite),
		func(c *gin.Context) {
			handlerCalled = true
			c.JSON(http.StatusOK, gin.H{
				"role":       c.GetInt("role"),
				"group":      c.GetString("group"),
				"user_group": c.GetString("user_group"),
			})
		},
	)

	loginRecorder := httptest.NewRecorder()
	router.ServeHTTP(loginRecorder, httptest.NewRequest(http.MethodGet, "/login", nil))
	require.Equal(t, http.StatusNoContent, loginRecorder.Code)

	recorder := httptest.NewRecorder()
	request := httptest.NewRequest(http.MethodGet, "/protected", nil)
	request.Header.Set("New-Api-User", "2")
	for _, sessionCookie := range loginRecorder.Result().Cookies() {
		request.AddCookie(sessionCookie)
	}
	router.ServeHTTP(recorder, request)
	return recorder, handlerCalled
}

func TestSessionAuthUsesPromotedDatabaseRole(t *testing.T) {
	recorder, handlerCalled := performStaleRoleRequest(
		t,
		common.RoleRootUser,
		common.UserStatusEnabled,
	)

	require.True(t, handlerCalled)
	require.Equal(t, http.StatusOK, recorder.Code)
	assert.JSONEq(t, `{"role":100,"group":"current-group","user_group":"current-group"}`, recorder.Body.String())
}

func TestSessionAuthRejectsSensitiveWriteAfterDemotion(t *testing.T) {
	recorder, handlerCalled := performStaleRoleRequest(
		t,
		common.RoleAdminUser,
		common.UserStatusEnabled,
	)

	assert.False(t, handlerCalled)
	assert.Equal(t, http.StatusForbidden, recorder.Code)
}

func TestSessionAuthRejectsUserDisabledAfterLogin(t *testing.T) {
	recorder, handlerCalled := performStaleRoleRequest(
		t,
		common.RoleRootUser,
		common.UserStatusDisabled,
	)

	assert.False(t, handlerCalled)
	assert.Equal(t, http.StatusOK, recorder.Code)
}

func TestUserSessionAuthAllowsCookieWithoutNewApiUserHeader(t *testing.T) {
	db := setupSessionAuthTestDB(t)
	require.NoError(t, db.Create(&model.User{
		Id:       7,
		Username: "media@example.com",
		Password: "password",
		Role:     common.RoleCommonUser,
		Status:   common.UserStatusEnabled,
		Group:    "default",
	}).Error)

	gin.SetMode(gin.TestMode)
	router := gin.New()
	router.Use(sessions.Sessions("session", cookie.NewStore([]byte("session-auth-test"))))
	router.GET("/login", func(c *gin.Context) {
		session := sessions.Default(c)
		session.Set("id", 7)
		session.Set("username", "media@example.com")
		session.Set("role", common.RoleCommonUser)
		session.Set("status", common.UserStatusEnabled)
		session.Set("group", "default")
		require.NoError(t, session.Save())
		c.Status(http.StatusNoContent)
	})

	handlerCalled := false
	router.GET("/media", UserSessionAuth(), func(c *gin.Context) {
		handlerCalled = true
		c.JSON(http.StatusOK, gin.H{"id": c.GetInt("id")})
	})

	loginRecorder := httptest.NewRecorder()
	router.ServeHTTP(loginRecorder, httptest.NewRequest(http.MethodGet, "/login", nil))
	require.Equal(t, http.StatusNoContent, loginRecorder.Code)

	// No New-Api-User header — mirrors browser <img src=".../content">.
	recorder := httptest.NewRecorder()
	request := httptest.NewRequest(http.MethodGet, "/media", nil)
	for _, sessionCookie := range loginRecorder.Result().Cookies() {
		request.AddCookie(sessionCookie)
	}
	router.ServeHTTP(recorder, request)

	require.True(t, handlerCalled)
	require.Equal(t, http.StatusOK, recorder.Code)
	assert.JSONEq(t, `{"id":7}`, recorder.Body.String())
}

func TestUserSessionAuthRejectsMissingSession(t *testing.T) {
	gin.SetMode(gin.TestMode)
	router := gin.New()
	router.Use(sessions.Sessions("session", cookie.NewStore([]byte("session-auth-test"))))
	handlerCalled := false
	router.GET("/media", UserSessionAuth(), func(c *gin.Context) {
		handlerCalled = true
		c.Status(http.StatusOK)
	})

	recorder := httptest.NewRecorder()
	router.ServeHTTP(recorder, httptest.NewRequest(http.MethodGet, "/media", nil))

	assert.False(t, handlerCalled)
	assert.Equal(t, http.StatusUnauthorized, recorder.Code)
}
