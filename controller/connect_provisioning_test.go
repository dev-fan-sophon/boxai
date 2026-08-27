package controller

import (
	"bytes"
	"crypto/sha256"
	"encoding/base64"
	"net/http"
	"net/http/httptest"
	"net/url"
	"strconv"
	"strings"
	"testing"

	"github.com/dev-fan-sophon/boxai/common"
	"github.com/dev-fan-sophon/boxai/constant"
	"github.com/dev-fan-sophon/boxai/model"
	"github.com/dev-fan-sophon/boxai/service"
	"github.com/dev-fan-sophon/boxai/setting/config"
	"github.com/dev-fan-sophon/boxai/setting/system_setting"
	"github.com/gin-gonic/gin"
	"github.com/stretchr/testify/assert"
	"github.com/stretchr/testify/require"
)

type connectProvisioningResponse struct {
	Success bool `json:"success"`
	Data    struct {
		ChatModels   []string `json:"chat_models"`
		DefaultModel string   `json:"default_model"`
		ModelMeta    map[string]struct {
			DisplayName      string   `json:"display_name"`
			ContextLength    int      `json:"context_length"`
			MaxOutputTokens  int      `json:"max_output_tokens"`
			InputModalities  []string `json:"input_modalities"`
			Capabilities     []string `json:"capabilities"`
			ReasoningEfforts []string `json:"reasoning_efforts"`
		} `json:"model_meta"`
		ImageModels         []string `json:"image_models"`
		VideoModels         []string `json:"video_models"`
		DefaultImage        string   `json:"default_image_model"`
		DefaultVideo        string   `json:"default_video_model"`
		MCPEndpoint         string   `json:"mcp_endpoint"`
		Revision            string   `json:"revision"`
		RefreshAfterSeconds int      `json:"refresh_after_seconds"`
		Agents              map[string]struct {
			Enabled          bool     `json:"enabled"`
			Models           []string `json:"models"`
			RecommendedModel string   `json:"recommended_model"`
			LockedModel      string   `json:"locked_model"`
		} `json:"agents"`
		Account *struct {
			Id       int    `json:"id"`
			Username string `json:"username"`
			Email    string `json:"email"`
			Quota    int    `json:"quota"`
		} `json:"account"`
	} `json:"data"`
}

type connectorManifestResponse struct {
	Success bool `json:"success"`
	Data    struct {
		SchemaVersion           int                     `json:"schema_version"`
		Platform                connectorPlatform       `json:"platform"`
		Authentication          connectorAuthentication `json:"authentication"`
		Gateway                 connectorGateway        `json:"gateway"`
		ProvisioningURL         string                  `json:"provisioning_url"`
		ConnectionBearerOrigins []string                `json:"connection_bearer_origins"`
		SupportedAgents         []string                `json:"supported_agents"`
	} `json:"data"`
}

type connectorProvisioningResponse struct {
	Success bool `json:"success"`
	Data    struct {
		Account       connectorAccount     `json:"account"`
		Usage         connectorUsage       `json:"usage"`
		Billing       connectorBilling     `json:"billing"`
		ModelPlaza    connectorModelPlaza  `json:"model_plaza"`
		SchemaVersion int                  `json:"schema_version"`
		Models        []connectorModel     `json:"models"`
		DefaultModel  string               `json:"default_model"`
		MCPServers    []connectorMCPServer `json:"mcp_servers"`
		Skills        []connectorSkill     `json:"skills"`
	} `json:"data"`
}

func decodeConnectProvisioning(t *testing.T, recorder *httptest.ResponseRecorder) connectProvisioningResponse {
	t.Helper()

	require.Equal(t, http.StatusOK, recorder.Code)
	var payload connectProvisioningResponse
	require.NoError(t, common.Unmarshal(recorder.Body.Bytes(), &payload))
	require.True(t, payload.Success)
	return payload
}

func withConnectPolicies(t *testing.T, policies string) {
	t.Helper()

	settings := system_setting.GetConnectSettings()
	original := settings.AgentPolicies
	originalEnabled := settings.Enabled
	require.NoError(t, config.GlobalConfig.UpdateRegistered("connect", map[string]string{
		"enabled":        "true",
		"agent_policies": policies,
	}))
	t.Cleanup(func() {
		require.NoError(t, config.GlobalConfig.UpdateRegistered("connect", map[string]string{
			"enabled":        strconv.FormatBool(originalEnabled),
			"agent_policies": original,
		}))
	})
}

// requestConnectProvisioning drives the handler the way TokenAuthReadOnly would:
// the caller's user id in context, no session.
func requestConnectProvisioning(t *testing.T, userID int) *httptest.ResponseRecorder {
	t.Helper()

	recorder := httptest.NewRecorder()
	ctx, _ := gin.CreateTestContext(recorder)
	ctx.Request = httptest.NewRequest(http.MethodGet, "/api/connect/provisioning", nil)
	ctx.Set("id", userID)

	GetConnectProvisioning(ctx)
	return recorder
}

