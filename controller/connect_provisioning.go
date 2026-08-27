package controller

import (
	"crypto/sha256"
	"encoding/hex"
	"errors"
	"net"
	"net/http"
	"net/url"
	"sort"
	"strings"

	"github.com/dev-fan-sophon/boxai/common"
	"github.com/dev-fan-sophon/boxai/constant"
	"github.com/dev-fan-sophon/boxai/model"
	"github.com/dev-fan-sophon/boxai/service"
	"github.com/dev-fan-sophon/boxai/setting/system_setting"
	"github.com/gin-gonic/gin"
)

// chatEndpointTypes are the wire formats a coding client holds a conversation
// over. The relay converts between them, so a model carrying any one of them is
// reachable from every client BoxAI Connect configures.
var chatEndpointTypes = map[constant.EndpointType]bool{
	constant.EndpointTypeOpenAI:                true,
	constant.EndpointTypeOpenAIResponse:        true,
	constant.EndpointTypeOpenAIResponseCompact: true,
	constant.EndpointTypeAnthropic:             true,
	constant.EndpointTypeGemini:                true,
}

// isChatModel reports whether a model can back a coding client.
//
// Membership is decided by exclusion, because an embedding model is also tagged
// `openai`: a model needs a chat endpoint and may carry only chat formats plus
// explicitly ancillary capabilities. Handing a client an embedding, image,
// audio, video or 3D model produces a config that fails on its first request.
func isChatModel(endpoints []constant.EndpointType) bool {
	if len(endpoints) == 0 {
		return false
	}
	hasChat := false
	for _, endpoint := range endpoints {
		if chatEndpointTypes[endpoint] {
			hasChat = true
			continue
		}
		// Search is an ancillary capability advertised by otherwise-chat-capable
		// Codex, NewAPI, and Sub2API channels. It neither proves nor disproves
		// that the model can hold a conversation.
		if endpoint != constant.EndpointTypeOpenAIAlphaSearch {
			return false
		}
	}
	return hasChat
}

// accountChatModelNames intersects token/account visibility with enabled
// channels. accountModelNames intentionally follows the general model-list API
// and may include an enabled ability whose channel was later disabled; a
// connector must not project such a model into a client's live config.
func accountChatModelNames(c *gin.Context) ([]string, modelListGroups, error) {
	modelNames, groups, err := accountModelNames(c)
	if err != nil {
		return nil, modelListGroups{}, err
	}
	owners, err := model.GetPreferredModelOwnerChannelTypes(modelNames, groups.ownerGroups)
	if err != nil {
		return nil, modelListGroups{}, err
	}
	chatModels := make([]string, 0, len(modelNames))
	for _, name := range modelNames {
		if _, available := owners[name]; available && isChatModel(model.GetModelSupportEndpointTypes(name)) {
			chatModels = append(chatModels, name)
		}
	}
	sort.Strings(chatModels)
	return chatModels, groups, nil
}

// connectAccount is the identity BoxAI Connect shows in its account panel.
// It is filled from the cached user record, so it carries no field that would
// force a database read on every provisioning call.
type connectAccount struct {
	Id       int    `json:"id"`
	Username string `json:"username"`
	Email    string `json:"email"`
	Quota    int    `json:"quota"`
}

type connectProvisioning struct {
	ChatModels          []string                            `json:"chat_models"`
	DefaultModel        string                              `json:"default_model"`
	ModelMeta           map[string]connectModelMeta         `json:"model_meta"`
	ImageModels         []string                            `json:"image_models"`
	VideoModels         []string                            `json:"video_models"`
	DefaultImage        string                              `json:"default_image_model"`
	DefaultVideo        string                              `json:"default_video_model"`
	MCPEndpoint         string                              `json:"mcp_endpoint"`
	Account             *connectAccount                     `json:"account,omitempty"`
	Revision            string                              `json:"revision"`
	RefreshAfterSeconds int                                 `json:"refresh_after_seconds"`
	Agents              map[string]connectProvisioningAgent `json:"agents"`
}

