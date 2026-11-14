package controller

import (
	"net/http"
	"net/http/httptest"
	"testing"

	"github.com/dev-fan-sophon/boxai/common"
	"github.com/dev-fan-sophon/boxai/model"
	"github.com/dev-fan-sophon/boxai/oauth"
	"github.com/gin-contrib/sessions"
	"github.com/gin-contrib/sessions/cookie"
	"github.com/gin-gonic/gin"
	"github.com/glebarez/sqlite"
	"github.com/stretchr/testify/assert"
	"github.com/stretchr/testify/require"
	"gorm.io/gorm"
)

func TestOAuthRegistrationPersistsInviter(t *testing.T) {
	db, err := gorm.Open(sqlite.Open(":memory:"), &gorm.Config{})
	require.NoError(t, err)
	sqlDB, err := db.DB()
	require.NoError(t, err)
	sqlDB.SetMaxOpenConns(1)
	require.NoError(t, db.AutoMigrate(&model.User{}, &model.Log{}))
	oldDB, oldLogDB := model.DB, model.LOG_DB
	oldRedis, oldRegister := common.RedisEnabled, common.RegisterEnabled
	oldNew, oldInvitee, oldInviter := common.QuotaForNewUser, common.QuotaForInvitee, common.QuotaForInviter
	model.DB, model.LOG_DB = db, db
	common.RedisEnabled, common.RegisterEnabled = false, true
	common.QuotaForNewUser, common.QuotaForInvitee, common.QuotaForInviter = 0, 0, 0
	t.Cleanup(func() {
		model.DB, model.LOG_DB = oldDB, oldLogDB
		common.RedisEnabled, common.RegisterEnabled = oldRedis, oldRegister
		common.QuotaForNewUser, common.QuotaForInvitee, common.QuotaForInviter = oldNew, oldInvitee, oldInviter
		assert.NoError(t, sqlDB.Close())
	})
	inviter := model.User{Username: "inviter", AffCode: "valid-aff", Status: common.UserStatusEnabled}
	require.NoError(t, db.Create(&inviter).Error)

	gin.SetMode(gin.TestMode)
	for _, tc := range []struct {
		name, code string
		want       int
	}{
		{"valid", "valid-aff", inviter.Id}, {"missing", "", 0}, {"invalid", "unknown-aff", 0},
	} {
		t.Run(tc.name, func(t *testing.T) {
			// Zalo, Google, Facebook and the other built-in providers share this
			// creation path; the provider only decides which column holds the ID.
			provider := &oauth.ZaloProvider{}
			identity := &oauth.OAuthUser{ProviderUserID: "inviter-test-" + tc.name, Username: "oauth-" + tc.name}
			login := func(affCode string) *model.User {
				var user *model.User
				router := gin.New()
				router.Use(sessions.Sessions("session", cookie.NewStore([]byte("oauth-inviter-test"))))
				router.GET("/callback", func(c *gin.Context) {
					session := sessions.Default(c)
					if affCode != "" {
						session.Set("aff", affCode)
					}
					var err error
					user, err = findOrCreateOAuthUser(c, provider, identity, session, &oauth.OAuthToken{})
					require.NoError(t, err)
					c.Status(http.StatusNoContent)
				})
				router.ServeHTTP(httptest.NewRecorder(), httptest.NewRequest(http.MethodGet, "/callback", nil))
				require.NotNil(t, user)
				return user
			}

			created := login(tc.code)
			var stored model.User
			require.NoError(t, db.First(&stored, created.Id).Error)
			assert.Equal(t, tc.want, stored.InviterId)
			assert.Equal(t, identity.ProviderUserID, stored.ZaloId)

			existing := login("valid-aff")
			assert.Equal(t, created.Id, existing.Id)
			require.NoError(t, db.First(&stored, created.Id).Error)
			assert.Equal(t, tc.want, stored.InviterId, "login must not reassign the inviter")
		})
	}
}
