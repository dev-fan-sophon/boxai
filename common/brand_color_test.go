package common

import (
	"testing"

	"github.com/stretchr/testify/assert"
	"github.com/stretchr/testify/require"
)

func TestIsAccessibleBrandPrimaryForLight(t *testing.T) {
	t.Parallel()

	assert.True(t, IsAccessibleBrandPrimaryForLight("#2563EB"))
	assert.True(t, IsAccessibleBrandPrimaryForLight("#E05A3A"))
	assert.True(t, IsAccessibleBrandPrimaryForLight("#D97706"))
	assert.False(t, IsAccessibleBrandPrimaryForLight("#22D3EE"))
	assert.False(t, IsAccessibleBrandPrimaryForLight("#FFFFFF"))
	assert.False(t, IsAccessibleBrandPrimaryForLight("#12345G"))
}

func TestIsAccessibleBrandPrimaryForDark(t *testing.T) {
	t.Parallel()

	assert.True(t, IsAccessibleBrandPrimaryForDark("#E05A3A"))
	assert.True(t, IsAccessibleBrandPrimaryForDark("#FF9072"))
	assert.True(t, IsAccessibleBrandPrimaryForDark("#22D3EE")) // bright ok on dark
	assert.False(t, IsAccessibleBrandPrimaryForDark("#000000"))
	assert.False(t, IsAccessibleBrandPrimaryForDark("#0B1633"))
}

func TestDeriveDarkBrandPrimarySoftensHotCoral(t *testing.T) {
	t.Parallel()

	dark := DeriveDarkBrandPrimary("#E05A3A")
	require.True(t, IsAccessibleBrandPrimaryForDark(dark))
	// Derived fill should be lighter than the seed (higher relative luminance).
	assert.Greater(t, BrandColorRelativeLuminance(dark), BrandColorRelativeLuminance("#E05A3A"))
	// And should not collapse to the seed.
	assert.NotEqual(t, "#E05A3A", dark)
}

func TestEffectiveDarkBrandPrimaryOverride(t *testing.T) {
	t.Parallel()

	assert.Equal(t, "#FF9072", EffectiveDarkBrandPrimary("#E05A3A", "#FF9072"))
	// Invalid override falls back to derive.
	assert.Equal(t, DeriveDarkBrandPrimary("#E05A3A"), EffectiveDarkBrandPrimary("#E05A3A", "nope"))
}

func TestBrandPrimaryForeground(t *testing.T) {
	t.Parallel()

	assert.Equal(t, "#ffffff", BrandPrimaryForeground("#2563EB"))
	assert.Equal(t, BrandDarkForeground, BrandPrimaryForeground("#D97706"))
}