// connectModelMeta describes a chat model well enough for Connect to fill in
// the catalog entry each client format demands: Codex needs a label, Grok Build
// refuses a profile without a context window, OpenCode and OpenClaw record
// limits, and Codex only offers reasoning levels the model actually has.
// Connect cannot derive any of this from a model id without guessing.
type connectModelMeta struct {
	DisplayName      string   `json:"display_name,omitempty"`
	ContextLength    int      `json:"context_length,omitempty"`
	MaxOutputTokens  int      `json:"max_output_tokens,omitempty"`
	InputModalities  []string `json:"input_modalities,omitempty"`
	Capabilities     []string `json:"capabilities,omitempty"`
	ReasoningEfforts []string `json:"reasoning_efforts,omitempty"`
}

type connectProvisioningAgent struct {
	Enabled          bool     `json:"enabled"`
	Models           []string `json:"models"`
	RecommendedModel string   `json:"recommended_model"`
	LockedModel      string   `json:"locked_model,omitempty"`
}

type connectorPlatform struct {
	ID   string `json:"id"`
	Name string `json:"name"`
}

type connectorGateway struct {
	BaseURL   string   `json:"base_url"`
	Protocols []string `json:"protocols"`
}

type connectorAuthentication struct {
	Type         string `json:"type"`
	AuthorizeURL string `json:"authorize_url"`
	TokenURL     string `json:"token_url"`
}

type connectorManifest struct {
	SchemaVersion           int                     `json:"schema_version"`
	Platform                connectorPlatform       `json:"platform"`
	Authentication          connectorAuthentication `json:"authentication"`
	Gateway                 connectorGateway        `json:"gateway"`
	ProvisioningURL         string                  `json:"provisioning_url"`
	ConnectionBearerOrigins []string                `json:"connection_bearer_origins"`
	SupportedAgents         []string                `json:"supported_agents"`
}

type connectorModel struct {
	ID                 string           `json:"id"`
	ChatCapable        bool             `json:"chat_capable"`
	ResponsesNative    bool             `json:"responses_native"`
	Endpoints          []string         `json:"endpoints"`
	SupportedReasoning []string         `json:"supported_reasoning"`
	Description        string           `json:"description,omitempty"`
	Icon               string           `json:"icon,omitempty"`
	Tags               []string         `json:"tags"`
	Vendor             *connectorVendor `json:"vendor,omitempty"`
}

type connectorVendor struct {
	ID   int    `json:"id"`
	Name string `json:"name"`
	Icon string `json:"icon,omitempty"`
}

type connectorAccount struct {
	ID          int    `json:"id"`
	Username    string `json:"username"`
	DisplayName string `json:"display_name"`
	Email       string `json:"email"`
	Group       string `json:"group"`
}

type connectorUsage struct {
	WalletQuotaRemaining int64 `json:"wallet_quota_remaining"`
	LifetimeQuotaUsed    int64 `json:"lifetime_quota_used"`
	LifetimeRequestCount int64 `json:"lifetime_request_count"`
}

type connectorSubscription struct {
	ID                 int    `json:"id"`
	PlanID             int    `json:"plan_id"`
	Status             string `json:"status"`
	Unlimited          bool   `json:"unlimited"`
	QuotaTotal         int64  `json:"quota_total"`
	QuotaUsed          int64  `json:"quota_used_current_period"`
	CurrentPeriodStart int64  `json:"current_period_start"`
	EndTime            int64  `json:"end_time"`
	NextResetTime      int64  `json:"next_reset_time"`
	WalletFallback     bool   `json:"wallet_fallback"`
}

type connectorBilling struct {
	PortalURL             string                  `json:"portal_url"`
	WalletFallbackAllowed bool                    `json:"wallet_fallback_allowed"`
	Subscriptions         []connectorSubscription `json:"subscriptions"`
}

type connectorModelPlaza struct {
	PortalURL string           `json:"portal_url"`
	Models    []connectorModel `json:"models"`
}

type connectorMCPServer struct {
	ID            string `json:"id"`
	Name          string `json:"name"`
	URL           string `json:"url"`
	Authorization string `json:"authorization"`
	Description   string `json:"description"`
}

