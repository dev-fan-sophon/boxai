package provider

import (
	"context"
	"os"
	"testing"

	"github.com/stretchr/testify/assert"
	"github.com/stretchr/testify/require"
	"github.com/yetone/magpie/internal/catalog"
)

func TestBoxAIAccountIsTheOnlyProviderAndModelAuthority(t *testing.T) {
	isolate(t)
	require.NoError(t, Save(Provider{ID: "other", Name: "Other", Key: "old-secret", Chat: "https://other.invalid/v1", Models: []string{"unauthorized"}}))
	before, err := os.ReadFile(Path())
	require.NoError(t, err)
	key := "boxai-account-secret"
	ConfigureBoxAI(func() (string, []catalog.Model) {
		return key, []catalog.Model{{ID: "vendor/allowed", Name: "Allowed", Context: 123456}}
	})
	t.Cleanup(func() { managedSession.Store(nil) })
	ps := All()
	require.Len(t, ps, 1)
	assert.Equal(t, "boxai", ps[0].ID)
	assert.Equal(t, "https://you-box.com/v1", ps[0].Responses)
	assert.Empty(t, Accounts())
	subscriptionUsageCache.Lock()
	previousUsage := subscriptionUsageCache.data
	subscriptionUsageCache.data = []SubscriptionQuota{{Provider: "claude"}}
	subscriptionUsageCache.Unlock()
	t.Cleanup(func() {
		subscriptionUsageCache.Lock()
		subscriptionUsageCache.data = previousUsage
		subscriptionUsageCache.Unlock()
	})
	assert.Empty(t, SubscriptionUsage(context.Background()), "BoxAI must not expose cached third-party subscriptions")
	assert.ErrorIs(t, Save(ps[0]), ErrManagedProvider)
	assert.ErrorIs(t, store(file{}), ErrManagedProvider)
	for _, id := range []string{"boxai/vendor/allowed", "vendor/allowed"} {
		p, model, ok := Resolve(id)
		require.True(t, ok, id)
		assert.Equal(t, "boxai", p.ID)
		assert.Equal(t, "vendor/allowed", model)
	}
	for _, id := range []string{"boxai/unauthorized", "other/unauthorized", "unauthorized"} {
		_, _, ok := Resolve(id)
		assert.False(t, ok, id)
	}
	models, err := ps[0].Fetch(context.Background())
	require.NoError(t, err)
	require.Len(t, models, 1)
	assert.Equal(t, 123456, models[0].Context)
	after, err := os.ReadFile(Path())
	require.NoError(t, err)
	assert.Equal(t, before, after, "managed cloud credentials must never be persisted to provider files")
	key = ""
	assert.Empty(t, All(), "sign-out must remove even previously cached provider access")
	assert.Empty(t, ps[0].Available())
	_, _, ok := Resolve("boxai/vendor/allowed")
	assert.False(t, ok)
}