func TestConnectorManifestMatchesNeutralPKCESchema(t *testing.T) {
	originalServerAddress := system_setting.ServerAddress
	system_setting.ServerAddress = ""
	t.Cleanup(func() { system_setting.ServerAddress = originalServerAddress })
	recorder := httptest.NewRecorder()
	ctx, _ := gin.CreateTestContext(recorder)
	ctx.Request = httptest.NewRequest(http.MethodGet, "https://gateway.example/api/v1/connector/manifest", nil)

	GetConnectorManifest(ctx)

	require.Equal(t, http.StatusOK, recorder.Code)
	var payload connectorManifestResponse
	require.NoError(t, common.Unmarshal(recorder.Body.Bytes(), &payload))
	require.True(t, payload.Success)
	assert.Equal(t, 2, payload.Data.SchemaVersion)
	assert.Equal(t, "boxai", payload.Data.Platform.ID)
	assert.Equal(t, "https://gateway.example", payload.Data.Gateway.BaseURL)
	assert.Equal(t, []string{"anthropic", "openai_responses", "openai_chat", "gemini"}, payload.Data.Gateway.Protocols)
	assert.Equal(t, "browser_pkce", payload.Data.Authentication.Type)
	assert.Equal(t, "https://gateway.example/api/v1/connector/authorize", payload.Data.Authentication.AuthorizeURL)
	assert.Equal(t, "https://gateway.example/api/v1/connector/token", payload.Data.Authentication.TokenURL)
	assert.Equal(t, "https://gateway.example/api/v1/connector/provisioning", payload.Data.ProvisioningURL)
	assert.Equal(t, []string{"https://gateway.example"}, payload.Data.ConnectionBearerOrigins)
	assert.Equal(t, []string{"claude", "codex", "gemini", "grokbuild", "opencode", "workbuddy"}, payload.Data.SupportedAgents)
	assert.Equal(t, "no-store", recorder.Header().Get("Cache-Control"))
	assert.NotContains(t, recorder.Body.String(), "sk-")
}

func TestConnectorAuthorizeAcceptsRFC8252CallbackAndDeviceNameAlias(t *testing.T) {
	db := setupModelListControllerTestDB(t)
	require.NoError(t, db.AutoMigrate(&model.DesktopAuthorization{}))
	query := url.Values{
		"redirect_uri":   {"http://127.0.0.1:43123/callback"},
		"code_challenge": {"AAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA"},
		"state":          {"0123456789012345678901"},
		"device_name":    {"Native Connector"},
	}
	recorder := httptest.NewRecorder()
	ctx, _ := gin.CreateTestContext(recorder)
	ctx.Request = httptest.NewRequest(http.MethodGet, "/api/v1/connector/authorize?"+query.Encode(), nil)

	StartConnectorAuthorization(ctx)

	require.Equal(t, http.StatusFound, recorder.Code)
	assert.Contains(t, recorder.Header().Get("Location"), "/desktop/authorize?request=")
	var authorization model.DesktopAuthorization
	require.NoError(t, db.First(&authorization).Error)
	assert.Equal(t, "http://127.0.0.1:43123/callback", authorization.RedirectURI)
	assert.Equal(t, "Native Connector", authorization.ClientName)
}

func TestConnectorAuthorizePrefersExistingClientName(t *testing.T) {
	db := setupModelListControllerTestDB(t)
	require.NoError(t, db.AutoMigrate(&model.DesktopAuthorization{}))
	query := url.Values{
		"redirect_uri":   {"http://127.0.0.1:43124/auth/callback"},
		"code_challenge": {"AAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA"},
		"state":          {"0123456789012345678901"},
		"client_name":    {"Existing Name"},
		"device_name":    {"Alias Name"},
	}
	recorder := httptest.NewRecorder()
	ctx, _ := gin.CreateTestContext(recorder)
	ctx.Request = httptest.NewRequest(http.MethodGet, "/api/v1/connector/authorize?"+query.Encode(), nil)

	StartConnectorAuthorization(ctx)

	require.Equal(t, http.StatusFound, recorder.Code)
	var authorization model.DesktopAuthorization
	require.NoError(t, db.First(&authorization).Error)
	assert.Equal(t, "Existing Name", authorization.ClientName)
}

func TestConnectorTokenReturnsDurableRelayCredentialAsBearerAccessToken(t *testing.T) {
	db := setupModelListControllerTestDB(t)
	require.NoError(t, db.AutoMigrate(
		&model.Token{}, &model.Option{}, &model.DesktopAuthorization{}, &model.DesktopSession{},
	))
	user := model.User{Username: "connector-token-user", Status: common.UserStatusEnabled}
	require.NoError(t, db.Create(&user).Error)
	verifier := "0123456789012345678901234567890123456789012"
	digest := sha256.Sum256([]byte(verifier))
	challenge := base64.RawURLEncoding.EncodeToString(digest[:])
	redirect := "http://127.0.0.1:43125/callback"
	authorization, err := service.CreateDesktopAuthorization(
		service.ConnectClientID, redirect, challenge, "S256", "0123456789012345678901", "BoxAI Connect",
	)
	require.NoError(t, err)
	code, _, err := service.DecideDesktopAuthorization(authorization.ID, user.Id, true)
	require.NoError(t, err)
	body, err := common.Marshal(map[string]string{
		"code": code, "code_verifier": verifier, "redirect_uri": redirect,
	})
	require.NoError(t, err)
	recorder := httptest.NewRecorder()
	ctx, _ := gin.CreateTestContext(recorder)
	ctx.Request = httptest.NewRequest(http.MethodPost, "/api/v1/connector/token", bytes.NewReader(body))
	ctx.Request.Header.Set("Content-Type", "application/json")

	ExchangeConnectorToken(ctx)

	require.Equal(t, http.StatusOK, recorder.Code)
	var response struct {
		AccessToken        string `json:"access_token"`
		APIKey             string `json:"api_key"`
		SessionAccessToken string `json:"session_access_token"`
		TokenType          string `json:"token_type"`
	}
	require.NoError(t, common.Unmarshal(recorder.Body.Bytes(), &response))
	assert.Equal(t, "Bearer", response.TokenType)
	assert.True(t, strings.HasPrefix(response.AccessToken, "sk-"))
	assert.Equal(t, response.AccessToken, response.APIKey)
	assert.NotEmpty(t, response.SessionAccessToken, "legacy JWT remains available under an explicit compatibility field")
}

