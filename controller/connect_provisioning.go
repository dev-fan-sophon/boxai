package controller

import (
	"crypto/sha256"
	"encoding/hex"
	"net/http"
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
// `openai`: a model qualifies only when every endpoint it supports is a chat
// format. Handing a client an embedding, image, audio, video or 3D model
// produces a config that fails on its first request.
func isChatModel(endpoints []constant.EndpointType) bool {
	if len(endpoints) == 0 {
		return false
	}
	for _, endpoint := range endpoints {
		if !chatEndpointTypes[endpoint] {
			return false
		}
	}
	return true
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

// GetConnectProvisioning serves the account-scoped configuration BoxAI Connect
// applies after sign-in: which chat models this account may use, which one to
// select for a client that has no choice recorded yet, and who the account is.
//
// Connect deliberately owns none of this. The catalog is per-account and the
// operator picks the default, so a desktop build cannot answer either question
// on its own without inventing a model name. Returning the identity here too
// spares the app a second round trip just to label its account panel.
func GetConnectProvisioning(c *gin.Context) {
	modelNames, _, err := accountModelNames(c)
	if err != nil {
		c.JSON(http.StatusOK, gin.H{"success": false, "message": "get user group failed"})
		return
	}

	chatModels := make([]string, 0, len(modelNames))
	for _, name := range modelNames {
		if isChatModel(model.GetModelSupportEndpointTypes(name)) {
			chatModels = append(chatModels, name)
		}
	}
	sort.Strings(chatModels)

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

// publicOrigin is the externally-reachable origin of this request. Prefer the
// reverse-proxy headers nginx/Cloudflare set; fall back to the request host.
func publicOrigin(c *gin.Context) string {
	scheme := strings.TrimSpace(c.GetHeader("X-Forwarded-Proto"))
	if scheme == "" {
		if c.Request.TLS != nil {
			scheme = "https"
		} else {
			scheme = "http"
		}
	} else if i := strings.IndexByte(scheme, ','); i >= 0 {
		scheme = strings.TrimSpace(scheme[:i])
	}
	host := strings.TrimSpace(c.GetHeader("X-Forwarded-Host"))
	if host == "" {
		host = c.Request.Host
	} else if i := strings.IndexByte(host, ','); i >= 0 {
		host = strings.TrimSpace(host[:i])
	}
	if host == "" {
		return "https://you-box.com"
	}
	return scheme + "://" + host
}
