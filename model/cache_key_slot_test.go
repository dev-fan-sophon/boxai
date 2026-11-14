package model

import (
	"strings"
	"testing"

	"github.com/stretchr/testify/assert"
	"github.com/stretchr/testify/require"
)

// Sharded Redis hashes only the text inside the first brace pair, so fence
// keys tagged with the untagged cache key share its slot. Miniredis does not
// enforce slots, so check the tags explicitly.
func TestCacheFenceKeysShareClusterHashTag(t *testing.T) {
	for _, tc := range []struct {
		cacheKey string
		related  []string
	}{
		{getUserCacheKey(5), []string{getUserCacheFenceKey(5)}},
		{getTokenCacheKey("test-token"), []string{getTokenCacheFenceKey("test-token")}},
	} {
		assert.NotContains(t, tc.cacheKey, "{")
		for _, key := range tc.related {
			_, suffix, ok := strings.Cut(key, "{")
			require.True(t, ok)
			tag, _, ok := strings.Cut(suffix, "}")
			require.True(t, ok)
			assert.Equal(t, tc.cacheKey, tag)
		}
	}
}