func TestConnectorSelfRevokeUsesOnlyAuthenticatedContext(t *testing.T) {
	db := setupModelListControllerTestDB(t)
	require.NoError(t, db.AutoMigrate(&model.Token{}, &model.DesktopSession{}))
	token := model.Token{
		UserId: 2301, Key: "connector-self-revoke", Name: "BoxAI Connector",
		Status: common.TokenStatusEnabled, ExpiredTime: -1, UnlimitedQuota: true,
	}
	require.NoError(t, db.Create(&token).Error)
	session := model.DesktopSession{
		ID: "connector-self-revoke-session", UserID: token.UserId, RelayTokenID: token.Id,
		ClientName: "BoxAI Connector", RefreshHash: "connector-self-revoke-refresh",
		CreatedAt: 1, ExpiresAt: 4102444800,
	}
	require.NoError(t, db.Create(&session).Error)

	recorder := httptest.NewRecorder()
	ctx, _ := gin.CreateTestContext(recorder)
	ctx.Request = httptest.NewRequest(http.MethodPost, "/api/v1/connector/revoke", nil)
	ctx.Set("id", token.UserId)
	ctx.Set("token_id", token.Id)

	RevokeConnectorSession(ctx)

	require.Equal(t, http.StatusNoContent, recorder.Code)
	require.NoError(t, db.First(&session, "id = ?", session.ID).Error)
	assert.NotZero(t, session.RevokedAt)
	require.NoError(t, db.First(&token, token.Id).Error)
	assert.Equal(t, common.TokenStatusDisabled, token.Status)
}

