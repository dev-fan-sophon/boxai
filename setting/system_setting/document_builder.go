package system_setting

import (
	"strings"

	"github.com/dev-fan-sophon/boxai/setting/config"
)

// DocumentBuilderSettings controls the playground document generation subsystem: the model writes
// a Python build script, the edge worker runs it in a sandbox with egress disabled, and the files
// it produces become playground assets. See docs/document-artifacts.md.
//
// The feature ships behind Enabled plus a group allowlist so it can be promoted from internal
// accounts to a slice of production traffic to everyone without a deploy, and rolled back the
// same way.
type DocumentBuilderSettings struct {
	Enabled bool `json:"enabled"`
	// EnabledGroups restricts the feature to specific user groups. Empty means every group, which
	// is only correct once the rollout reaches general availability.
	EnabledGroups []string `json:"enabled_groups"`

	BaseURL       string `json:"base_url"`
	ServiceSecret string `json:"service_secret"`

	// InstanceType picks which container tier the worker uses. "basic" covers text documents and
	// simple sheets; "standard-2" is for data analysis and charts.
	InstanceType string `json:"instance_type"`
	// SleepAfterSeconds keeps the conversation's container warm between edits. This is the single
	// largest cost lever in the design: an idle container bills for memory the whole time, and two
	// idle minutes cost several times more than the build itself.
	SleepAfterSeconds int `json:"sleep_after_seconds"`
	WallClockSeconds  int `json:"wall_clock_seconds"`

	MaxConcurrentPerUser int   `json:"max_concurrent_per_user"`
	MaxArtifactBytes     int64 `json:"max_artifact_bytes"`
	// MaxAttempts counts the first build plus self-heal retries.
	MaxAttempts int `json:"max_attempts"`
	// BrowserPdfEnabled advertises the Chromium PDF path to the model. Turn it off if the
	// worker's browser binding is removed, otherwise builds will ask for a renderer that is not
	// there and burn a retry discovering it.
	BrowserPdfEnabled bool `json:"browser_pdf_enabled"`
}

var defaultDocumentBuilderSettings = DocumentBuilderSettings{
	Enabled:              false,
	EnabledGroups:        []string{},
	BaseURL:              "https://doc-builder.you-box.com",
	ServiceSecret:        "",
	InstanceType:         "basic",
	SleepAfterSeconds:    120,
	WallClockSeconds:     120,
	MaxConcurrentPerUser: 2,
	MaxArtifactBytes:     20 * 1024 * 1024,
	MaxAttempts:          3,
	BrowserPdfEnabled:    true,
}

func init() {
	config.GlobalConfig.Register("document_builder", &defaultDocumentBuilderSettings)
}

func GetDocumentBuilderSettings() *DocumentBuilderSettings {
	s := &defaultDocumentBuilderSettings
	if s.InstanceType != "standard-2" {
		s.InstanceType = "basic"
	}
	if s.SleepAfterSeconds <= 0 || s.SleepAfterSeconds > 900 {
		s.SleepAfterSeconds = 120
	}
	if s.WallClockSeconds <= 0 || s.WallClockSeconds > 180 {
		s.WallClockSeconds = 120
	}
	if s.MaxConcurrentPerUser <= 0 {
		s.MaxConcurrentPerUser = 2
	}
	if s.MaxArtifactBytes <= 0 || s.MaxArtifactBytes > 20*1024*1024 {
		s.MaxArtifactBytes = 20 * 1024 * 1024
	}
	if s.MaxAttempts <= 0 || s.MaxAttempts > 5 {
		s.MaxAttempts = 3
	}
	return s
}

// AvailableToGroup reports whether a user in the given group may build documents. An empty
// allowlist means the rollout has reached everyone.
func (s *DocumentBuilderSettings) AvailableToGroup(group string) bool {
	if !s.Enabled || strings.TrimSpace(s.BaseURL) == "" || strings.TrimSpace(s.ServiceSecret) == "" {
		return false
	}
	if len(s.EnabledGroups) == 0 {
		return true
	}
	for _, allowed := range s.EnabledGroups {
		if strings.EqualFold(strings.TrimSpace(allowed), strings.TrimSpace(group)) {
			return true
		}
	}
	return false
}