type connectorSkillArchive struct {
	URL           string `json:"url"`
	SHA256        string `json:"sha256"`
	SizeBytes     int64  `json:"size_bytes"`
	Format        string `json:"format"`
	Authorization string `json:"authorization"`
}

type connectorSkill struct {
	ID      string                `json:"id"`
	Name    string                `json:"name"`
	Version string                `json:"version"`
	Archive connectorSkillArchive `json:"archive"`
}

type connectorProvisioning struct {
	SchemaVersion int                  `json:"schema_version"`
	Account       connectorAccount     `json:"account"`
	Usage         connectorUsage       `json:"usage"`
	Billing       connectorBilling     `json:"billing"`
	ModelPlaza    connectorModelPlaza  `json:"model_plaza"`
	Models        []connectorModel     `json:"models"`
	DefaultModel  string               `json:"default_model"`
	MCPServers    []connectorMCPServer `json:"mcp_servers"`
	Skills        []connectorSkill     `json:"skills"`
}

// GetConnectorManifest is public discovery metadata for the shared neutral
// connector schema. The two connector auth URLs adapt that schema onto BoxAI's
// existing desktop authorization/session infrastructure.
func GetConnectorManifest(c *gin.Context) {
	origin := publicOrigin(c)
	desktopNoStore(c)
	c.JSON(http.StatusOK, gin.H{"success": true, "data": connectorManifest{
		SchemaVersion: 2,
		Platform:      connectorPlatform{ID: "boxai", Name: "BoxAI"},
		Authentication: connectorAuthentication{
			Type: "browser_pkce", AuthorizeURL: origin + "/api/v1/connector/authorize",
			TokenURL: origin + "/api/v1/connector/token",
		},
		Gateway: connectorGateway{
			BaseURL:   origin,
			Protocols: []string{"anthropic", "openai_responses", "openai_chat", "gemini"},
		},
		ProvisioningURL:         origin + "/api/v1/connector/provisioning",
		ConnectionBearerOrigins: []string{origin},
		SupportedAgents:         []string{"claude", "codex", "gemini", "grokbuild", "opencode", "workbuddy"},
	}})
}

// StartConnectorAuthorization turns the shared browser_pkce query into BoxAI's
// persisted one-time authorization request, then sends the browser to the
// existing authenticated approval page.
func StartConnectorAuthorization(c *gin.Context) {
	clientName := c.Query("client_name")
	if strings.TrimSpace(clientName) == "" {
		clientName = c.Query("device_name")
	}
	authorization, err := service.CreateDesktopAuthorization(
		service.ConnectClientID,
		c.Query("redirect_uri"),
		c.Query("code_challenge"),
		"S256",
		c.Query("state"),
		clientName,
	)
	if err != nil {
		desktopOAuthError(c, http.StatusBadRequest, "invalid_request", err.Error())
		return
	}
	desktopNoStore(c)
	c.Redirect(http.StatusFound, "/desktop/authorize?request="+url.QueryEscape(authorization.ID))
}

// ExchangeConnectorToken accepts the shared browser_pkce redemption shape and
// hardcodes the neutral client identity. The durable sk- credential is returned
// once by the existing transactional exchange and remains linked to the
// revocable desktop session.
func ExchangeConnectorToken(c *gin.Context) {
	var request struct {
		Code         string `json:"code"`
		CodeVerifier string `json:"code_verifier"`
		RedirectURI  string `json:"redirect_uri"`
	}
	if c.ShouldBindJSON(&request) != nil {
		desktopOAuthError(c, http.StatusBadRequest, "invalid_request", "invalid JSON")
		return
	}
	access, refresh, apiKey, expires, err := service.ExchangeDesktopCode(
		request.Code, request.CodeVerifier, service.ConnectClientID, request.RedirectURI,
	)
	if err != nil {
		desktopOAuthError(c, http.StatusBadRequest, "invalid_grant", "code is invalid or expired")
		return
	}
	desktopNoStore(c)
	c.JSON(http.StatusOK, gin.H{
		"access_token": apiKey, "token_type": "Bearer", "api_key": apiKey,
		"session_access_token": access, "refresh_token": refresh, "session_expires_in": expires,
		"base_url": publicOrigin(c) + "/v1",
	})
}