func TestConnectorProvisioningReturnsAccountCallableModelsAndAuthoritativeData(t *testing.T) {
	originalServerAddress := system_setting.ServerAddress
	t.Cleanup(func() { system_setting.ServerAddress = originalServerAddress })
	withSelfUseModeEnabled(t)
	db := setupModelListControllerTestDB(t)
	require.NoError(t, db.AutoMigrate(&model.ConnectorMCPServer{}, &model.ConnectorSkillRelease{}, &model.SubscriptionPlan{}, &model.UserSubscription{}))
	require.NoError(t, db.Create(&model.User{
		Id: 2101, Username: "connector-user", DisplayName: "Connector User", Email: "connector@example.com",
		Password: "password-secret", Group: "default", Quota: 70, UsedQuota: 30, RequestCount: 12,
		Status: common.UserStatusEnabled,
	}).Error)
	require.NoError(t, db.Create(&[]model.Channel{
		{Id: 901, Type: constant.ChannelTypeOpenAI, Key: "upstream-enabled-secret", Status: common.ChannelStatusEnabled, Name: "enabled", Group: "default", Models: "zz-connector-chat"},
		{Id: 902, Type: constant.ChannelTypeOpenAI, Key: "upstream-disabled-secret", Status: common.ChannelStatusManuallyDisabled, Name: "disabled", Group: "default", Models: "zz-connector-disabled"},
		{Id: 903, Type: constant.ChannelTypeOpenAI, Key: "upstream-image-secret", Status: common.ChannelStatusEnabled, Name: "image", Group: "default", Models: "zz-connector-flux-image"},
	}).Error)
	require.NoError(t, db.Create(&[]model.Ability{
		{Group: "default", Model: "zz-connector-chat", ChannelId: 901, Enabled: true},
		{Group: "default", Model: "zz-connector-disabled", ChannelId: 902, Enabled: true},
		{Group: "default", Model: "zz-connector-flux-image", ChannelId: 903, Enabled: true},
	}).Error)
	vendor := model.Vendor{Name: "Authoritative Vendor", Icon: "vendor-icon", Status: 1}
	require.NoError(t, db.Create(&vendor).Error)
	require.NoError(t, db.Create(&model.Model{
		ModelName: "zz-connector-chat", Description: "Authoritative description", Icon: "model-icon",
		Tags: "zeta, alpha,alpha", VendorID: vendor.Id, Status: 1,
	}).Error)
	now := common.GetTimestamp()
	plan := model.SubscriptionPlan{Title: "Connector plan", TotalAmount: 500, QuotaResetPeriod: model.SubscriptionResetNever}
	require.NoError(t, db.Create(&plan).Error)
	require.NoError(t, db.Create(&[]model.UserSubscription{
		{UserId: 2101, PlanId: plan.Id, AmountTotal: 500, AmountUsed: 125, StartTime: now - 10, EndTime: now + 1000, NextResetTime: now + 500, Status: "active", AllowWalletOverflow: true},
		{UserId: 2101, PlanId: plan.Id, AmountTotal: 200, AmountUsed: 25, StartTime: now - 20, EndTime: now + 2000, NextResetTime: now + 1000, Status: "active", AllowWalletOverflow: false},
		{UserId: 2101, PlanId: plan.Id, AmountTotal: 999, AmountUsed: 1, StartTime: now - 20, EndTime: now - 1, Status: "expired"},
	}).Error)
	require.NoError(t, db.Create(&[]model.ConnectorMCPServer{
		{ID: "z-media", Name: "Z Media", URL: "https://gateway.example/z-mcp", Authorization: "connection_bearer", Description: "Z", Enabled: true},
		{ID: "a-assets", Name: "A Assets", URL: "https://gateway.example/a-mcp", Authorization: "connection_bearer", Description: "A", Enabled: true},
		{ID: "disabled", Name: "Disabled", URL: "https://gateway.example/disabled", Authorization: "connection_bearer", Enabled: false},
	}).Error)
	require.NoError(t, db.Create(&[]model.ConnectorSkillRelease{
		{ID: "z-skill", Version: "2.0.0", Name: "Z Skill", ArchiveURL: "https://gateway.example/z.zip", ArchiveSHA256: strings.Repeat("b", 64), ArchiveSizeBytes: 2048, ArchiveFormat: "zip", ArchiveAuthorization: "connection_bearer", Enabled: true},
		{ID: "a-skill", Version: "1.0.0", Name: "A Skill", ArchiveURL: "https://cdn.example/a.zip", ArchiveSHA256: strings.Repeat("a", 64), ArchiveSizeBytes: 1024, ArchiveFormat: "zip", ArchiveAuthorization: "none", Enabled: true},
		{ID: "disabled-skill", Version: "1.0.0", Name: "Disabled", ArchiveURL: "https://cdn.example/disabled.zip", ArchiveSHA256: strings.Repeat("c", 64), ArchiveSizeBytes: 1, ArchiveFormat: "zip", ArchiveAuthorization: "none", Enabled: false},
	}).Error)
	withPricingCache(t)
	system_setting.ServerAddress = ""

	recorder := httptest.NewRecorder()
	ctx, _ := gin.CreateTestContext(recorder)
	ctx.Request = httptest.NewRequest(http.MethodGet, "https://gateway.example/api/v1/connector/provisioning", nil)
	ctx.Set("id", 2101)
	GetConnectorProvisioning(ctx)

	require.Equal(t, http.StatusOK, recorder.Code)
	var payload connectorProvisioningResponse
	require.NoError(t, common.Unmarshal(recorder.Body.Bytes(), &payload))
	require.True(t, payload.Success)
	assert.Equal(t, 2, payload.Data.SchemaVersion)
	require.Len(t, payload.Data.Models, 1)
	assert.Equal(t, "zz-connector-chat", payload.Data.Models[0].ID)
	assert.True(t, payload.Data.Models[0].ChatCapable)
	assert.False(t, payload.Data.Models[0].ResponsesNative)
	assert.Equal(t, []string{"openai"}, payload.Data.Models[0].Endpoints)
	assert.Empty(t, payload.Data.Models[0].SupportedReasoning)
	assert.Equal(t, "Authoritative description", payload.Data.Models[0].Description)
	assert.Equal(t, "model-icon", payload.Data.Models[0].Icon)
	assert.Equal(t, []string{"alpha", "zeta"}, payload.Data.Models[0].Tags)
	require.NotNil(t, payload.Data.Models[0].Vendor)
	assert.Equal(t, vendor.Id, payload.Data.Models[0].Vendor.ID)
	assert.Equal(t, "Authoritative Vendor", payload.Data.Models[0].Vendor.Name)
	require.Len(t, payload.Data.ModelPlaza.Models, 2)
	assert.Equal(t, "zz-connector-flux-image", payload.Data.ModelPlaza.Models[1].ID)
	assert.False(t, payload.Data.ModelPlaza.Models[1].ChatCapable)
	assert.Equal(t, []string{"image-generation", "openai"}, payload.Data.ModelPlaza.Models[1].Endpoints)
	assert.Empty(t, payload.Data.ModelPlaza.Models[1].Tags)
	assert.Equal(t, "zz-connector-chat", payload.Data.DefaultModel)
	assert.Equal(t, connectorAccount{ID: 2101, Username: "connector-user", DisplayName: "Connector User", Email: "connector@example.com", Group: "default"}, payload.Data.Account)
	assert.Equal(t, connectorUsage{WalletQuotaRemaining: 70, LifetimeQuotaUsed: 30, LifetimeRequestCount: 12}, payload.Data.Usage)
	assert.Equal(t, "https://gateway.example/subscriptions", payload.Data.Billing.PortalURL)
	assert.False(t, payload.Data.Billing.WalletFallbackAllowed)
	require.Len(t, payload.Data.Billing.Subscriptions, 2)
	assert.Equal(t, connectorSubscription{ID: payload.Data.Billing.Subscriptions[0].ID, PlanID: plan.Id, Status: "active", QuotaTotal: 500, QuotaUsed: 125, CurrentPeriodStart: now - 10, EndTime: now + 1000, NextResetTime: now + 500, WalletFallback: true}, payload.Data.Billing.Subscriptions[0])
	assert.Equal(t, "https://gateway.example/pricing", payload.Data.ModelPlaza.PortalURL)
	require.Len(t, payload.Data.MCPServers, 2)
	assert.Equal(t, "a-assets", payload.Data.MCPServers[0].ID)
	assert.Equal(t, "z-media", payload.Data.MCPServers[1].ID)
	assert.Equal(t, "connection_bearer", payload.Data.MCPServers[0].Authorization)
	require.Len(t, payload.Data.Skills, 2)
	assert.Equal(t, "a-skill", payload.Data.Skills[0].ID)
	assert.Equal(t, "z-skill", payload.Data.Skills[1].ID)
	assert.Equal(t, "https://cdn.example/a.zip", payload.Data.Skills[0].Archive.URL)
	assert.Equal(t, strings.Repeat("a", 64), payload.Data.Skills[0].Archive.SHA256)
	assert.Equal(t, int64(1024), payload.Data.Skills[0].Archive.SizeBytes)
	assert.Equal(t, "zip", payload.Data.Skills[0].Archive.Format)
	assert.Equal(t, "none", payload.Data.Skills[0].Archive.Authorization)
	assert.Equal(t, "no-store", recorder.Header().Get("Cache-Control"))
	assert.NotContains(t, recorder.Body.String(), "upstream-enabled-secret")
	assert.NotContains(t, recorder.Body.String(), "upstream-disabled-secret")
	assert.NotContains(t, recorder.Body.String(), "upstream-image-secret")
	assert.NotContains(t, recorder.Body.String(), "password-secret")
}

