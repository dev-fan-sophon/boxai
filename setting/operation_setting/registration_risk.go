package operation_setting

import (
	"errors"
	"strings"
	"sync"

	"github.com/dev-fan-sophon/boxai/common"
)

const RegistrationRiskOptionKey = "RegistrationRiskPolicy"

// RegistrationRiskPolicy is updated atomically, so a partial settings update
// cannot enable trials without their budget, eligibility window and model list.
type RegistrationRiskPolicy struct {
	Enabled              bool     `json:"enabled"`
	RegistrationIPDaily  int      `json:"registration_ip_daily"`
	EmailIPHourly        int      `json:"email_ip_hourly"`
	EmailIdentityHourly  int      `json:"email_identity_hourly"`
	BlockedEmailDomains  []string `json:"blocked_email_domains"`
	TrialEnabled         bool     `json:"trial_enabled"`
	TrialEligibleAfter   int64    `json:"trial_eligible_after"`
	TrialQuota           int      `json:"trial_quota"`
	TrialDays            int      `json:"trial_days"`
	TrialDailyBudget     int      `json:"trial_daily_budget"`
	TrialMaxConcurrency  int      `json:"trial_max_concurrency"`
	TrialMaxRequestQuota int      `json:"trial_max_request_quota"`
	TrialMaxOutputTokens int      `json:"trial_max_output_tokens"`
	TrialModels          []string `json:"trial_models"`
}

var registrationRiskMu sync.RWMutex
var registrationRisk = RegistrationRiskPolicy{
	RegistrationIPDaily: 20, EmailIPHourly: 10, EmailIdentityHourly: 3,
	TrialQuota: 80000, TrialDays: 7, TrialDailyBudget: 8000000,
	TrialMaxConcurrency: 1, TrialMaxRequestQuota: 20000, TrialMaxOutputTokens: 2048,
}

func GetRegistrationRiskPolicy() RegistrationRiskPolicy {
	registrationRiskMu.RLock()
	defer registrationRiskMu.RUnlock()
	policy := registrationRisk
	policy.BlockedEmailDomains = append([]string(nil), policy.BlockedEmailDomains...)
	policy.TrialModels = append([]string(nil), policy.TrialModels...)
	return policy
}

func ParseRegistrationRiskPolicy(raw string) (RegistrationRiskPolicy, error) {
	var p RegistrationRiskPolicy
	if err := common.UnmarshalJsonStr(raw, &p); err != nil {
		return p, err
	}
	if p.RegistrationIPDaily < 1 || p.RegistrationIPDaily > 10000 ||
		p.EmailIPHourly < 1 || p.EmailIPHourly > 10000 || p.EmailIdentityHourly < 1 || p.EmailIdentityHourly > 100 {
		return p, errors.New("registration and email limits must be positive and bounded")
	}
	if p.TrialQuota < 1 || p.TrialQuota > 100000000 || p.TrialDays < 1 || p.TrialDays > 90 ||
		p.TrialDailyBudget < p.TrialQuota || p.TrialDailyBudget > 2000000000 ||
		p.TrialMaxConcurrency < 1 || p.TrialMaxConcurrency > 5 ||
		p.TrialMaxRequestQuota < 1 || p.TrialMaxRequestQuota > p.TrialQuota ||
		p.TrialMaxOutputTokens < 1 || p.TrialMaxOutputTokens > 8192 {
		return p, errors.New("invalid trial quota, duration, budget or concurrency limits")
	}
	if p.TrialEnabled && (!p.Enabled || p.TrialEligibleAfter <= 0 || len(p.TrialModels) == 0) {
		return p, errors.New("trials require risk controls, an eligibility cutoff and an explicit model list")
	}
	for i, domain := range p.BlockedEmailDomains {
		domain = strings.ToLower(strings.TrimSpace(domain))
		if !strings.Contains(domain, ".") || strings.ContainsAny(domain, " /@*:\n\r") {
			return p, errors.New("blocked email domains must be exact domain names")
		}
		p.BlockedEmailDomains[i] = domain
	}
	for _, name := range p.TrialModels {
		if name == "" || name != strings.TrimSpace(name) || strings.ContainsAny(name, "*,\n\r") {
			return p, errors.New("trial models must be exact model IDs")
		}
	}
	return p, nil
}

func SetRegistrationRiskPolicy(raw string) error {
	policy, err := ParseRegistrationRiskPolicy(raw)
	if err != nil {
		return err
	}
	registrationRiskMu.Lock()
	registrationRisk = policy
	registrationRiskMu.Unlock()
	return nil
}
