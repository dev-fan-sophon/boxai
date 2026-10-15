package operation_setting

import (
	"errors"
	"strings"
	"sync"

	"github.com/dev-fan-sophon/boxai/common"
)

const RegistrationRiskOptionKey = "RegistrationRiskPolicy"

// DefaultTrustedEmailDomains lists established consumer mailbox providers.
// Domain reputation treats anything outside the list as untrusted: an OAuth
// identity on a self-owned domain proves only that someone can receive mail
// there, while a mailbox at a major provider carries that provider's own signup
// controls. Operators extend the list instead of allowing untrusted domains.
var DefaultTrustedEmailDomains = []string{
	"gmail.com", "googlemail.com",
	"outlook.com", "hotmail.com", "live.com", "msn.com",
	"yahoo.com", "ymail.com", "rocketmail.com",
	"icloud.com", "me.com", "mac.com",
	"aol.com", "gmx.com", "gmx.net", "mail.com", "zoho.com",
	"proton.me", "protonmail.com", "tutanota.com", "tuta.com",
	"yandex.com", "yandex.ru", "mail.ru", "bk.ru", "inbox.ru", "list.ru", "rambler.ru",
	"qq.com", "foxmail.com", "163.com", "126.com", "yeah.net", "sina.com", "sohu.com",
	"naver.com", "hanmail.net", "daum.net", "nate.com",
	"docomo.ne.jp", "ezweb.ne.jp", "softbank.ne.jp",
	"free.fr", "orange.fr", "laposte.net", "wanadoo.fr", "sfr.fr",
	"web.de", "t-online.de", "seznam.cz", "wp.pl", "o2.pl", "interia.pl", "onet.pl",
	"edu.vn", "users.noreply.github.com",
}

// RegistrationRiskPolicy controls signup abuse, not model access or pricing.
type RegistrationRiskPolicy struct {
	Enabled             bool     `json:"enabled"`
	RegistrationIPDaily int      `json:"registration_ip_daily"`
	EmailIPHourly       int      `json:"email_ip_hourly"`
	EmailIdentityHourly int      `json:"email_identity_hourly"`
	BlockedEmailDomains []string `json:"blocked_email_domains"`
	// Domain reputation. TrustedEmailDomains holds established mailbox
	// providers; a blocked domain always wins over a trusted one. An OAuth
	// signup on a self-owned domain proves only mailbox access, so
	// RejectUntrustedOAuthEmail can require a trusted provider there, while
	// RejectUntrustedPasswordEmail applies the same rule to password signups
	// that already pass mailbox verification.
	TrustedEmailDomains          []string `json:"trusted_email_domains"`
	RejectUntrustedOAuthEmail    bool     `json:"reject_untrusted_oauth_email"`
	RejectUntrustedPasswordEmail bool     `json:"reject_untrusted_password_email"`
}

var registrationRiskMu sync.RWMutex
var registrationRisk = RegistrationRiskPolicy{
	RegistrationIPDaily: 20, EmailIPHourly: 10, EmailIdentityHourly: 3,
	TrustedEmailDomains: append([]string(nil), DefaultTrustedEmailDomains...),
}

func GetRegistrationRiskPolicy() RegistrationRiskPolicy {
	registrationRiskMu.RLock()
	defer registrationRiskMu.RUnlock()
	policy := registrationRisk
	policy.BlockedEmailDomains = append([]string(nil), policy.BlockedEmailDomains...)
	policy.TrustedEmailDomains = append([]string(nil), policy.TrustedEmailDomains...)
	return policy
}

func normalizeEmailDomainList(domains []string) ([]string, error) {
	normalized := make([]string, 0, len(domains))
	for _, domain := range domains {
		domain = strings.ToLower(strings.TrimSpace(domain))
		if !strings.Contains(domain, ".") || strings.ContainsAny(domain, " /@*:\n\r") {
			return nil, errors.New("email domains must be exact domain names")
		}
		normalized = append(normalized, domain)
	}
	return normalized, nil
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
	var err error
	if p.BlockedEmailDomains, err = normalizeEmailDomainList(p.BlockedEmailDomains); err != nil {
		return p, err
	}
	if p.TrustedEmailDomains, err = normalizeEmailDomainList(p.TrustedEmailDomains); err != nil {
		return p, err
	}
	// Rejecting untrusted domains with no trusted domain configured would
	// reject every signup, so refuse the combination instead of accepting it.
	if (p.RejectUntrustedOAuthEmail || p.RejectUntrustedPasswordEmail) && len(p.TrustedEmailDomains) == 0 {
		return p, errors.New("trusted email domains must be configured before untrusted domains can be rejected")
	}
	trusted := make(map[string]struct{}, len(p.TrustedEmailDomains))
	for _, domain := range p.TrustedEmailDomains {
		trusted[domain] = struct{}{}
	}
	for _, domain := range p.BlockedEmailDomains {
		if _, ok := trusted[domain]; ok {
			return p, errors.New("an email domain cannot be both blocked and trusted")
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
