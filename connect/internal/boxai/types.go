package boxai

type Account struct {
	ID          int    `json:"id"`
	Username    string `json:"username"`
	DisplayName string `json:"display_name"`
	Email       string `json:"email"`
	Group       string `json:"group"`
}

type Usage struct {
	WalletQuotaRemaining int64 `json:"wallet_quota_remaining"`
	LifetimeQuotaUsed    int64 `json:"lifetime_quota_used"`
	LifetimeRequestCount int64 `json:"lifetime_request_count"`
}

// ProvisioningData deliberately excludes relay secrets and remote policies.
type ProvisioningData struct {
	Account Account        `json:"account"`
	Usage   Usage          `json:"usage"`
	Billing map[string]any `json:"billing"`
}

type Session struct {
	Authenticated    bool     `json:"authenticated"`
	Pending          bool     `json:"pending"`
	Error            string   `json:"error,omitempty"`
	Account          *Account `json:"account,omitempty"`
	AuthorizationURL string   `json:"authorization_url,omitempty"`
}