func TestConnectorProvisioningReturnsEmptyManagedCatalogsHonestly(t *testing.T) {
	withSelfUseModeEnabled(t)
	db := setupModelListControllerTestDB(t)
	require.NoError(t, db.AutoMigrate(&model.ConnectorMCPServer{}, &model.ConnectorSkillRelease{}, &model.UserSubscription{}))
	user := model.User{
		Id: 2102, Username: "empty-connector-catalog", Password: "password",
		Group: "default", Status: common.UserStatusEnabled,
	}
	require.NoError(t, db.Create(&user).Error)
	recorder := httptest.NewRecorder()
	ctx, _ := gin.CreateTestContext(recorder)
	ctx.Request = httptest.NewRequest(http.MethodGet, "/api/v1/connector/provisioning", nil)
	ctx.Set("id", user.Id)

	GetConnectorProvisioning(ctx)

	var payload connectorProvisioningResponse
	require.NoError(t, common.Unmarshal(recorder.Body.Bytes(), &payload))
	require.True(t, payload.Success)
	assert.Empty(t, payload.Data.Models)
	assert.Empty(t, payload.Data.ModelPlaza.Models)
	assert.Empty(t, payload.Data.DefaultModel)
	assert.True(t, payload.Data.Billing.WalletFallbackAllowed)
	assert.Empty(t, payload.Data.MCPServers)
	assert.Empty(t, payload.Data.Skills)
	assert.Contains(t, recorder.Body.String(), `"mcp_servers":[]`)
	assert.Contains(t, recorder.Body.String(), `"skills":[]`)
}

func TestChatModelAllowsAncillarySearchButStillRejectsNonChatEndpoints(t *testing.T) {
	assert.True(t, isChatModel([]constant.EndpointType{
		constant.EndpointTypeOpenAIResponse,
		constant.EndpointTypeOpenAIAlphaSearch,
	}))
	assert.False(t, isChatModel([]constant.EndpointType{constant.EndpointTypeOpenAIAlphaSearch}))
	assert.False(t, isChatModel([]constant.EndpointType{
		constant.EndpointTypeOpenAI,
		constant.EndpointTypeEmbeddings,
	}))
}

func TestElevenLabsCapabilitiesAreNeverProjectedAsChat(t *testing.T) {
	for _, endpoint := range []constant.EndpointType{
		constant.EndpointTypeAudioTTS,
		constant.EndpointTypeAudioSTT,
		constant.EndpointTypeAudioSpeechToSpeech,
		constant.EndpointTypeAudioSFX,
		constant.EndpointTypeAudioMusic,
		constant.EndpointTypeAudioIsolation,
		constant.EndpointTypeAudioAlignment,
	} {
		assert.False(t, isChatModel([]constant.EndpointType{endpoint}), endpoint)
	}
}

func TestResponsesNativeModelRejectsConvertedDualProtocolChannels(t *testing.T) {
	assert.True(t, responsesNativeModel([]constant.EndpointType{
		constant.EndpointTypeOpenAIResponse,
		constant.EndpointTypeOpenAIResponseCompact,
		constant.EndpointTypeOpenAIAlphaSearch,
	}, constant.ChannelTypeCodex))
	assert.True(t, responsesNativeModel([]constant.EndpointType{
		constant.EndpointTypeOpenAI,
		constant.EndpointTypeOpenAIResponse,
		constant.EndpointTypeAnthropic,
		constant.EndpointTypeGemini,
	}, constant.ChannelTypeCodexProxy))
	assert.True(t, responsesNativeModel([]constant.EndpointType{
		constant.EndpointTypeOpenAIResponse,
	}, constant.ChannelTypeOpenAI))
	assert.False(t, responsesNativeModel([]constant.EndpointType{
		constant.EndpointTypeOpenAI,
		constant.EndpointTypeOpenAIResponse,
	}, constant.ChannelTypeXai))
	assert.False(t, responsesNativeModel([]constant.EndpointType{
		constant.EndpointTypeOpenAI,
		constant.EndpointTypeOpenAIResponse,
		constant.EndpointTypeAnthropic,
	}, constant.ChannelTypeSub2API))
}

