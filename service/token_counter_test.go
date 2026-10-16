package service

import (
	"encoding/base64"
	"testing"

	"github.com/stretchr/testify/assert"
	"github.com/stretchr/testify/require"
)

// pcm16Audio returns base64 PCM16 mono audio at 24 kHz: 2 bytes per sample,
// 48000 bytes per second of silence.
func pcm16Audio(seconds float64) string {
	return base64.StdEncoding.EncodeToString(make([]byte, int(48000*seconds)))
}

func TestCountAudioTokenInputIsIndependentOfChunkSize(t *testing.T) {
	// 100 tokens per 0.06 s of audio is 27.7778 tokens per second, so 3.5 s is
	// 97.22 tokens: 97 whole tokens no matter how the stream is cut up.
	const audioSeconds = 3.5
	const expectedTokens = 97

	audio := pcm16Audio(audioSeconds)
	raw, err := base64.StdEncoding.DecodeString(audio)
	require.NoError(t, err)

	tests := []struct {
		name       string
		chunkBytes int
	}{
		{name: "single chunk", chunkBytes: len(raw)},
		{name: "100 ms chunks", chunkBytes: 4800},
		{name: "20 ms chunks", chunkBytes: 960},
	}

	for _, tt := range tests {
		t.Run(tt.name, func(t *testing.T) {
			total := 0
			var remainder float64
			for i := 0; i < len(raw); i += tt.chunkBytes {
				end := min(i+tt.chunkBytes, len(raw))
				tokens, err := CountAudioTokenInput(
					base64.StdEncoding.EncodeToString(raw[i:end]), "pcm16", &remainder)
				require.NoError(t, err)
				total += tokens
			}

			assert.Equal(t, expectedTokens, total)
			assert.Less(t, remainder, 1.0)
		})
	}
}

func TestCountAudioTokensPerMinute(t *testing.T) {
	// The billing rates are 100 input tokens and 200 output tokens per 0.06 s and
	// 0.24 s respectively, i.e. 1666.67 input and 833.33 output tokens per minute.
	audio := pcm16Audio(60)

	inputTokens, err := CountAudioTokenInput(audio, "pcm16", nil)
	require.NoError(t, err)
	assert.Equal(t, 1666, inputTokens)

	outputTokens, err := CountAudioTokenOutput(audio, "pcm16", nil)
	require.NoError(t, err)
	assert.Equal(t, 833, outputTokens)
}
