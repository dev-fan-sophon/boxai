// Package boxai owns BoxAI Connect's mandatory, production-only authentication.
package boxai

type Account struct {
	ID          int    `json:"id"`
	Username    string `json:"username"`
	DisplayName string `json:"display_name"`
	Email       string `json:"email"`
	Group       string `json:"group"`
}
type Model struct {
	ID                 string   `json:"id"`
	DisplayName        string   `json:"display_name,omitempty"`
	ContextLength      int      `json:"context_length,omitempty"`
	MaxOutputTokens    int      `json:"max_output_tokens,omitempty"`
	InputModalities    []string `json:"input_modalities,omitempty"`
	Capabilities       []string `json:"capabilities,omitempty"`
	ChatCapable        bool     `json:"chat_capable"`
	ResponsesNative    bool     `json:"responses_native"`
	Endpoints          []string `json:"endpoints"`
	SupportedReasoning []string `json:"supported_reasoning"`
	Description        string   `json:"description,omitempty"`
	Icon               string   `json:"icon,omitempty"`
	Tags               []string `json:"tags"`
	Vendor             *Vendor  `json:"vendor,omitempty"`
}
type Vendor struct {
	ID   int    `json:"id"`
	Name string `json:"name"`
	Icon string `json:"icon,omitempty"`
}
type Usage struct {
	WalletQuotaRemaining int64 `json:"wallet_quota_remaining"`
	LifetimeQuotaUsed    int64 `json:"lifetime_quota_used"`
	LifetimeRequestCount int64 `json:"lifetime_request_count"`
}
type Subscription struct {
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
type Billing struct {
	PortalURL             string         `json:"portal_url"`
	WalletFallbackAllowed bool           `json:"wallet_fallback_allowed"`
	Subscriptions         []Subscription `json:"subscriptions"`
}
type ModelPlaza struct {
	PortalURL string  `json:"portal_url"`
	Models    []Model `json:"models"`
}
type MCPServer struct {
	ID            string `json:"id"`
	Name          string `json:"name"`
	URL           string `json:"url"`
	Authorization string `json:"authorization"`
	Description   string `json:"description"`
}
type SkillArchive struct {
	URL           string `json:"url"`
	SHA256        string `json:"sha256"`
	SizeBytes     int64  `json:"size_bytes"`
	Format        string `json:"format"`
	Authorization string `json:"authorization"`
}
type Skill struct {
	ID      string       `json:"id"`
	Name    string       `json:"name"`
	Version string       `json:"version"`
	Archive SkillArchive `json:"archive"`
}
type ProvisioningData struct {
	SchemaVersion int                    `json:"schema_version"`
	Account       Account                `json:"account"`
	Usage         Usage                  `json:"usage"`
	Billing       Billing                `json:"billing"`
	ModelPlaza    ModelPlaza             `json:"model_plaza"`
	Models        []Model                `json:"models"`
	DefaultModel  string                 `json:"default_model"`
	MCPServers    []MCPServer            `json:"mcp_servers"`
	Skills        []Skill                `json:"skills"`
	Agents        map[string]AgentPolicy `json:"agents"`
}
type AgentPolicy struct {
	Enabled          bool     `json:"enabled"`
	Models           []string `json:"models"`
	RecommendedModel string   `json:"recommended_model"`
	LockedModel      string   `json:"locked_model,omitempty"`
}
type Session struct {
	Authenticated bool     `json:"authenticated"`
	Pending       bool     `json:"pending"`
	Error         string   `json:"error,omitempty"`
	Account       *Account `json:"account,omitempty"`
}