// RevokeConnectorSession disables the durable relay key authenticating this
// request and revokes its linked desktop session. TokenAuth supplies both IDs;
// no caller-controlled session or token identifier is accepted.
func RevokeConnectorSession(c *gin.Context) {
	if err := service.RevokeDesktopSessionByRelayToken(c.GetInt("id"), c.GetInt("token_id")); err != nil {
		if errors.Is(err, service.ErrDesktopInvalidGrant) {
			desktopOAuthError(c, http.StatusNotFound, "invalid_token", "connector session not found")
			return
		}
		desktopOAuthError(c, http.StatusInternalServerError, "server_error", "connector session could not be revoked")
		return
	}
	desktopNoStore(c)
	c.AbortWithStatus(http.StatusNoContent)
}

// GetConnectorProvisioning exposes account-callable models and
// server-owned integration descriptors. The bearer key authenticating this
// request is intentionally referenced, never echoed; upstream channel secrets
// are not read by this handler at all.
func GetConnectorProvisioning(c *gin.Context) {
	userID := c.GetInt("id")
	user, subscriptionRows, err := model.GetProvisioningAccountSnapshot(userID)
	if err != nil {
		c.JSON(http.StatusOK, gin.H{"success": false, "message": "get account failed"})
		return
	}
	modelNames, groups, err := accountModelNames(c)
	if err != nil {
		c.JSON(http.StatusOK, gin.H{"success": false, "message": "get account models failed"})
		return
	}
	owners, err := model.GetPreferredModelOwnerChannelTypes(modelNames, groups.ownerGroups)
	if err != nil {
		c.JSON(http.StatusOK, gin.H{"success": false, "message": "get account models failed"})
		return
	}
	pricingByModel := make(map[string]model.Pricing, len(modelNames))
	for _, pricing := range model.GetPricing() {
		pricingByModel[pricing.ModelName] = pricing
	}
	vendors := make(map[int]model.PricingVendor)
	for _, vendor := range model.GetVendors() {
		vendors[vendor.ID] = vendor
	}
	models := make([]connectorModel, 0, len(modelNames))
	for _, name := range modelNames {
		if _, available := owners[name]; !available {
			continue
		}
		endpointTypes := model.GetModelSupportEndpointTypes(name)
		endpoints := make([]string, 0, len(endpointTypes))
		for _, endpoint := range endpointTypes {
			endpoints = append(endpoints, string(endpoint))
		}
		entry := connectorModel{
			ID: name, ChatCapable: isChatModel(endpointTypes), Tags: []string{}, Endpoints: endpoints,
			SupportedReasoning: []string{},
		}
		entry.ResponsesNative = responsesNativeModel(endpointTypes, owners[name])
		if pricing, ok := pricingByModel[name]; ok {
			if pricing.SupportedReasoning {
				entry.SupportedReasoning = append(entry.SupportedReasoning, pricing.ReasoningEfforts...)
			}
			if validConnectorMetadata(pricing.Description, 2048) {
				entry.Description = pricing.Description
			}
			if validConnectorMetadata(pricing.Icon, 1024) {
				entry.Icon = pricing.Icon
			}
			seenTags := make(map[string]struct{})
			for _, tag := range strings.Split(pricing.Tags, ",") {
				tag = strings.TrimSpace(tag)
				if validConnectorMetadata(tag, 128) {
					seenTags[tag] = struct{}{}
				}
			}
			for tag := range seenTags {
				entry.Tags = append(entry.Tags, tag)
			}
			sort.Strings(entry.Tags)
			if len(entry.Tags) > 64 {
				entry.Tags = entry.Tags[:64]
			}
			if vendor, exists := vendors[pricing.VendorID]; exists {
				if validConnectorMetadata(vendor.Name, 255) {
					entry.Vendor = &connectorVendor{ID: vendor.ID, Name: vendor.Name}
					if validConnectorMetadata(vendor.Icon, 1024) {
						entry.Vendor.Icon = vendor.Icon
					}
				}
			}
		}
		models = append(models, entry)
	}
	sort.Slice(models, func(i, j int) bool { return models[i].ID < models[j].ID })

	subscriptions := make([]connectorSubscription, 0, len(subscriptionRows))
	walletFallbackAllowed := true
	for _, sub := range subscriptionRows {
		subscriptions = append(subscriptions, connectorSubscription{
			ID: sub.ID, PlanID: sub.PlanID, Status: sub.Status, Unlimited: sub.Unlimited,
			QuotaTotal: sub.QuotaTotal, QuotaUsed: sub.QuotaUsed, CurrentPeriodStart: sub.CurrentPeriodStart,
			EndTime: sub.EndTime, NextResetTime: sub.NextResetTime, WalletFallback: sub.WalletFallback,
		})
		walletFallbackAllowed = walletFallbackAllowed && sub.WalletFallback
	}
	mcpRows, err := model.ListConnectorMCPServers(true)
	if err != nil {
		c.JSON(http.StatusOK, gin.H{"success": false, "message": "get connector MCP catalog failed"})
		return
	}
	if len(mcpRows) > MaxConnectorCatalogEntries {
		c.JSON(http.StatusOK, gin.H{"success": false, "message": "connector MCP catalog exceeds supported limit"})
		return
	}
	bearerOrigins := []string{publicOrigin(c)}
	mcpServers := make([]connectorMCPServer, 0, len(mcpRows))
	for _, row := range mcpRows {
		if message := validateConnectorMCPServer(&row, bearerOrigins); message != "" {
			c.JSON(http.StatusOK, gin.H{"success": false, "message": "connector MCP catalog contains an invalid descriptor"})
			return
		}
		mcpServers = append(mcpServers, connectorMCPServer{
			ID: row.ID, Name: row.Name, URL: row.URL,
			Authorization: row.Authorization, Description: row.Description,
		})
	}
	skillRows, err := model.ListConnectorSkillReleases(true)
	if err != nil {
		c.JSON(http.StatusOK, gin.H{"success": false, "message": "get connector Skill catalog failed"})
		return
	}
	if len(skillRows) > MaxConnectorCatalogEntries {
		c.JSON(http.StatusOK, gin.H{"success": false, "message": "connector Skill catalog exceeds supported limit"})
		return
	}
	skills := make([]connectorSkill, 0, len(skillRows))
	for _, row := range skillRows {
		if message := validateConnectorSkillRelease(&row, bearerOrigins); message != "" {
			c.JSON(http.StatusOK, gin.H{"success": false, "message": "connector Skill catalog contains an invalid descriptor"})
			return
		}
		skills = append(skills, connectorSkill{
			ID: row.ID, Name: row.Name, Version: row.Version,
			Archive: connectorSkillArchive{
				URL: row.ArchiveURL, SHA256: row.ArchiveSHA256, SizeBytes: row.ArchiveSizeBytes,
				Format: row.ArchiveFormat, Authorization: row.ArchiveAuthorization,
			},
		})
	}

	remaining := int64(max(user.Quota, 0))
	used := int64(max(user.UsedQuota, 0))
	origin := publicOrigin(c)
	chatModels := make([]connectorModel, 0, len(models))
	for _, entry := range models {
		if entry.ChatCapable {
			chatModels = append(chatModels, entry)
		}
	}
	data := connectorProvisioning{
		SchemaVersion: 2,
		Account:       connectorAccount{ID: user.Id, Username: user.Username, DisplayName: user.DisplayName, Email: user.Email, Group: user.Group},
		Usage:         connectorUsage{WalletQuotaRemaining: remaining, LifetimeQuotaUsed: used, LifetimeRequestCount: int64(user.RequestCount)},
		Billing:       connectorBilling{PortalURL: origin + "/subscriptions", WalletFallbackAllowed: walletFallbackAllowed, Subscriptions: subscriptions},
		ModelPlaza:    connectorModelPlaza{PortalURL: origin + "/pricing", Models: models},
		Models:        chatModels,
		MCPServers:    mcpServers,
		Skills:        skills,
	}
	if len(chatModels) > 0 {
		data.DefaultModel = chatModels[0].ID
	}
	desktopNoStore(c)
	c.JSON(http.StatusOK, gin.H{"success": true, "data": data})
}

