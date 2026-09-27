package update

import (
	"os"
	"path/filepath"
	"testing"

	"github.com/stretchr/testify/assert"
	"github.com/stretchr/testify/require"
)

// Run on every OS: old updater calls must never overwrite an installation.
func TestLegacyBinaryReplacementIsRejected(t *testing.T) {
	dir := t.TempDir()
	exe, staged := filepath.Join(dir, "boxai-connect.exe"), filepath.Join(dir, "setup.exe")
	require.NoError(t, os.WriteFile(exe, []byte("installed"), 0600))
	require.NoError(t, os.WriteFile(staged, []byte("unsigned setup"), 0600))
	assert.Error(t, InstallBinary(staged, exe))
	assert.Error(t, InstallBinaryAsAdmin(staged, exe))
	data, err := os.ReadFile(exe)
	require.NoError(t, err)
	assert.Equal(t, "installed", string(data))
}
