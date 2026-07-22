package controller

import (
	"strings"
	"unicode/utf8"
)

// truncateRunes truncates s to at most max runes without splitting UTF-8 sequences.
func truncateRunes(s string, max int) string {
	if max <= 0 || s == "" {
		return ""
	}
	if utf8.RuneCountInString(s) <= max {
		return s
	}
	return string([]rune(s)[:max])
}

// allowlistedResultURL accepts only safe schemes for "My works" preview URLs.
// Protocol-relative URLs (//evil.example/...) are rejected — they start with "/"
// but resolve off-origin in the browser.
func allowlistedResultURL(raw string) string {
	raw = strings.TrimSpace(raw)
	if raw == "" {
		return ""
	}
	lower := strings.ToLower(raw)
	switch {
	case strings.HasPrefix(lower, "https://"):
		return raw
	case strings.HasPrefix(lower, "http://"):
		return raw
	case strings.HasPrefix(lower, "data:image/"):
		// bound size of inline previews stored in DB
		if len(raw) > 1000 {
			return ""
		}
		return raw
	case strings.HasPrefix(raw, "//"):
		// protocol-relative → attacker host when used as img/href src
		return ""
	case strings.HasPrefix(raw, "/"):
		// true same-origin path only: single leading slash, no "//", no ".."
		if strings.Contains(raw, "..") || strings.Contains(raw, "\\") {
			return ""
		}
		// Disallow embedded scheme-like segments after the first slash group
		if strings.Contains(raw[1:], "//") {
			return ""
		}
		if len(raw) > 1000 {
			return raw[:1000]
		}
		return raw
	default:
		return ""
	}
}