func responsesNativeModel(endpoints []constant.EndpointType, ownerChannelType int) bool {
	if ownerChannelType == constant.ChannelTypeCodex || ownerChannelType == constant.ChannelTypeCodexProxy {
		return true
	}
	hasResponses := false
	for _, endpoint := range endpoints {
		switch endpoint {
		case constant.EndpointTypeOpenAIResponse, constant.EndpointTypeOpenAIResponseCompact:
			hasResponses = true
		case constant.EndpointTypeOpenAIAlphaSearch:
			// Search is ancillary to the Responses protocol.
		default:
			return false
		}
	}
	return hasResponses
}

func validConnectorMetadata(value string, maxBytes int) bool {
	return value != "" && len(value) <= maxBytes && !strings.ContainsFunc(value, func(r rune) bool {
		return r < ' ' || r == 0x7f
	})
}

// GetConnectProvisioning serves the account-scoped configuration BoxAI Connect
// applies after sign-in: which chat models this account may use, which one to
// select for a client that has no choice recorded yet, and who the account is.
//
// Connect deliberately owns none of this. The catalog is per-account and the
// operator picks the default, so a desktop build cannot answer either question
// on its own without inventing a model name. Returning the identity here too
// spares the app a second round trip just to label its account panel.
func GetConnectProvisioning(c *gin.Context) {
	chatModels, _, err := accountChatModelNames(c)
	if err != nil {
		c.JSON(http.StatusOK, gin.H{"success": false, "message": "get user group failed"})
		return
	}
	modelNames, _, err := accountModelNames(c)
	if err != nil {
		c.JSON(http.StatusOK, gin.H{"success": false, "message": "get user group failed"})
		return
	}

	// Metadata is keyed by the same account-scoped catalog, never by the full
	// pricing table, so a model this token may not call stays invisible here as
	// well as in chat_models.
	allowedChatModels := make(map[string]bool, len(chatModels))
	for _, name := range chatModels {
		allowedChatModels[name] = true
	}
	modelMeta := make(map[string]connectModelMeta, len(chatModels))
	for _, pricing := range model.GetPricing() {
		if !allowedChatModels[pricing.ModelName] {
			continue
		}
		meta := connectModelMeta{
			DisplayName:      pricing.DisplayName,
			ContextLength:    pricing.ContextLength,
			MaxOutputTokens:  pricing.MaxOutputTokens,
			InputModalities:  pricing.InputModalities,
			Capabilities:     pricing.Capabilities,
			ReasoningEfforts: pricing.ReasoningEfforts,
		}
		if meta.DisplayName == "" && meta.ContextLength == 0 && meta.MaxOutputTokens == 0 &&
			len(meta.InputModalities) == 0 && len(meta.Capabilities) == 0 && len(meta.ReasoningEfforts) == 0 {
			continue
		}
		modelMeta[pricing.ModelName] = meta
	}

	imageModels, videoModels := partitionMediaModels(modelNames)
	connectSettings := system_setting.GetConnectSettings()
	policies := system_setting.GetConnectAgentPolicies()
	policyJSON, _ := common.Marshal(struct {
		Enabled  bool                                         `json:"enabled"`
		Policies map[string]system_setting.ConnectAgentPolicy `json:"policies"`
	}{
		Enabled:  connectSettings.Enabled,
		Policies: policies,
	})
	policyHash := sha256.Sum256(policyJSON)
	agents := make(map[string]connectProvisioningAgent, len(system_setting.ConnectAgentNames))
	for _, name := range system_setting.ConnectAgentNames {
		policy := policies[name]
		agentEnabled := connectSettings.Enabled && policy.Enabled
		agent := connectProvisioningAgent{Enabled: agentEnabled, Models: []string{}}
		if agentEnabled {
			agent.Models = append([]string(nil), chatModels...)
			agent.RecommendedModel = availableModel(policy.RecommendedModel, chatModels)
			agent.LockedModel = availableModel(policy.LockedModel, chatModels)
		}
		agents[name] = agent
	}

	data := connectProvisioning{
		ChatModels:   chatModels,
		DefaultModel: "",
		ModelMeta:    modelMeta,
		ImageModels:  imageModels,
		VideoModels:  videoModels,
		DefaultImage: selectToolModel(imageModels, service.PlaygroundToolImage),
		DefaultVideo: selectToolModel(videoModels, service.PlaygroundToolVideo),
		// Absolute URL so Connect can seed clients without knowing the portal host
		// shape. Path stays on the same origin as the sk- relay key.
		MCPEndpoint:         publicOrigin(c) + "/mcp",
		Revision:            hex.EncodeToString(policyHash[:]),
		RefreshAfterSeconds: 60,
		Agents:              agents,
	}
	// A missing user is not fatal: the catalog is still usable, and the app
	// simply renders its account panel without a name.
	if user, err := model.GetUserCache(c.GetInt("id")); err == nil {
		data.Account = &connectAccount{
			Id:       user.Id,
			Username: user.Username,
			Email:    user.Email,
			Quota:    user.Quota,
		}
	}

	payload := gin.H{"success": true, "data": data}
	// ETags are account-scoped because identity and quota share this response
	// with the catalog. Reusing another account's 304 cache would show stale
	// identity even when both accounts can call the same models.
	etagJSON, _ := common.Marshal(data)
	etagHash := sha256.Sum256(etagJSON)
	etag := `"` + hex.EncodeToString(etagHash[:]) + `"`
	c.Header("ETag", etag)
	c.Header("Cache-Control", "no-cache")
	if c.GetHeader("If-None-Match") == etag {
		c.AbortWithStatus(http.StatusNotModified)
		return
	}
	c.JSON(http.StatusOK, payload)
}