func TestConnectProvisioningRevisionAndETag(t *testing.T) {
	withSelfUseModeEnabled(t)
	setupModelListControllerTestDB(t)
	withConnectPolicies(t, `{"claude":{"enabled":true,"recommended_model":""}}`)

	first := requestConnectProvisioning(t, 0)
	firstPayload := decodeConnectProvisioning(t, first)
	require.NotEmpty(t, firstPayload.Data.Revision)
	require.Equal(t, 60, firstPayload.Data.RefreshAfterSeconds)
	require.Equal(t, "no-cache", first.Header().Get("Cache-Control"))
	etag := first.Header().Get("ETag")
	require.NotEmpty(t, etag)

	recorder := httptest.NewRecorder()
	ctx, _ := gin.CreateTestContext(recorder)
	ctx.Request = httptest.NewRequest(http.MethodGet, "/api/connect/provisioning", nil)
	ctx.Request.Header.Set("If-None-Match", etag)
	GetConnectProvisioning(ctx)
	require.Equal(t, http.StatusNotModified, recorder.Code, "first ETag %s, second ETag %s", etag, recorder.Header().Get("ETag"))

	require.NoError(t, config.GlobalConfig.UpdateRegistered("connect", map[string]string{
		"agent_policies": `{"claude":{"enabled":false,"recommended_model":""}}`,
	}))
	changed := decodeConnectProvisioning(t, requestConnectProvisioning(t, 0))
	require.NotEqual(t, firstPayload.Data.Revision, changed.Data.Revision)
	require.Equal(t, changed.Data.Revision, decodeConnectProvisioning(t, requestConnectProvisioning(t, 0)).Data.Revision)
}

func TestConnectProvisioningGlobalDisableDisablesEveryAgent(t *testing.T) {
	withSelfUseModeEnabled(t)
	setupModelListControllerTestDB(t)
	withConnectPolicies(t, `{"claude":{"enabled":true,"recommended_model":""},"codex":{"enabled":true,"recommended_model":""}}`)
	require.NoError(t, config.GlobalConfig.UpdateRegistered("connect", map[string]string{"enabled": "false"}))

	payload := decodeConnectProvisioning(t, requestConnectProvisioning(t, 0))
	for name, agent := range payload.Data.Agents {
		require.False(t, agent.Enabled, name)
		require.Empty(t, agent.Models, name)
	}
}

func TestConnectProvisioningMalformedAgentPolicyFailsClosed(t *testing.T) {
	withSelfUseModeEnabled(t)
	setupModelListControllerTestDB(t)
	withConnectPolicies(t, `{not-json`)

	payload := decodeConnectProvisioning(t, requestConnectProvisioning(t, 0))
	for name, agent := range payload.Data.Agents {
		require.False(t, agent.Enabled, name)
		require.Empty(t, agent.Models, name)
	}
}

// withPricingCache makes the pricing cache authoritative for the fixture's
// abilities. Endpoint types are read from it, and a model it does not know
// reports none — which the handler correctly treats as "not a chat model".
func withPricingCache(t *testing.T) {
	t.Helper()

	original := common.MemoryCacheEnabled
	common.MemoryCacheEnabled = true
	t.Cleanup(func() {
		common.MemoryCacheEnabled = original
		model.InvalidatePricingCache()
	})
	model.InitChannelCache()
	model.GetPricing()
}

