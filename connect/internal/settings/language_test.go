package settings

import (
	"os"
	"testing"

	"github.com/stretchr/testify/assert"
	"github.com/stretchr/testify/require"
)

func TestLanguagePersistenceAndLegacyFallback(t *testing.T) {
	t.Setenv("XDG_CONFIG_HOME", t.TempDir())
	for _, lang := range []string{"en", "vi", "system"} {
		require.NoError(t, Save(Settings{Lang: lang}))
		assert.Equal(t, lang, Load().Lang)
	}
	require.NoError(t, os.WriteFile(Path(), []byte(`{"lang":"zh","theme":"dark"}`), 0600))
	assert.Equal(t, "en", Load().Lang)
	assert.Equal(t, "dark", Load().Theme)
	assert.Error(t, Save(Settings{Lang: "fr"}))
}
