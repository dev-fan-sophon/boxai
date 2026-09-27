package provider

import (
	"errors"
	"sync/atomic"
)

var boxAIOnly atomic.Bool

// UseBoxAI selects the product's provider at startup, before any configuration
// is read. The underlying Magpie provider implementation remains unchanged.
func UseBoxAI()       { boxAIOnly.Store(true) }
func BoxAIOnly() bool { return boxAIOnly.Load() }

var errBoxAIOnly = errors.New("BoxAI is the only supported provider")

var boxAIPreset = PresetDef{
	ID: "boxai", Name: "BoxAI", Icon: "magpie", Kind: KindRelay,
	Chat: "https://you-box.com/v1", Responses: "https://you-box.com/v1",
	Anthropic: "https://you-box.com", Website: "https://you-box.com",
	KeysURL: "https://you-box.com/keys",
}

// Accept the normal preset/key form, but never a substitute relay endpoint.
func boxAIProvider(p Provider) (Provider, error) {
	if p.ID != "boxai" || (p.Preset != "" && p.Preset != "boxai") || p.Account != nil ||
		(p.Chat != "" && p.Chat != boxAIPreset.Chat) ||
		(p.Responses != "" && p.Responses != boxAIPreset.Responses) ||
		(p.Anthropic != "" && p.Anthropic != boxAIPreset.Anthropic) ||
		p.Decide != "" || p.ModelsURL != "" || p.BalanceURL != "" {
		return Provider{}, errBoxAIOnly
	}
	p.Name, p.Preset, p.Icon = boxAIPreset.Name, boxAIPreset.ID, boxAIPreset.Icon
	p.Chat, p.Responses, p.Anthropic = boxAIPreset.Chat, boxAIPreset.Responses, boxAIPreset.Anthropic
	p.Website, p.KeysURL, p.Was = boxAIPreset.Website, boxAIPreset.KeysURL, nil
	return p, nil
}
