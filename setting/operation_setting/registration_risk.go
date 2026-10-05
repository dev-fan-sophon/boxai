package operation_setting

import (
	"errors"
	"strings"
	"sync"

	"github.com/dev-fan-sophon/boxai/common"
)

const RegistrationRiskOptionKey = "RegistrationRiskPolicy"

// RegistrationRiskPolicy controls signup abuse, not model access or pricing.
type RegistrationRiskPolicy struct {
	Enabled             bool     `json:"enabled"`
	RegistrationIPDaily int      `json:"registration_ip_daily"`
	EmailIPHourly       int      `json:"email_ip_hourly"`
	EmailIdentityHourly int      `json:"email_identity_hourly"`
	BlockedEmailDomains []string `json:"blocked_email_domains"`
}

var registrationRiskMu sync.RWMutex
var registrationRisk = RegistrationRiskPolicy{
	RegistrationIPDaily: 20, EmailIPHourly: 10, EmailIdentityHourly: 3,
}

func GetRegistrationRiskPolicy() RegistrationRiskPolicy {
	registrationRiskMu.RLock()
	defer registrationRiskMu.RUnlock()
	policy := registrationRisk
	policy.BlockedEmailDomains = append([]string(nil), policy.BlockedEmailDomains...)
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
	for i, domain := range p.BlockedEmailDomains {
		domain = strings.ToLower(strings.TrimSpace(domain))
		if !strings.Contains(domain, ".") || strings.ContainsAny(domain, " /@*:\n\r") {
			return p, errors.New("blocked email domains must be exact domain names")
		}
		p.BlockedEmailDomains[i] = domain
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
