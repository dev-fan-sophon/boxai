package system_setting

import (
	"strings"

	"github.com/dev-fan-sophon/boxai/setting/config"
)

// PlaygroundMemorySettings controls the playground chat memory subsystem: a rolling
// per-conversation summary (context compression) and cross-conversation user memories.
// Both are produced server-side against a platform-paid, OpenAI-compatible endpoint,
// so the designated cheap model never bills the end user.
type PlaygroundMemorySettings struct {
	Enabled bool `json:"enabled"`

	// BaseURL + APIKey + Model describe the platform-paid extraction endpoint.
	// BaseURL is the API root (e.g. https://you-box.com/v1 or a direct upstream);
	// requests go to {BaseURL}/chat/completions.
	BaseURL string `json:"base_url"`
	APIKey  string `json:"api_key"`
	Model   string `json:"model"`

	// ExtractEveryMessages runs memory extraction once this many new turns have
	// accumulated since the previous extraction of a conversation.
	ExtractEveryMessages int `json:"extract_every_messages"`
	// MaxMemories caps stored memories per user; extraction refuses to grow past it.
	MaxMemories int `json:"max_memories"`

	// SummaryEnabled maintains the rolling conversation summary used by clients to
	// truncate history. SummaryKeepRecent is how many latest turns stay verbatim
	// (never summarized); SummaryTriggerMessages is the thread length at which the
	// summary starts being maintained.
	SummaryEnabled         bool `json:"summary_enabled"`
	SummaryTriggerMessages int  `json:"summary_trigger_messages"`
	SummaryKeepRecent      int  `json:"summary_keep_recent"`

	TimeoutSeconds int `json:"timeout_seconds"`
}

var defaultPlaygroundMemorySettings = PlaygroundMemorySettings{
	Enabled:                false,
	BaseURL:                "",
	APIKey:                 "",
	Model:                  "",
	ExtractEveryMessages:   8,
	MaxMemories:            50,
	SummaryEnabled:         true,
	SummaryTriggerMessages: 24,
	SummaryKeepRecent:      12,
	TimeoutSeconds:         60,
}

func init() {
	config.GlobalConfig.Register("playground_memory", &defaultPlaygroundMemorySettings)
}

func GetPlaygroundMemorySettings() *PlaygroundMemorySettings {
	s := &defaultPlaygroundMemorySettings
	if s.ExtractEveryMessages < 2 || s.ExtractEveryMessages > 100 {
		s.ExtractEveryMessages = 8
	}
	if s.MaxMemories <= 0 || s.MaxMemories > 200 {
		s.MaxMemories = 50
	}
	if s.SummaryTriggerMessages < 8 || s.SummaryTriggerMessages > 500 {
		s.SummaryTriggerMessages = 24
	}
	if s.SummaryKeepRecent < 4 || s.SummaryKeepRecent > 100 {
		s.SummaryKeepRecent = 12
	}
	if s.TimeoutSeconds <= 0 || s.TimeoutSeconds > 300 {
		s.TimeoutSeconds = 60
	}
	return s
}

// Ready reports whether the platform-paid extraction endpoint is usable.
func (s *PlaygroundMemorySettings) Ready() bool {
	return s.Enabled &&
		strings.TrimSpace(s.BaseURL) != "" &&
		strings.TrimSpace(s.APIKey) != "" &&
		strings.TrimSpace(s.Model) != ""
}
