package common

import "strings"

// EmailRiskIdentity is only for anti-abuse matching, never login identity or
// mail delivery. Only Gmail's documented dot/plus aliases are collapsed;
// custom domains and other providers keep their original local part.
func EmailRiskIdentity(email string) string {
	email = strings.ToLower(strings.TrimSpace(email))
	local, domain, ok := strings.Cut(email, "@")
	if !ok {
		return email
	}
	if domain == "gmail.com" || domain == "googlemail.com" {
		local, _, _ = strings.Cut(local, "+")
		local = strings.ReplaceAll(local, ".", "")
		domain = "gmail.com"
	}
	return local + "@" + domain
}
