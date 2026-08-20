package router

import (
	"net/http"
	"net/http/httptest"
	"testing"
	"time"

	"github.com/dev-fan-sophon/boxai/common"
	"github.com/dev-fan-sophon/boxai/model"
	"github.com/dev-fan-sophon/boxai/service"
	"github.com/gin-gonic/gin"
	"github.com/glebarez/sqlite"
	"github.com/stretchr/testify/assert"
	"github.com/stretchr/testify/require"
	"gorm.io/gorm"
)

// TestUserOperationsRoutesRegister guards the user operations API surface, where
// a static segment (`/stats/...`) and a parameter segment (`/:id/profile`) are
// siblings. A conflicting registration panics at process start, so this failure
// mode has to be caught before deployment rather than at boot.
func TestUserOperationsRoutesRegister(t *testing.T) {
	gin.SetMode(gin.TestMode)
	engine := gin.New()
	require.NotPanics(t, func() { SetApiRouter(engine) })

	registered := map[string]bool{}
	for _, route := range engine.Routes() {
		registered[route.Method+" "+route.Path] = true
	}

	for _, path := range []string{
		"GET /api/v1/connector/manifest",
		"GET /api/v1/connector/authorize",
		"POST /api/v1/connector/token",
		"GET /api/v1/connector/provisioning",
		"POST /api/v1/connector/revoke",
		"GET /api/admin/connector/mcp-servers",
		"POST /api/admin/connector/mcp-servers",
		"PUT /api/admin/connector/mcp-servers/:id",
		"DELETE /api/admin/connector/mcp-servers/:id",
		"GET /api/admin/connector/skill-releases",
		"POST /api/admin/connector/skill-releases",
		"PUT /api/admin/connector/skill-releases/:id/:version",
		"DELETE /api/admin/connector/skill-releases/:id/:version",
		"GET /api/admin/users/stats/overview",
		"GET /api/admin/users/stats/funnel",
		"GET /api/admin/users/stats/retention",
		"GET /api/admin/users/stats/revenue",
		"GET /api/admin/users/stats/acquisition",
		"POST /api/admin/users/query",
		"GET /api/admin/users/tags",
		"GET /api/admin/users/:id/profile",
		"POST /api/admin/users/bulk",
		"POST /api/admin/users/export",
		"GET /api/admin/segments",
		"POST /api/admin/segments",
		"POST /api/admin/segments/preview",
		"PUT /api/admin/segments/:id",
		"DELETE /api/admin/segments/:id",
		"GET /api/admin/segments/campaigns",
		"POST /api/admin/segments/campaigns",
		"POST /api/acquisition/track",
		"GET /api/reward/public/:slug",
		"GET /api/user/rewards",
		"POST /api/user/rewards/claim",
		"POST /api/user/rewards/redeem",
		"GET /api/reward/campaign/",
		"GET /api/reward/campaign/:id",
		"POST /api/reward/campaign/",
		"PUT /api/reward/campaign/:id",
		"GET /api/reward/claim/",
		"GET /api/reward/ledger/",
		"POST /api/reward/adjust",
	} {
		assert.True(t, registered[path], "missing route %s", path)
	}
}

