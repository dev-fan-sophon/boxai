package provider

import (
	"errors"
	"sync/atomic"

	"github.com/yetone/magpie/internal/catalog"
)

// ManagedSession supplies only the currently authenticated BoxAI account's
// credential and server-authorized catalog. Credentials never enter providers.json.
type ManagedSession func() (string, []catalog.Model)

var managedSession atomic.Pointer[ManagedSession]

var ErrManagedProvider = errors.New("BoxAI Connect providers are managed by your BoxAI account")

// ConfigureBoxAI pins the provider source for the lifetime of the application.
// There is no file, environment variable or user-facing operation to undo it.
func ConfigureBoxAI(source ManagedSession) {
	if source == nil || !managedSession.CompareAndSwap(nil, &source) {
		panic("BoxAI provider source must be configured exactly once")
	}
}

func managedProviders() []Provider {
	source := managedSession.Load()
	if source == nil {
		return nil
	}
	key, models := (*source)()
	if key == "" {
		return nil
	}
	ids := make([]string, 0, len(models))
	contexts := make(map[string]int, len(models))
	for _, model := range models {
		ids = append(ids, model.ID)
		contexts[model.ID] = model.Context
	}
	return []Provider{{ID: "boxai", Name: "BoxAI", Icon: "boxai", Key: key,
		Chat: "https://you-box.com/v1", Responses: "https://you-box.com/v1",
		Anthropic: "https://you-box.com", Website: "https://you-box.com",
		Models: ids, Contexts: contexts}}
}
