package controller

import (
	"errors"
	"math"
	"net/http"
	"net/http/httptest"
	"strconv"
	"testing"
	"time"

	"github.com/dev-fan-sophon/boxai/common"
	"github.com/dev-fan-sophon/boxai/middleware"
	"github.com/dev-fan-sophon/boxai/model"
	"github.com/gin-contrib/sessions"
	"github.com/gin-contrib/sessions/cookie"
	"github.com/gin-gonic/gin"
	"github.com/stretchr/testify/assert"
	"github.com/stretchr/testify/require"
)

type failingVerificationSession struct{ sessions.Session }

func (f failingVerificationSession) Save() error { return errors.New("session store unavailable") }

func TestSecureVerificationAccessTokenCannotBorrowSessionProof(t *testing.T) {
	db := setupModelListControllerTestDB(t)
	user := &model.User{Username: "verification-token-user", Role: common.RoleCommonUser, Status: common.UserStatusEnabled, Group: "default"}
	user.SetAccessToken("verification-test-access-token")
	require.NoError(t, db.Create(user).Error)
	r := gin.New()
	r.Use(sessions.Sessions("session", cookie.NewStore([]byte("verification-test-secret"))))
	r.Use(func(c *gin.Context) {
		// Missing username selects authHelper's real access-token path, while
		// stale session identity and verification belong to another account.
		s := sessions.Default(c)
		s.Set("id", user.Id+1)
		s.Set(SecureVerificationSessionKey, time.Now().Unix())
		s.Set(secureVerificationMethodSessionKey, "2fa")
		s.Set(middleware.SecureVerificationUserSessionKey, user.Id+1)
		c.Next()
	})
	r.Use(middleware.UserAuth())
	r.GET("/ordinary", func(c *gin.Context) {
		assert.True(t, c.GetBool("use_access_token"))
		assert.Equal(t, user.Id, c.GetInt("id"))
		c.Status(http.StatusNoContent)
	})
	r.GET("/protected", middleware.SecureVerificationRequired(), func(c *gin.Context) { t.Error("borrowed proof accepted") })
	r.GET("/verify", UniversalVerify)
	r.GET("/passkey", func(c *gin.Context) {
		_, err := getSessionUser(c)
		require.Error(t, err)
		c.Status(http.StatusUnauthorized)
	})
	for path, expected := range map[string]int{"/ordinary": http.StatusNoContent, "/protected": http.StatusForbidden, "/verify": http.StatusUnauthorized, "/passkey": http.StatusUnauthorized} {
		request := httptest.NewRequest(http.MethodGet, path, nil)
		request.Header.Set("Authorization", "Bearer "+user.GetAccessToken())
		request.Header.Set("New-Api-User", strconv.Itoa(user.Id))
		w := httptest.NewRecorder()
		r.ServeHTTP(w, request)
		assert.Equal(t, expected, w.Code, path)
	}
}

func TestSecureVerificationIdentityAndTime(t *testing.T) {
	now := time.Now().Unix()
	for _, tc := range []struct {
		name                 string
		sessionID, requestID int
		markerID             any
		at                   any
		valid                bool
	}{
		{"valid", 1, 1, 1, now, true},
		{"switched account", 2, 2, 1, now, false},
		{"access token differs from session", 1, 2, 1, now, false},
		{"marker follows token but not session", 1, 2, 2, now, false},
		{"legacy unbound proof", 1, 1, nil, now, false},
		{"future", 1, 1, 1, now + 3600, false},
		{"expired", 1, 1, 1, now - SecureVerificationTimeout, false},
		{"timestamp overflow", 1, 1, 1, int64(math.MinInt64), false},
		{"malformed timestamp", 1, 1, 1, "now", false},
	} {
		for _, mode := range []string{"required", "optional", "method"} {
			t.Run(tc.name+"/"+mode, func(t *testing.T) {
				r := gin.New()
				r.Use(sessions.Sessions("session", cookie.NewStore([]byte("verification-test-secret"))))
				r.Use(func(c *gin.Context) {
					s := sessions.Default(c)
					s.Set("id", tc.sessionID)
					s.Set(SecureVerificationSessionKey, tc.at)
					s.Set(secureVerificationMethodSessionKey, "2fa")
					if tc.markerID != nil {
						s.Set(middleware.SecureVerificationUserSessionKey, tc.markerID)
					}
					c.Set("id", tc.requestID)
					c.Set("use_access_token", tc.sessionID != tc.requestID)
					c.Next()
					if !tc.valid {
						assert.Nil(t, s.Get(SecureVerificationSessionKey))
					}
				})
				allowed := false
				switch mode {
				case "required":
					r.GET("/", middleware.SecureVerificationRequired(), func(c *gin.Context) { allowed = true })
				case "optional":
					r.GET("/", middleware.OptionalSecureVerification(), func(c *gin.Context) { allowed = c.GetBool("secure_verified") })
				case "method":
					r.GET("/", func(c *gin.Context) { allowed = requireSecureVerificationMethod(c, "2fa") })
				}
				w := httptest.NewRecorder()
				r.ServeHTTP(w, httptest.NewRequest(http.MethodGet, "/", nil))
				assert.Equal(t, tc.valid, allowed)
				if mode == "required" && !tc.valid {
					assert.Equal(t, http.StatusForbidden, w.Code)
				}
			})
		}
	}
}

