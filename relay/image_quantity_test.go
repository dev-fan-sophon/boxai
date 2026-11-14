package relay

import (
	"testing"

	"github.com/stretchr/testify/assert"
	"github.com/stretchr/testify/require"
)

// Channel parameter overrides change what is actually submitted, so the
// billed quantity is re-read from the outbound body and bounded again.
func TestOutboundImageQuantity(t *testing.T) {
	for _, tc := range []struct {
		name         string
		body         string
		count        int
		ali          bool
		wantCount    int
		wantExtend   bool
		wantRejected bool
	}{
		{name: "no quantity keeps validated count", body: `{"model":"m"}`, count: 3, wantCount: 3},
		{name: "override raises top-level n", body: `{"n":5}`, count: 2, wantCount: 5},
		{name: "top-level zero keeps legacy default", body: `{"n":0}`, count: 2, wantCount: 1},
		{name: "Ali provider count wins", body: `{"n":2,"parameters":{"n":6,"prompt_extend":true}}`, count: 2, ali: true, wantCount: 6, wantExtend: true},
		{name: "non-Ali ignores provider count", body: `{"n":2,"parameters":{"n":6}}`, count: 2, wantCount: 2},
		{name: "Ali explicit zero rejected", body: `{"parameters":{"n":0}}`, count: 2, ali: true, wantRejected: true},
		{name: "huge n rejected", body: `{"n":18446744073686646784}`, count: 2, wantRejected: true},
		{name: "fractional n rejected", body: `{"n":1.5}`, count: 2, wantRejected: true},
		{name: "negative provider n rejected", body: `{"parameters":{"n":-1}}`, count: 2, ali: true, wantRejected: true},
		{name: "non-numeric n is provider-specific", body: `{"n":"auto"}`, count: 2, wantCount: 2},
	} {
		t.Run(tc.name, func(t *testing.T) {
			count, extend, err := outboundImageQuantity([]byte(tc.body), tc.count, false, tc.ali)
			if tc.wantRejected {
				require.Error(t, err)
				return
			}
			require.NoError(t, err)
			assert.Equal(t, tc.wantCount, count)
			assert.Equal(t, tc.wantExtend, extend)
		})
	}
}
