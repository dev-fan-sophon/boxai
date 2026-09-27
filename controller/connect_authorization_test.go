package controller

import (
	"net/http"
	"net/http/httptest"
	"strings"
	"testing"

	"github.com/dev-fan-sophon/boxai/common"
	"github.com/dev-fan-sophon/boxai/middleware"
	"github.com/dev-fan-sophon/boxai/model"
	"github.com/dev-fan-sophon/boxai/service"
	"github.com/dev-fan-sophon/boxai/setting/system_setting"
	"github.com/gin-contrib/sessions"
	"github.com/gin-contrib/sessions/cookie"
	"github.com/gin-gonic/gin"
	"github.com/stretchr/testify/assert"
	"github.com/stretchr/testify/require"
)

func TestConnectApprovalRequiresWebsiteSession(t *testing.T) {
	db := setupModelListControllerTestDB(t)
	require.NoError(t, db.AutoMigrate(&model.ConnectAuthorization{}, &model.Token{}))
	r := gin.New()
	r.Use(sessions.Sessions("session", cookie.NewStore([]byte("connect-test-session"))))
	r.GET("/requests/:id", middleware.UserSessionAuth(), GetConnectAuthorization)
	r.POST("/requests/:id/decision", middleware.UserSessionAuth(), DecideConnectAuthorization)
	for _, request := range []*http.Request{
		httptest.NewRequest(http.MethodGet, "/requests/example", nil),
		httptest.NewRequest(http.MethodPost, "/requests/example/decision", strings.NewReader(`{"approve":true}`)),
	} {
		request.Header.Set("Authorization", "Bearer sk-not-a-website-session")
		request.Header.Set("Content-Type", "application/json")
		w := httptest.NewRecorder()
		r.ServeHTTP(w, request)
		assert.Equal(t, http.StatusUnauthorized, w.Code)
	}
}

func TestConnectTokenResponseHasOnlyOrdinaryCredential(t *testing.T) {
	originalAddress := system_setting.ServerAddress
	system_setting.ServerAddress = "https://you-box.com"
	t.Cleanup(func() { system_setting.ServerAddress = originalAddress })
	db := setupModelListControllerTestDB(t)
	require.NoError(t, db.AutoMigrate(&model.ConnectAuthorization{}, &model.Token{}))
	user := model.User{Username: "connect-token", Status: common.UserStatusEnabled}
	require.NoError(t, db.Create(&user).Error)
	a, err := service.CreateConnectAuthorization("http://127.0.0.1:4321/callback", "E9Melhoa2OwvFrEMTJguCHaoeK1t8URWbuGJSstw-cM", "S256", "0123456789012345678901", "Laptop")
	require.NoError(t, err)
	code, _, err := service.DecideConnectAuthorization(a.ID, user.Id, true)
	require.NoError(t, err)
	body, err := common.Marshal(gin.H{"code": code, "code_verifier": "dBjftJeZ4CVP-mB92K27uhbUJU1p1r_wW1gFWFOEjXk", "redirect_uri": a.RedirectURI})
	require.NoError(t, err)
	r := gin.New()
	r.POST("/api/connect/token", ExchangeConnectToken)
	w := httptest.NewRecorder()
	request := httptest.NewRequest(http.MethodPost, "https://you-box.com/api/connect/token", strings.NewReader(string(body)))
	request.Header.Set("Content-Type", "application/json")
	r.ServeHTTP(w, request)
	require.Equal(t, http.StatusOK, w.Code)
	var response map[string]string
	require.NoError(t, common.Unmarshal(w.Body.Bytes(), &response))
	assert.Len(t, response, 3)
	assert.True(t, strings.HasPrefix(response["access_token"], "sk-"))
	assert.Equal(t, "Bearer", response["token_type"])
	assert.Equal(t, "https://you-box.com/v1", response["base_url"])
	assert.Equal(t, "no-store", w.Header().Get("Cache-Control"))
}

func TestAccountUsageWithOrdinaryKey(t *testing.T) {
	db := setupModelListControllerTestDB(t)
	require.NoError(t, db.AutoMigrate(&model.Token{}, &model.SubscriptionPlan{}, &model.UserSubscription{}))
	user := model.User{Username: "account-usage", DisplayName: "Account User", Email: "account@example.test", Group: "default", Quota: 4321, UsedQuota: 8765, RequestCount: 19, Status: common.UserStatusEnabled}
	require.NoError(t, db.Create(&user).Error)
	token := model.Token{UserId: user.Id, Key: "ordinaryaccountkey", Status: common.TokenStatusEnabled, ExpiredTime: -1, UnlimitedQuota: true}
	require.NoError(t, db.Create(&token).Error)
	now := model.GetDBTimestamp()
	plan := model.SubscriptionPlan{Title: "Monthly", QuotaResetPeriod: model.SubscriptionResetNever}
	require.NoError(t, db.Create(&plan).Error)
	sub := model.UserSubscription{UserId: user.Id, PlanId: plan.Id, Status: "active", AmountTotal: 900, AmountUsed: 123, StartTime: now - 100, EndTime: now + 3600, AllowWalletOverflow: false}
	require.NoError(t, db.Create(&sub).Error)
	r := gin.New()
	r.GET("/api/usage/account", middleware.TokenAuthReadOnly(), GetAccountUsage)
	w := httptest.NewRecorder()
	request := httptest.NewRequest(http.MethodGet, "/api/usage/account", nil)
	request.Header.Set("Authorization", "Bearer sk-"+token.Key)
	r.ServeHTTP(w, request)
	require.Equal(t, http.StatusOK, w.Code)
	var result struct {
		Success bool `json:"success"`
		Data    struct {
			Account connectorAccount `json:"account"`
			Usage   connectorUsage   `json:"usage"`
			Billing connectorBilling `json:"billing"`
		} `json:"data"`
	}
	require.NoError(t, common.Unmarshal(w.Body.Bytes(), &result))
	assert.True(t, result.Success)
	assert.Equal(t, connectorAccount{ID: user.Id, Username: user.Username, DisplayName: user.DisplayName, Email: user.Email, Group: user.Group}, result.Data.Account)
	assert.Equal(t, connectorUsage{WalletQuotaRemaining: 4321, LifetimeQuotaUsed: 8765, LifetimeRequestCount: 19}, result.Data.Usage)
	assert.False(t, result.Data.Billing.WalletFallbackAllowed)
	require.Len(t, result.Data.Billing.Subscriptions, 1)
	assert.Equal(t, connectorSubscription{ID: sub.Id, PlanID: plan.Id, Status: "active", QuotaTotal: 900, QuotaUsed: 123, CurrentPeriodStart: now - 100, EndTime: now + 3600}, result.Data.Billing.Subscriptions[0])
	assert.NotContains(t, w.Body.String(), token.Key)
	assert.Equal(t, "no-store", w.Header().Get("Cache-Control"))
	for _, key := range []string{"", "sk-missing"} {
		w = httptest.NewRecorder()
		request.Header.Set("Authorization", key)
		r.ServeHTTP(w, request)
		assert.Equal(t, http.StatusUnauthorized, w.Code)
	}
}