func TestConnectorProvisioningRouteRejectsNonConnectorCredentialsIdentically(t *testing.T) {
	oldRedisEnabled := common.RedisEnabled
	common.RedisEnabled = false
	t.Cleanup(func() { common.RedisEnabled = oldRedisEnabled })
	db, err := gorm.Open(sqlite.Open("file:"+t.Name()+"?mode=memory&cache=shared"), &gorm.Config{})
	require.NoError(t, err)
	require.NoError(t, db.AutoMigrate(&model.User{}, &model.Token{}, &model.DesktopSession{}))
	oldDB := model.DB
	model.DB = db
	t.Cleanup(func() { model.DB = oldDB })

	user := model.User{Username: "connector-auth", Status: common.UserStatusEnabled, Group: "default"}
	require.NoError(t, db.Create(&user).Error)
	now := time.Now().Unix()
	type credential struct {
		name        string
		header      string
		token       model.Token
		session     *model.DesktopSession
		disableUser bool
		softDelete  bool
	}
	validToken := func(key string) model.Token {
		return model.Token{UserId: user.Id, Key: key, Status: common.TokenStatusEnabled, ExpiredTime: -1, UnlimitedQuota: true}
	}
	cases := []credential{
		{name: "missing"},
		{name: "malformed", header: "bearer sk-nope"},
		{name: "ordinary sk", header: "Bearer sk-ordinary", token: validToken("ordinary")},
		{name: "desktop source", header: "Bearer sk-desktop", token: validToken("desktop"), session: &model.DesktopSession{ClientID: service.DesktopClientID, ExpiresAt: now + 60}},
		{name: "connect source", header: "Bearer sk-connect", token: validToken("connect"), session: &model.DesktopSession{ClientID: service.ConnectClientID, ExpiresAt: now + 60}},
		{name: "legacy blank source", header: "Bearer sk-legacy", token: validToken("legacy"), session: &model.DesktopSession{ExpiresAt: now + 60}},
		{name: "owner mismatch", header: "Bearer sk-mismatch", token: validToken("mismatch"), session: &model.DesktopSession{ClientID: service.ConnectorClientID, UserID: user.Id + 1, ExpiresAt: now + 60}},
		{name: "revoked", header: "Bearer sk-revoked", token: validToken("revoked"), session: &model.DesktopSession{ClientID: service.ConnectorClientID, RevokedAt: now, ExpiresAt: now + 60}},
		{name: "session expired", header: "Bearer sk-expired-session", token: validToken("expired-session"), session: &model.DesktopSession{ClientID: service.ConnectorClientID, ExpiresAt: now - 1}},
		{name: "token expired", header: "Bearer sk-expired-token", token: func() model.Token { v := validToken("expired-token"); v.ExpiredTime = now - 1; return v }(), session: &model.DesktopSession{ClientID: service.ConnectorClientID, ExpiresAt: now + 60}},
		{name: "disabled token", header: "Bearer sk-disabled-token", token: func() model.Token { v := validToken("disabled-token"); v.Status = common.TokenStatusDisabled; return v }(), session: &model.DesktopSession{ClientID: service.ConnectorClientID, ExpiresAt: now + 60}},
		{name: "disabled user", header: "Bearer sk-disabled-user", token: validToken("disabled-user"), session: &model.DesktopSession{ClientID: service.ConnectorClientID, ExpiresAt: now + 60}, disableUser: true},
		{name: "non durable", header: "Bearer sk-nondurable", token: func() model.Token { v := validToken("nondurable"); v.UnlimitedQuota = false; return v }(), session: &model.DesktopSession{ClientID: service.ConnectorClientID, ExpiresAt: now + 60}},
		{name: "soft deleted", header: "Bearer sk-deleted", token: validToken("deleted"), session: &model.DesktopSession{ClientID: service.ConnectorClientID, ExpiresAt: now + 60}, softDelete: true},
	}

	gin.SetMode(gin.TestMode)
	engine := gin.New()
	SetApiRouter(engine)
	for _, tc := range cases {
		t.Run(tc.name, func(t *testing.T) {
			if tc.token.Key != "" {
				require.NoError(t, db.Create(&tc.token).Error)
				if tc.session != nil {
					tc.session.ID = "session-" + tc.token.Key
					tc.session.RelayTokenID = tc.token.Id
					if tc.session.UserID == 0 {
						tc.session.UserID = user.Id
					}
					tc.session.RefreshHash = "refresh-" + tc.token.Key
					require.NoError(t, db.Create(tc.session).Error)
				}
				if tc.softDelete {
					require.NoError(t, db.Delete(&tc.token).Error)
				}
			}
			if tc.disableUser {
				require.NoError(t, db.Model(&user).Update("status", common.UserStatusDisabled).Error)
				defer db.Model(&user).Update("status", common.UserStatusEnabled)
			}
			recorder := httptest.NewRecorder()
			request := httptest.NewRequest(http.MethodGet, "/api/v1/connector/provisioning", nil)
			if tc.header != "" {
				request.Header.Set("Authorization", tc.header)
			}
			engine.ServeHTTP(recorder, request)
			assert.Equal(t, http.StatusNotFound, recorder.Code)
			assert.Empty(t, recorder.Body.String())
		})
	}

	legacy := validToken("legacy-revoke")
	require.NoError(t, db.Create(&legacy).Error)
	legacySession := model.DesktopSession{
		ID: "session-legacy-revoke", UserID: user.Id, RelayTokenID: legacy.Id,
		RefreshHash: "refresh-legacy-revoke", ExpiresAt: now + 60,
	}
	require.NoError(t, db.Create(&legacySession).Error)
	recorder := httptest.NewRecorder()
	request := httptest.NewRequest(http.MethodPost, "/api/v1/connector/revoke", nil)
	request.Header.Set("Authorization", "Bearer sk-legacy-revoke")
	engine.ServeHTTP(recorder, request)
	assert.Equal(t, http.StatusNoContent, recorder.Code)
	require.NoError(t, db.First(&legacy, legacy.Id).Error)
	assert.Equal(t, common.TokenStatusDisabled, legacy.Status)
	require.NoError(t, db.First(&legacySession, "id = ?", legacySession.ID).Error)
	assert.NotZero(t, legacySession.RevokedAt)

	valid := validToken("valid-connector")
	require.NoError(t, db.Create(&valid).Error)
	require.NoError(t, db.Create(&model.DesktopSession{
		ID: "session-valid", UserID: user.Id, RelayTokenID: valid.Id, ClientID: service.ConnectorClientID,
		RefreshHash: "refresh-valid", ExpiresAt: now + 60,
	}).Error)
	recorder = httptest.NewRecorder()
	request = httptest.NewRequest(http.MethodGet, "/api/v1/connector/provisioning", nil)
	request.Header.Set("Authorization", "Bearer sk-valid-connector")
	engine.ServeHTTP(recorder, request)
	assert.NotEqual(t, http.StatusNotFound, recorder.Code, "a linked active Connector credential must reach the handler")
}
