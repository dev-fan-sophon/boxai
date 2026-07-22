package storage

import (
	"testing"

	"github.com/stretchr/testify/assert"
	"github.com/stretchr/testify/require"
)

func TestR2PublicURL(t *testing.T) {
	s := &r2Store{bucket: "boxai-playground", publicBase: "https://assets.you-box.com"}

	url, ok := s.PublicURL("public/42/a.png")
	require.True(t, ok)
	assert.Equal(t, "https://assets.you-box.com/public/42/a.png", url)

	url, ok = s.PublicURL("inspiration/hero/cover.webp")
	require.True(t, ok)
	assert.Equal(t, "https://assets.you-box.com/inspiration/hero/cover.webp", url)

	_, ok = s.PublicURL("uploads/42/a.png")
	assert.False(t, ok, "private prefixes are not public")

	_, ok = s.PublicURL("../etc/passwd")
	assert.False(t, ok, "invalid keys are not public")
}

func TestR2PublicURLWithoutBase(t *testing.T) {
	s := &r2Store{bucket: "boxai-playground"}
	_, ok := s.PublicURL("public/42/a.png")
	assert.False(t, ok)
}

func TestNewR2StoreRequiresConfig(t *testing.T) {
	t.Setenv("R2_ENDPOINT", "")
	t.Setenv("R2_BUCKET", "")
	t.Setenv("R2_ACCESS_KEY_ID", "")
	t.Setenv("R2_SECRET_ACCESS_KEY", "")
	_, err := newR2Store()
	assert.Error(t, err)
}
