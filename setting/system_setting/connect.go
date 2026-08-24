package system_setting

import (
	"github.com/dev-fan-sophon/boxai/common"
	"github.com/dev-fan-sophon/boxai/setting/config"
)

var ConnectAgentNames = []string{"claude", "codex", "gemini", "grokbuild", "opencode", "workbuddy", "openclaw", "hermes"}

type ConnectAgentPolicy struct {
	Enabled          bool   `json:"enabled"`
	RecommendedModel string `json:"recommended_model"`
	LockedModel      string `json:"locked_model,omitempty"`
}

// ConnectSettings controls BoxAI Connect, the desktop app that points AI coding
// clients (Claude Code, Codex CLI, Gemini CLI, Grok Build, OpenCode, WorkBuddy,
// OpenClaw, Hermes) at this deployment.
//
// Token issuance policy — access token lifetime, refresh lifetime, broker
// audience — is deliberately not duplicated here. Both desktop products share
// one JWT audience and one signing key, so those stay in DesktopSettings.
type ConnectSettings struct {
	Enabled bool `json:"enabled"`
	// ReleaseManifestURL points at the releases.json the Connect publish
	// pipeline writes to Cloudflare R2. The download page reads it directly, so
	// shipping a release never needs a backend deploy.
	ReleaseManifestURL string `json:"release_manifest_url"`
	// DownloadURL is the manual override used when no manifest is reachable.
	DownloadURL string `json:"download_url"`
	MinVersion  string `json:"min_version"`
	// TokenName is the fallback label for a relay key Connect creates, used only
	// when the app does not send its own device-specific name.
	TokenName string `json:"token_name"`
	// AgentPolicies is updated as one JSON option so readers never observe a
	// partially-applied set of agent policies.
	AgentPolicies string `json:"agent_policies"`
}

var defaultConnectSettings = ConnectSettings{
	Enabled:            false,
	ReleaseManifestURL: "https://dl.you-box.com/connect/releases.json",
	DownloadURL:        "",
	MinVersion:         "",
	TokenName:          "BoxAI Connect",
	AgentPolicies:      `{"claude":{"enabled":true,"recommended_model":""},"codex":{"enabled":true,"recommended_model":""},"gemini":{"enabled":true,"recommended_model":""},"grokbuild":{"enabled":true,"recommended_model":""},"opencode":{"enabled":true,"recommended_model":""},"workbuddy":{"enabled":true,"recommended_model":""},"openclaw":{"enabled":true,"recommended_model":""},"hermes":{"enabled":true,"recommended_model":""}}`,
}

func init() {
	config.GlobalConfig.Register("connect", &defaultConnectSettings)
}

func GetConnectSettings() *ConnectSettings {
	if defaultConnectSettings.TokenName == "" {
		defaultConnectSettings.TokenName = "BoxAI Connect"
	}
	return &defaultConnectSettings
}

// GetConnectAgentPolicies returns a complete snapshot of the eight supported
// agents. Missing entries use defaults; malformed JSON fails closed.
func GetConnectAgentPolicies() map[string]ConnectAgentPolicy {
	var settings ConnectSettings
	if err := config.GlobalConfig.CopyRegistered("connect", &settings); err != nil {
		settings = defaultConnectSettings
	}
	var configured map[string]ConnectAgentPolicy
	if common.UnmarshalJsonStr(settings.AgentPolicies, &configured) != nil {
		// A malformed policy must fail closed rather than silently enabling every
		// remotely managed agent.
		return make(map[string]ConnectAgentPolicy)
	}
	policies := make(map[string]ConnectAgentPolicy, len(ConnectAgentNames))
	for _, name := range ConnectAgentNames {
		if policy, ok := configured[name]; ok {
			policies[name] = policy
		} else {
			policies[name] = ConnectAgentPolicy{Enabled: true}
		}
	}
	return policies
}