func TestPasskeyReadyIdentityTimeAndSaveFailure(t *testing.T) {
	now := time.Now().Unix()
	for _, tc := range []struct {
		name            string
		markerID        any
		requestID       int
		at              int64
		failSave, valid bool
	}{
		{"valid consumed once", 1, 1, now, false, true},
		{"wrong ready user", 2, 1, now, false, false},
		{"legacy ready", nil, 1, now, false, false},
		{"access token mismatch", 1, 2, now, false, false},
		{"future", 1, 1, now + 3600, false, false},
		{"expired", 1, 1, now - PasskeyReadyTimeout, false, false},
		{"save fails closed", 1, 1, now, true, false},
	} {
		t.Run(tc.name, func(t *testing.T) {
			r := gin.New()
			r.Use(sessions.Sessions("session", cookie.NewStore([]byte("verification-test-secret"))))
			r.GET("/", func(c *gin.Context) {
				s := sessions.Default(c)
				s.Set("id", 1)
				s.Set(PasskeyReadySessionKey, tc.at)
				if tc.markerID != nil {
					s.Set(middleware.PasskeyReadyUserSessionKey, tc.markerID)
				}
				c.Set("id", tc.requestID)
				if tc.failSave {
					c.Set(sessions.DefaultKey, failingVerificationSession{s})
				}
				valid, err := consumePasskeyReady(c)
				assert.Equal(t, tc.valid, valid)
				if tc.failSave {
					require.Error(t, err)
				} else {
					require.NoError(t, err)
				}
				assert.Nil(t, s.Get(PasskeyReadySessionKey))
				assert.Nil(t, s.Get(middleware.PasskeyReadyUserSessionKey))
				valid, _ = consumePasskeyReady(c)
				assert.False(t, valid)
			})
			r.ServeHTTP(httptest.NewRecorder(), httptest.NewRequest(http.MethodGet, "/", nil))
		})
	}
}

func TestSetSecureVerificationFailsClosed(t *testing.T) {
	for _, tc := range []struct {
		name      string
		requestID int
		failSave  bool
	}{
		{"valid", 1, false},
		{"identity mismatch", 2, false},
		{"save failure", 1, true},
	} {
		t.Run(tc.name, func(t *testing.T) {
			r := gin.New()
			r.Use(sessions.Sessions("session", cookie.NewStore([]byte("verification-test-secret"))))
			r.GET("/", func(c *gin.Context) {
				s := sessions.Default(c)
				s.Set("id", 1)
				s.Set(PasskeyReadySessionKey, time.Now().Unix())
				s.Set(middleware.PasskeyReadyUserSessionKey, 1)
				c.Set("id", tc.requestID)
				if tc.failSave {
					c.Set(sessions.DefaultKey, failingVerificationSession{s})
				}
				at, err := setSecureVerificationSession(c, "2fa")
				if tc.failSave || tc.requestID != 1 {
					require.Error(t, err)
					assert.Zero(t, at)
					assert.Nil(t, s.Get(SecureVerificationSessionKey))
					assert.False(t, requireSecureVerificationMethod(c, "2fa"))
				} else {
					require.NoError(t, err)
					assert.Equal(t, 1, s.Get(middleware.SecureVerificationUserSessionKey))
					assert.True(t, requireSecureVerificationMethod(c, "2fa"))
					assert.False(t, requireSecureVerificationMethod(c, "passkey"))
				}
				assert.Nil(t, s.Get(PasskeyReadySessionKey))
				assert.Nil(t, s.Get(middleware.PasskeyReadyUserSessionKey))
			})
			r.ServeHTTP(httptest.NewRecorder(), httptest.NewRequest(http.MethodGet, "/", nil))
		})
	}
}

func TestLoginAndLogoutClearVerification(t *testing.T) {
	db := setupModelListControllerTestDB(t)
	require.NoError(t, db.AutoMigrate(&model.Log{}))
	user := &model.User{Username: "verification-login", Role: common.RoleCommonUser, Status: common.UserStatusEnabled, Group: "default"}
	require.NoError(t, db.Create(user).Error)
	for _, action := range []string{"login", "logout"} {
		t.Run(action, func(t *testing.T) {
			r := gin.New()
			r.Use(sessions.Sessions("session", cookie.NewStore([]byte("verification-test-secret"))))
			r.GET("/", func(c *gin.Context) {
				s := sessions.Default(c)
				s.Set("id", user.Id+1)
				s.Set(SecureVerificationSessionKey, time.Now().Unix())
				s.Set(secureVerificationMethodSessionKey, "2fa")
				s.Set(middleware.SecureVerificationUserSessionKey, user.Id+1)
				s.Set(PasskeyReadySessionKey, time.Now().Unix())
				s.Set(middleware.PasskeyReadyUserSessionKey, user.Id+1)
				if action == "login" {
					setupLogin(user, c)
				} else {
					Logout(c)
				}
			})
			r.GET("/check", func(c *gin.Context) {
				s := sessions.Default(c)
				for _, key := range []string{SecureVerificationSessionKey, secureVerificationMethodSessionKey, middleware.SecureVerificationUserSessionKey, PasskeyReadySessionKey, middleware.PasskeyReadyUserSessionKey} {
					assert.Nil(t, s.Get(key), key)
				}
				if action == "login" {
					assert.Equal(t, user.Id, s.Get("id"))
				} else {
					assert.Nil(t, s.Get("id"))
				}
			})
			w := httptest.NewRecorder()
			r.ServeHTTP(w, httptest.NewRequest(http.MethodGet, "/", nil))
			require.Equal(t, http.StatusOK, w.Code)
			require.Contains(t, w.Body.String(), `"success":true`)
			request := httptest.NewRequest(http.MethodGet, "/check", nil)
			require.NotEmpty(t, w.Result().Cookies())
			for _, cookie := range w.Result().Cookies() {
				request.AddCookie(cookie)
			}
			r.ServeHTTP(httptest.NewRecorder(), request)
		})
	}
}