// A coding client that is handed an embedding, image or video model fails on
// its first request, so the catalog Connect writes into client config files
// must contain chat models only.
func TestConnectProvisioningReturnsChatModelsOnly(t *testing.T) {
	withSelfUseModeEnabled(t)
	db := setupModelListControllerTestDB(t)

	originalMemoryCacheEnabled := common.MemoryCacheEnabled
	common.MemoryCacheEnabled = true
	t.Cleanup(func() {
		common.MemoryCacheEnabled = originalMemoryCacheEnabled
		model.InvalidatePricingCache()
	})

	require.NoError(t, db.Create(&model.User{
		Id:       2001,
		Username: "connect-user",
		Email:    "connect@example.com",
		Password: "password",
		Group:    "default",
		Quota:    4242,
		Status:   common.UserStatusEnabled,
	}).Error)

	require.NoError(t, db.Create(&[]model.Channel{
		{Id: 801, Type: constant.ChannelTypeOpenAI, Key: "k", Status: common.ChannelStatusEnabled, Name: "openai", Group: "default", Models: "zz-connect-chat-model,zz-connect-flux-image"},
		{Id: 802, Type: constant.ChannelTypeAnthropic, Key: "k", Status: common.ChannelStatusEnabled, Name: "anthropic", Group: "default", Models: "zz-connect-claude"},
		{Id: 803, Type: constant.ChannelTypeSora, Key: "k", Status: common.ChannelStatusEnabled, Name: "sora", Group: "default", Models: "zz-connect-video"},
		{Id: 804, Type: constant.ChannelTypeJina, Key: "k", Status: common.ChannelStatusEnabled, Name: "jina", Group: "default", Models: "zz-connect-rerank"},
	}).Error)
	require.NoError(t, db.Create(&[]model.Ability{
		{Group: "default", Model: "zz-connect-chat-model", ChannelId: 801, Enabled: true},
		// Image generation contributes `image-generation` alongside `openai`,
		// which is the case a "supports openai?" check would wrongly admit.
		{Group: "default", Model: "zz-connect-flux-image", ChannelId: 801, Enabled: true},
		{Group: "default", Model: "zz-connect-claude", ChannelId: 802, Enabled: true},
		{Group: "default", Model: "zz-connect-video", ChannelId: 803, Enabled: true},
		{Group: "default", Model: "zz-connect-rerank", ChannelId: 804, Enabled: true},
	}).Error)

	model.InitChannelCache()
	model.GetPricing()

	payload := decodeConnectProvisioning(t, requestConnectProvisioning(t, 2001))

	require.Equal(t, []string{"zz-connect-chat-model", "zz-connect-claude"}, payload.Data.ChatModels)
	// Media catalogs are separate from chat so coding clients never pick them
	// as a conversation default; Connect seeds them into the MCP tool surface.
	require.NotContains(t, payload.Data.ChatModels, "zz-connect-flux-image")
	require.NotContains(t, payload.Data.ChatModels, "zz-connect-video")
	require.NotEmpty(t, payload.Data.MCPEndpoint)
	require.Contains(t, payload.Data.MCPEndpoint, "/mcp")
}

// The catalog is per-account and the default is an operator decision, so a
// default this account cannot reach must degrade to something it can.
func TestConnectProvisioningAppliesAgentPoliciesWithoutDefaultFallback(t *testing.T) {
	withSelfUseModeEnabled(t)
	db := setupModelListControllerTestDB(t)

	require.NoError(t, db.Create(&model.User{
		Id:       2002,
		Username: "connect-default-user",
		Password: "password",
		Group:    "default",
		Status:   common.UserStatusEnabled,
	}).Error)
	require.NoError(t, db.Create(&model.Channel{
		Id: 811, Type: constant.ChannelTypeOpenAI, Key: "k", Status: common.ChannelStatusEnabled,
		Name: "openai", Group: "default", Models: "zz-connect-a-model,zz-connect-b-model",
	}).Error)
	require.NoError(t, db.Create(&[]model.Ability{
		{Group: "default", Model: "zz-connect-a-model", ChannelId: 811, Enabled: true},
		{Group: "default", Model: "zz-connect-b-model", ChannelId: 811, Enabled: true},
	}).Error)
	withPricingCache(t)

	withConnectPolicies(t, `{"claude":{"enabled":true,"recommended_model":"zz-connect-b-model","locked_model":"zz-connect-a-model"},"codex":{"enabled":true,"recommended_model":"missing"},"gemini":{"enabled":false}}`)
	payload := decodeConnectProvisioning(t, requestConnectProvisioning(t, 2002))
	require.Empty(t, payload.Data.DefaultModel)
	require.Equal(t, payload.Data.ChatModels, payload.Data.Agents["claude"].Models)
	require.Equal(t, "zz-connect-b-model", payload.Data.Agents["claude"].RecommendedModel)
	require.Equal(t, "zz-connect-a-model", payload.Data.Agents["claude"].LockedModel)
	require.Empty(t, payload.Data.Agents["codex"].RecommendedModel, "an unavailable recommendation must not fall back to the first model")
	require.False(t, payload.Data.Agents["gemini"].Enabled)
	require.Empty(t, payload.Data.Agents["gemini"].Models)
	require.True(t, payload.Data.Agents["workbuddy"].Enabled)
	require.Equal(t, payload.Data.ChatModels, payload.Data.Agents["workbuddy"].Models)
}

// An account with no chat models must not be handed a model name anyway: the
// desktop app has no fallback of its own and would write a config that fails.
func TestConnectProvisioningWithoutChatModelsReturnsNoDefault(t *testing.T) {
	withSelfUseModeEnabled(t)
	db := setupModelListControllerTestDB(t)

	require.NoError(t, db.Create(&model.User{
		Id:       2003,
		Username: "connect-empty-user",
		Password: "password",
		Group:    "default",
		Status:   common.UserStatusEnabled,
	}).Error)
	payload := decodeConnectProvisioning(t, requestConnectProvisioning(t, 2003))

	require.Empty(t, payload.Data.ChatModels)
	require.Empty(t, payload.Data.DefaultModel)
}