func availableModel(configured string, chatModels []string) string {
	for _, name := range chatModels {
		if name == configured {
			return configured
		}
	}
	return ""
}

// partitionMediaModels splits an account's model list into image and video
// catalogs for Connect MCP. A model may appear in both when it advertises both
// endpoint types.
func partitionMediaModels(modelNames []string) (imageModels, videoModels []string) {
	imageModels = make([]string, 0)
	videoModels = make([]string, 0)
	for _, name := range modelNames {
		endpoints := model.GetModelSupportEndpointTypes(name)
		if hasEndpoint(endpoints, constant.EndpointTypeImageGeneration) {
			imageModels = append(imageModels, name)
		}
		if hasEndpoint(endpoints, constant.EndpointTypeOpenAIVideo) {
			videoModels = append(videoModels, name)
		}
	}
	sort.Strings(imageModels)
	sort.Strings(videoModels)
	return imageModels, videoModels
}

func hasEndpoint(endpoints []constant.EndpointType, want constant.EndpointType) bool {
	for _, endpoint := range endpoints {
		if endpoint == want {
			return true
		}
	}
	return false
}

// publicOrigin is the externally-reachable origin. Prefer configured authority;
// only trust reverse-proxy headers when the immediate peer is trusted.
func publicOrigin(c *gin.Context) string {
	if configured := common.SiteBaseURL(system_setting.ServerAddress); configured != "" {
		return configured
	}

	scheme := strings.TrimSpace(c.GetHeader("X-Forwarded-Proto"))
	host := strings.TrimSpace(c.GetHeader("X-Forwarded-Host"))
	peer := net.ParseIP(c.RemoteIP())
	if !common.IsTrustedProxy(peer) {
		scheme = ""
		host = ""
	}
	if i := strings.IndexByte(scheme, ','); i >= 0 {
		scheme = strings.TrimSpace(scheme[:i])
	}
	if scheme != "http" && scheme != "https" {
		if c.Request.TLS != nil {
			scheme = "https"
		} else {
			scheme = "http"
		}
	}
	if i := strings.IndexByte(host, ','); i >= 0 {
		host = strings.TrimSpace(host[:i])
	}
	if host == "" {
		host = c.Request.Host
	}
	origin, err := url.Parse(scheme + "://" + host)
	if err != nil || origin.Host == "" || origin.User != nil || origin.Path != "" {
		return "https://you-box.com"
	}
	return origin.String()
}
