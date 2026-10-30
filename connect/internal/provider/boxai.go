package provider

import (
	"errors"

	"github.com/yetone/magpie/internal/boxai"
)

// UseBoxAI selects the product's provider at startup, before any configuration
// is read. The underlying Magpie provider implementation remains unchanged.
func UseBoxAI()       { boxai.Enable() }
func BoxAIOnly() bool { return boxai.Enabled() }

var errBoxAIOnly = errors.New("BoxAI is the only supported provider")

var boxAIPreset = PresetDef{
	ID: "boxai", Name: "BoxAI", Icon: "magpie", Kind: KindRelay,
	Chat: "https://you-box.com/v1", Responses: "https://you-box.com/v1",
	Anthropic: "https://you-box.com", Website: "https://you-box.com",
	KeysURL: "https://you-box.com/keys",
}

func authenticatedBoxAI(stored []Provider) []Provider {
	token := boxai.CachedToken()
	if token == "" {
		return nil
	}
	p := Provider{ID: "boxai"}
	for _, saved := range stored {
		if saved.ID == "boxai" {
			p = saved
			break
		}
	}
	return []Provider{sanitizedBoxAI(p, token)}
}

// sanitizedBoxAI is shared by runtime authentication and portable exports.
func sanitizedBoxAI(p Provider, token string) Provider {
	p.Account, p.Decide, p.ModelsURL, p.BalanceURL = nil, "", "", ""
	p.Chat, p.Responses, p.Anthropic = boxAIPreset.Chat, boxAIPreset.Responses, boxAIPreset.Anthropic
	p.Name, p.Preset, p.Icon = "BoxAI", "boxai", boxAIPreset.Icon
	// A manually configured key or auth header must never bypass the session.
	p.Key, p.Keys, p.Headers, p.KeyProtocol = token, nil, nil, ""
	p.BalanceToken = ""
	// Stored configuration is untrusted. Strip every alternate transport and
	// authentication mechanism before the website token enters the provider.
	p.Gemini, p.AuthHeader, p.Proxy, p.BaseAPI = "", "", "", ""
	p.Vertex, p.ZhipuTeam, p.AccountProxies = nil, nil, nil
	p.AccessKeyID, p.SecretAccessKey = "", ""
	p.ExtraBody, p.ReplyHeaders, p.Fallback, p.Was = nil, nil, nil, nil
	p.InsecureTLS, p.SwitchOnly = false, false
	return normalize(p)
}

// Accept the normal preset/key form, but never a substitute relay endpoint.
func boxAIProvider(p Provider) (Provider, error) {
	if p.ID != "boxai" || (p.Preset != "" && p.Preset != "boxai") || p.Account != nil ||
		(p.Chat != "" && p.Chat != boxAIPreset.Chat) ||
		(p.Responses != "" && p.Responses != boxAIPreset.Responses) ||
		(p.Anthropic != "" && p.Anthropic != boxAIPreset.Anthropic) ||
		p.Decide != "" || p.ModelsURL != "" || p.BalanceURL != "" ||
		p.Gemini != "" || p.Vertex != nil || p.ZhipuTeam != nil ||
		p.AuthHeader != "" || p.Proxy != "" || len(p.AccountProxies) != 0 ||
		p.InsecureTLS || len(p.ExtraBody) != 0 || len(p.Fallback) != 0 {
		return Provider{}, errBoxAIOnly
	}
	p.Name, p.Preset, p.Icon = boxAIPreset.Name, boxAIPreset.ID, boxAIPreset.Icon
	p.Chat, p.Responses, p.Anthropic = boxAIPreset.Chat, boxAIPreset.Responses, boxAIPreset.Anthropic
	p.Website, p.KeysURL, p.Was = boxAIPreset.Website, boxAIPreset.KeysURL, nil
	return p, nil
}