// Provisioning must not become a way around a token's model limit: the key
// Connect holds is an ordinary relay token and the catalog it is shown has to
// match what that token may actually call.
func TestConnectProvisioningHonoursTokenModelLimit(t *testing.T) {
	withSelfUseModeEnabled(t)
	db := setupModelListControllerTestDB(t)

	require.NoError(t, db.Create(&model.Channel{
		Id: 821, Type: constant.ChannelTypeOpenAI, Key: "k", Status: common.ChannelStatusEnabled,
		Name: "openai", Group: "default", Models: "zz-connect-allowed-model,zz-connect-withheld-model",
	}).Error)
	require.NoError(t, db.Create(&[]model.Ability{
		{Group: "default", Model: "zz-connect-allowed-model", ChannelId: 821, Enabled: true},
		{Group: "default", Model: "zz-connect-withheld-model", ChannelId: 821, Enabled: true},
	}).Error)
	withPricingCache(t)

	recorder := httptest.NewRecorder()
	ctx, _ := gin.CreateTestContext(recorder)
	ctx.Request = httptest.NewRequest(http.MethodGet, "/api/connect/provisioning", nil)
	common.SetContextKey(ctx, constant.ContextKeyUserGroup, "default")
	common.SetContextKey(ctx, constant.ContextKeyTokenModelLimitEnabled, true)
	common.SetContextKey(ctx, constant.ContextKeyTokenModelLimit, map[string]bool{
		"zz-connect-allowed-model": true,
	})

	GetConnectProvisioning(ctx)

	payload := decodeConnectProvisioning(t, recorder)
	require.Equal(t, []string{"zz-connect-allowed-model"}, payload.Data.ChatModels,
		"a model the group serves but the token forbids must not appear")
}

// Connect writes model catalogs into client config files, and formats such as
// Grok Build reject an entry without a context window. The metadata therefore
// travels with the catalog — but strictly scoped to it, so a model the token
// may not call stays undisclosed here too.
func TestConnectProvisioningModelMetadataStaysScopedToTheAccountCatalog(t *testing.T) {
	withSelfUseModeEnabled(t)
	db := setupModelListControllerTestDB(t)

	require.NoError(t, db.Create(&model.Channel{
		Id: 831, Type: constant.ChannelTypeOpenAI, Key: "k", Status: common.ChannelStatusEnabled,
		Name: "openai", Group: "default", Models: "zz-connect-meta-model,zz-connect-secret-model,zz-connect-plain-model",
	}).Error)
	require.NoError(t, db.Create(&[]model.Ability{
		{Group: "default", Model: "zz-connect-meta-model", ChannelId: 831, Enabled: true},
		{Group: "default", Model: "zz-connect-secret-model", ChannelId: 831, Enabled: true},
		{Group: "default", Model: "zz-connect-plain-model", ChannelId: 831, Enabled: true},
	}).Error)
	require.NoError(t, db.Create(&[]model.Model{
		{
			ModelName: "zz-connect-meta-model", Status: 1, NameRule: model.NameRuleExact,
			DisplayName: "Connect Meta Model", ContextLength: 200000, MaxOutputTokens: 64000,
			InputModalities: `["text","image"]`, Capabilities: `["tools"]`, ReasoningEfforts: `["low","high"]`,
		},
		{
			ModelName: "zz-connect-secret-model", Status: 1, NameRule: model.NameRuleExact,
			DisplayName: "Withheld Model", ContextLength: 128000,
		},
	}).Error)
	withPricingCache(t)

	recorder := httptest.NewRecorder()
	ctx, _ := gin.CreateTestContext(recorder)
	ctx.Request = httptest.NewRequest(http.MethodGet, "/api/connect/provisioning", nil)
	common.SetContextKey(ctx, constant.ContextKeyUserGroup, "default")
	common.SetContextKey(ctx, constant.ContextKeyTokenModelLimitEnabled, true)
	common.SetContextKey(ctx, constant.ContextKeyTokenModelLimit, map[string]bool{
		"zz-connect-meta-model":  true,
		"zz-connect-plain-model": true,
	})
	GetConnectProvisioning(ctx)

	payload := decodeConnectProvisioning(t, recorder)
	meta := payload.Data.ModelMeta["zz-connect-meta-model"]
	assert.Equal(t, "Connect Meta Model", meta.DisplayName)
	assert.Equal(t, 200000, meta.ContextLength)
	assert.Equal(t, 64000, meta.MaxOutputTokens)
	assert.Equal(t, []string{"text", "image"}, meta.InputModalities)
	assert.Equal(t, []string{"tools"}, meta.Capabilities)
	assert.Equal(t, []string{"low", "high"}, meta.ReasoningEfforts)
	assert.NotContains(t, payload.Data.ModelMeta, "zz-connect-secret-model",
		"a model the token forbids must not be described here either")
	assert.NotContains(t, payload.Data.ModelMeta, "zz-connect-plain-model",
		"a model with no documented metadata needs no entry")
}

// The desktop app labels its account panel from this response rather than
// making a second call, so the identity has to travel with the catalog.
func TestConnectProvisioningCarriesTheAccountIdentity(t *testing.T) {
	withSelfUseModeEnabled(t)
	db := setupModelListControllerTestDB(t)

	require.NoError(t, db.Create(&model.User{
		Id:       2004,
		Username: "connect-identity-user",
		Email:    "identity@example.com",
		Password: "password",
		Group:    "default",
		Quota:    777,
		Status:   common.UserStatusEnabled,
	}).Error)

	payload := decodeConnectProvisioning(t, requestConnectProvisioning(t, 2004))

	require.NotNil(t, payload.Data.Account)
	require.Equal(t, 2004, payload.Data.Account.Id)
	require.Equal(t, "connect-identity-user", payload.Data.Account.Username)
	require.Equal(t, "identity@example.com", payload.Data.Account.Email)
	require.Equal(t, 777, payload.Data.Account.Quota)
}
