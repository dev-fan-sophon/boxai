package model

import (
	"crypto/sha256"
	"errors"
	"fmt"
	"net"
	"strings"
	"time"

	"github.com/dev-fan-sophon/boxai/setting/operation_setting"
	"gorm.io/gorm"
	"gorm.io/gorm/clause"
)

type RegistrationRiskCounter struct {
	Identity  string `gorm:"type:char(64);primaryKey"`
	Requests  int
	ExpiresAt int64 `gorm:"index"`
}

// TakeRegistrationRiskSlot is also used for email sending. Its conditional
// update is the authority even with Redis down or across multiple instances.
func TakeRegistrationRiskSlot(tx *gorm.DB, scope, identity string, limit int, seconds int64) error {
	if limit <= 0 || identity == "" {
		return errors.New("registration risk check unavailable")
	}
	now := time.Now().Unix()
	key := fmt.Sprintf("%x", sha256.Sum256([]byte(scope+"\x00"+identity)))
	if err := tx.Clauses(clause.OnConflict{DoNothing: true}).Create(&RegistrationRiskCounter{Identity: key}).Error; err != nil {
		return err
	}
	res := tx.Model(&RegistrationRiskCounter{}).Where("identity = ? AND (expires_at <= ? OR requests < ?)", key, now, limit).
		// MySQL evaluates assignments left-to-right. Reset the count before
		// changing expires_at; sorted map updates would reverse this order.
		Clauses(clause.Set{
			{Column: clause.Column{Name: "requests"}, Value: gorm.Expr("CASE WHEN expires_at <= ? THEN 1 ELSE requests + 1 END", now)},
			{Column: clause.Column{Name: "expires_at"}, Value: gorm.Expr("CASE WHEN expires_at <= ? THEN ? ELSE expires_at END", now, now+seconds)},
		}).Updates(map[string]any{})
	if res.Error != nil {
		return res.Error
	}
	if res.RowsAffected != 1 {
		return errors.New("Too many registration or verification attempts. Please try again later.")
	}
	return nil
}

// IPv6 privacy addresses share a /64 budget. IPv4 is kept exact: a shared
// mobile/corporate network is a throttle signal, never a reason to ban users.
func RegistrationRiskNetwork(ip string) string {
	parsed := net.ParseIP(ip)
	if parsed == nil {
		return "unknown"
	}
	if v4 := parsed.To4(); v4 != nil {
		return v4.String()
	}
	return parsed.Mask(net.CIDRMask(64, 128)).String() + "/64"
}

// EmailDomainReputation classifies a registration email domain under the
// current policy: blocked, a trusted mailbox provider, or an untrusted custom
// domain. Blocked is the zero value so an unset classification fails closed.
type EmailDomainReputation int

const (
	EmailDomainBlocked EmailDomainReputation = iota
	EmailDomainUntrusted
	EmailDomainTrusted
)

// EmailDomainReputationFor classifies a normalized email domain. Blocked
// domains win over trusted ones, and a subdomain follows its parent domain.
func EmailDomainReputationFor(domain string) EmailDomainReputation {
	p := operation_setting.GetRegistrationRiskPolicy()
	for _, blocked := range p.BlockedEmailDomains {
		if emailDomainMatches(blocked, domain) {
			return EmailDomainBlocked
		}
	}
	for _, trusted := range p.TrustedEmailDomains {
		if emailDomainMatches(trusted, domain) {
			return EmailDomainTrusted
		}
	}
	return EmailDomainUntrusted
}

func emailDomainMatches(rule string, domain string) bool {
	return domain == rule || strings.HasSuffix(domain, "."+rule)
}

// CheckRegistrationEmail verifies that an address may register from the given
// source. Blocked and trusted domains apply to every source; the
// untrusted-domain rules are per source, because an OAuth identity on a
// self-owned domain is weaker evidence than a mailbox-verified password signup.
func CheckRegistrationEmail(email string, registerSource string) error {
	p := operation_setting.GetRegistrationRiskPolicy()
	if !p.Enabled || email == "" {
		return nil
	}
	_, domain, ok := strings.Cut(NormalizeEmail(email), "@")
	if !ok || domain == "" {
		return errors.New("Invalid email address.")
	}
	switch EmailDomainReputationFor(domain) {
	case EmailDomainBlocked:
		return errors.New("This email domain cannot be used for registration. Please contact support.")
	case EmailDomainTrusted:
		return nil
	}
	if p.RejectUntrustedOAuthEmail && strings.HasPrefix(registerSource, RegisterSourceOAuth) {
		return errors.New("Please sign up with an email address from a well-known mailbox provider, or contact support.")
	}
	if p.RejectUntrustedPasswordEmail && registerSource == RegisterSourcePassword {
		return errors.New("Please sign up with an email address from a well-known mailbox provider, or contact support.")
	}
	return nil
}

func applyRegistrationRisk(tx *gorm.DB, user *User) error {
	p := operation_setting.GetRegistrationRiskPolicy()
	if !p.Enabled || user.RegisterSource == "" || user.RegisterSource == RegisterSourceAdmin {
		return nil
	}
	if err := CheckRegistrationEmail(user.Email, user.RegisterSource); err != nil {
		return err
	}
	return TakeRegistrationRiskSlot(tx, "register-ip", RegistrationRiskNetwork(user.RegisterIp), p.RegistrationIPDaily, 86400)
}
