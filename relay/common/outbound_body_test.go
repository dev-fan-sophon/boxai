package common

import (
	"io"
	"testing"

	basecommon "github.com/dev-fan-sophon/boxai/common"
	"github.com/stretchr/testify/assert"
	"github.com/stretchr/testify/require"
)

func assertIndependentReplayReaders(t *testing.T, payload []byte, body basecommon.ReplayableBody) {
	t.Helper()

	half := len(payload) / 2
	primaryHead := make([]byte, half)
	_, err := io.ReadFull(body, primaryHead)
	require.NoError(t, err)
	assert.Equal(t, payload[:half], primaryHead)

	a, err := body.NewReader()
	require.NoError(t, err)
	b, err := body.NewReader()
	require.NoError(t, err)

	aHead := make([]byte, half)
	_, err = io.ReadFull(a, aHead)
	require.NoError(t, err)
	assert.Equal(t, payload[:half], aHead)

	bAll, err := io.ReadAll(b)
	require.NoError(t, err)
	require.NoError(t, b.Close())
	assert.Equal(t, payload, bAll)

	aRest, err := io.ReadAll(a)
	require.NoError(t, err)
	require.NoError(t, a.Close())
	assert.Equal(t, payload[half:], aRest)

	primaryRest, err := io.ReadAll(body)
	require.NoError(t, err)
	assert.Equal(t, payload[half:], primaryRest)
}

func TestNewOutboundJSONBodyReplaysIndependentFullBodies(t *testing.T) {
	payload := []byte(`{"model":"test-model","input":"abcdefghijklmnopqrstuvwxyz"}`)
	body, closer, err := NewOutboundJSONBody(payload)
	require.NoError(t, err)
	defer closer.Close()

	assert.EqualValues(t, len(payload), body.Size())
	assertIndependentReplayReaders(t, payload, body)

	require.NoError(t, closer.Close())
	_, err = body.NewReader()
	require.ErrorIs(t, err, basecommon.ErrStorageClosed)
}

func TestNewOutboundJSONBodyReplaysIndependentFullBodiesFromDisk(t *testing.T) {
	previous := basecommon.GetDiskCacheConfig()
	basecommon.SetDiskCacheConfig(basecommon.DiskCacheConfig{
		Enabled:     true,
		ThresholdMB: 0,
		MaxSizeMB:   64,
		Path:        t.TempDir(),
	})
	defer basecommon.SetDiskCacheConfig(previous)

	payload := []byte(`{"model":"test-model","input":"abcdefghijklmnopqrstuvwxyz"}`)
	body, closer, err := NewOutboundJSONBody(payload)
	require.NoError(t, err)
	defer closer.Close()

	storage, ok := closer.(basecommon.BodyStorage)
	require.True(t, ok)
	assert.True(t, storage.IsDisk())
	assertIndependentReplayReaders(t, payload, body)

	require.NoError(t, closer.Close())
	_, err = body.NewReader()
	require.ErrorIs(t, err, basecommon.ErrStorageClosed)
}
