package common

import (
	"crypto/sha256"
	"fmt"
	"net/url"
	"strings"

	"github.com/dev-fan-sophon/boxai/common"
	"github.com/gin-gonic/gin"
	"github.com/tidwall/gjson"
)

// normalizeOpenCodeSession runs on each channel attempt, before parameter
// overrides. Clients need not know which provider the gateway will select.
func (info *RelayInfo) normalizeOpenCodeSession(c *gin.Context) {
	upstream, err := url.Parse(info.ChannelBaseUrl)
	if err != nil || !strings.EqualFold(upstream.Hostname(), "opencode.ai") ||
		(upstream.Path != "/zen/go" && !strings.HasPrefix(upstream.Path, "/zen/go/")) {
		return
	}
	if c == nil || c.Request == nil || info.UserId == 0 {
		return
	}
	var session string
	for _, name := range []string{"x-opencode-session", "x-session-affinity", "x-session-id", "session_id", "session-id", "x-claude-code-session-id"} {
		if value := strings.TrimSpace(c.GetHeader(name)); value != "" {
			session = value
			break
		}
	}
	if session == "" {
		storage, err := common.GetBodyStorage(c)
		if err != nil {
			return
		}
		body, err := storage.Bytes()
		if err != nil || !gjson.ValidBytes(body) {
			return
		}
		var identity, source string
		for _, path := range []string{"prompt_cache_key", "metadata.session_id"} {
			value := gjson.GetBytes(body, path)
			if value.Type == gjson.String && strings.TrimSpace(value.Str) != "" {
				identity, source = value.Str, "session"
				break
			}
		}
		if identity == "" {
			// Claude Code has used both JSON-encoded metadata and the legacy
			// user_<account>_account_<account>_session_<conversation> format.
			userID := gjson.GetBytes(body, "metadata.user_id").Str
			if value := gjson.Get(userID, "session_id"); value.Type == gjson.String {
				identity = strings.TrimSpace(value.Str)
			} else if index := strings.LastIndex(userID, "_session_"); index >= 0 {
				identity = strings.TrimSpace(userID[index+len("_session_"):])
			}
			source = "session"
		}
		if identity == "" {
			// Stateless clients repeat their opening user message on later
			// turns. This is a best-effort identity, not an exact conversation
			// identifier when histories are truncated or openings are reused.
			first := gjson.GetBytes(body, `messages.#(role=="user").content`)
			if !first.Exists() {
				first = gjson.GetBytes(body, `input.#(role=="user").content`)
			}
			if !first.Exists() {
				input := gjson.GetBytes(body, "input")
				if input.Type == gjson.String {
					first = input
				}
			}
			if !first.Exists() || first.Type == gjson.Null {
				return
			}
			canonical, err := common.Marshal(first.Value())
			if err != nil {
				return
			}
			identity, source = string(canonical), "opening"
		}
		// Never send prompt text or account metadata as an upstream header.
		// Scope derived IDs to the authenticated principal and credential.
		digest := sha256.Sum256([]byte(fmt.Sprintf("%d:%d:%s:%s", info.UserId, info.TokenId, source, identity)))
		session = fmt.Sprintf("boxai-%x", digest[:])
	}
	c.Request.Header.Set("x-opencode-session", session)
	if info.RequestHeaders == nil {
		info.RequestHeaders = make(map[string]string)
	}
	info.RequestHeaders["x-opencode-session"] = session
}
