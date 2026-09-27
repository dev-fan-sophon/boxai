package agent

import (
	"errors"
	"strings"
	"sync"
)

type Policy struct {
	Enabled          bool
	Models           []string
	RecommendedModel string
	LockedModel      string
}

var policies struct {
	sync.RWMutex
	agents map[string]Policy
}

// SetPolicies takes the authenticated provisioning wire IDs (grokbuild, not
// Magpie's grok). Call with nil when the account ends. Snapshot copies prevent
// a provisioning refresh racing with a model picker or apply.
func SetPolicies(in map[string]Policy) {
	safety.Lock()
	defer safety.Unlock()
	out := map[string]Policy{}
	for id, p := range in {
		p.Models = append([]string(nil), p.Models...)
		out[id] = p
	}
	policies.Lock()
	policies.agents = out
	policies.Unlock()
}
func policyModel(id, value string) bool {
	if id == "grok" {
		id = "grokbuild"
	}
	value = strings.TrimPrefix(value, magpieID+"/")
	model, ok := strings.CutPrefix(value, "boxai/")
	if !ok || model == "" {
		return false
	}
	policies.RLock()
	defer policies.RUnlock()
	p, ok := policies.agents[id]
	if !ok || !p.Enabled || (p.LockedModel != "" && p.LockedModel != model) {
		return false
	}
	for _, m := range p.Models {
		if m == model {
			return true
		}
	}
	return false
}
func modelField(key string) bool {
	switch key {
	case "model", "small", "subagent", "opus", "sonnet", "haiku", "fable":
		return true
	}
	return false
}
func authorizeField(id, key, value string) error {
	wire := id
	if wire == "grok" {
		wire = "grokbuild"
	}
	policies.RLock()
	p, ok := policies.agents[wire]
	policies.RUnlock()
	if !ok || !p.Enabled {
		return errors.New("this agent is not enabled by BoxAI provisioning")
	}
	if key == "provider" {
		return errors.New("agent authentication is managed by BoxAI")
	}
	if modelField(key) && !policyModel(id, value) {
		return errors.New("select a model authorized for this agent by BoxAI")
	}
	return nil
}

func policyOptions(id, key string, original func(map[string]string) []Option) func(map[string]string) []Option {
	return func(cur map[string]string) []Option {
		options := original(cur)
		out := []Option{}
		for _, o := range options {
			if authorizeField(id, key, o.Value) == nil {
				out = append(out, o)
			}
		}
		return out
	}
}
