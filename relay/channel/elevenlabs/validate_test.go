package elevenlabs

import (
	"bytes"
	"errors"
	"io"
	"net/http"
	"strings"
	"testing"

	"github.com/dev-fan-sophon/boxai/common"
	"github.com/dev-fan-sophon/boxai/dto"
	relaycommon "github.com/dev-fan-sophon/boxai/relay/common"
	"github.com/dev-fan-sophon/boxai/service"
	"github.com/dev-fan-sophon/boxai/types"

	"github.com/stretchr/testify/assert"
	"github.com/stretchr/testify/require"
)

func TestPlaygroundProxyPathUsesNativeAllowlist(t *testing.T) {
	tests := []struct {
		path     string
		native   bool
		upstream string
	}{
		{"/pg/elevenlabs/v1/text-to-speech/abc", true, "/v1/text-to-speech/abc"},
		{"/pg/elevenlabs/v2/voices", true, "/v2/voices"},
		{"/pg/elevenlabs/v1/speech-to-text", true, "/v1/speech-to-text"},
		{"/elevenlabs/v1/music", true, "/v1/music"},
		{"/pg/audio/speech", false, "/pg/audio/speech"},
		{"/pg/elevenlabsx/v1/music", false, "/pg/elevenlabsx/v1/music"},
	}
	for _, test := range tests {
		assert.Equal(t, test.native, IsNativeProxyPath(test.path), test.path)
		assert.Equal(t, test.upstream, UpstreamPathFromProxyPath(test.path), test.path)
	}

	// The playground prefix must not widen the allow-list.
	_, ok := MatchNativeEndpoint(http.MethodPost, UpstreamPathFromProxyPath("/pg/elevenlabs/v1/history"))
	assert.False(t, ok)
	_, ok = MatchNativeEndpoint(http.MethodDelete, UpstreamPathFromProxyPath("/pg/elevenlabs/v1/voices/abc"))
	assert.False(t, ok)
}

func TestValidateNativeRequestBounds(t *testing.T) {
	tests := []struct {
		name  string
		path  string
		model string
		body  string
		valid bool
	}{
		{"v3 text at limit", "/v1/text-to-speech/v", "eleven_v3", `{"text":"` + strings.Repeat("a", 5000) + `"}`, true},
		{"v3 text over limit", "/v1/text-to-speech/v", "eleven_v3", `{"text":"` + strings.Repeat("a", 5001) + `"}`, false},
		{"body model_id decides limit", "/v1/text-to-speech/v", "eleven_flash_v2_5", `{"model_id":"eleven_v3","text":"` + strings.Repeat("a", 5001) + `"}`, false},
		{"empty text", "/v1/text-to-speech/v", "eleven_v3", `{"text":"  "}`, false},
		{"speed in range", "/v1/text-to-speech/v", "eleven_v3", `{"text":"hi","voice_settings":{"speed":0.7,"stability":0,"style":1}}`, true},
		{"speed too slow", "/v1/text-to-speech/v", "eleven_v3", `{"text":"hi","voice_settings":{"speed":0.69}}`, false},
		{"speed too fast", "/v1/text-to-speech/v", "eleven_v3", `{"text":"hi","voice_settings":{"speed":1.21}}`, false},
		{"similarity out of range", "/v1/text-to-speech/v", "eleven_v3", `{"text":"hi","voice_settings":{"similarity_boost":1.5}}`, false},
		{"seed negative", "/v1/text-to-speech/v", "eleven_v3", `{"text":"hi","seed":-1}`, false},
		{"seed max", "/v1/text-to-speech/v", "eleven_v3", `{"text":"hi","seed":4294967295}`, true},
		{"sfx auto duration", "/v1/sound-generation", NativeSoundGenerationModel, `{"text":"rain","duration_seconds":null}`, true},
		{"sfx min duration", "/v1/sound-generation", NativeSoundGenerationModel, `{"text":"rain","duration_seconds":0.5}`, true},
		{"sfx too short", "/v1/sound-generation", NativeSoundGenerationModel, `{"text":"rain","duration_seconds":0.4}`, false},
		{"sfx too long", "/v1/sound-generation", NativeSoundGenerationModel, `{"text":"rain","duration_seconds":30.1}`, false},
		{"sfx influence", "/v1/sound-generation", NativeSoundGenerationModel, `{"text":"rain","prompt_influence":1.1}`, false},
		{"music min", "/v1/music", NativeMusicModel, `{"prompt":"lofi","music_length_ms":3000}`, true},
		{"music too short", "/v1/music", NativeMusicModel, `{"prompt":"lofi","music_length_ms":2999}`, false},
		{"music max", "/v1/music", NativeMusicModel, `{"prompt":"lofi","music_length_ms":600000}`, true},
		{"music too long", "/v1/music", NativeMusicModel, `{"prompt":"lofi","music_length_ms":600001}`, false},
		{"music plan section too long", "/v1/music", NativeMusicModel, `{"composition_plan":{"sections":[{"duration_ms":120001}]}}`, false},
		{"music plan total too long", "/v1/music", NativeMusicModel, `{"composition_plan":{"chunks":[` + strings.TrimSuffix(strings.Repeat(`{"duration_ms":120000},`, 6), ",") + `]}}`, false},
		{"stt is not body-validated", "/v1/speech-to-text", DefaultSTTModel, ``, true},
	}
	for _, test := range tests {
		t.Run(test.name, func(t *testing.T) {
			endpoint, ok := MatchNativeEndpoint(http.MethodPost, test.path)
			require.True(t, ok)
			c := newElevenLabsTestContext(http.MethodPost, "/pg/elevenlabs"+test.path, "application/json", bytes.NewBufferString(test.body))
			err := ValidateNativeRequest(c, endpoint, test.model)
			if test.valid {
				assert.NoError(t, err)
			} else {
				assert.Error(t, err)
			}
		})
	}
}

func TestMusicCompositionPlanBillsSummedSectionDuration(t *testing.T) {
	endpoint, ok := MatchNativeEndpoint(http.MethodPost, "/v1/music")
	require.True(t, ok)
	tests := []struct {
		name  string
		body  string
		units int
	}{
		{"v1 sections", `{"composition_plan":{"sections":[{"duration_ms":30000},{"duration_ms":30000}]}}`, 1000},
		{"v2 chunks", `{"model_id":"music_v2","composition_plan":{"chunks":[{"duration_ms":90000},{"duration_ms":30000}]}}`, 2000},
		{"plan beats music_length_ms", `{"music_length_ms":3000,"composition_plan":{"sections":[{"duration_ms":60000}]}}`, 1000},
		{"default length", `{"prompt":"lofi"}`, 500},
	}
	info := &relaycommon.RelayInfo{
		OriginModelName: NativeMusicModel,
		PriceData:       types.PriceData{ModelRatio: 50, GroupRatioInfo: types.GroupRatioInfo{GroupRatio: 1}},
	}
	for _, test := range tests {
		t.Run(test.name, func(t *testing.T) {
			c := newElevenLabsTestContext(http.MethodPost, "/pg/elevenlabs/v1/music", "application/json", bytes.NewBufferString(test.body))
			usage, err := EstimateNativeUsage(c, endpoint, NativeMusicModel)
			require.NoError(t, err)
			assert.Equal(t, test.units, usage.Units)
			quota, err := service.CalculateAudioQuotaForUsage(info, UsageDTO(usage))
			require.NoError(t, err)
			assert.Equal(t, test.units*50, quota)
		})
	}
}

func TestResolveSpeechVoiceID(t *testing.T) {
	tests := []struct {
		voice string
		want  string
	}{
		{"alloy", "SAz9YHcvj6GT2YYXdXww"},
		{" Nova ", "FGY2WhTYpPnrIDTdsKH5"},
		{"JBFqnCBsd6RMkjVDRZzb", "JBFqnCBsd6RMkjVDRZzb"},
		{"", ""},
		{"my voice", ""},
		{"../v1/history", ""},
	}
	for _, test := range tests {
		got, err := ResolveSpeechVoiceID(test.voice)
		if test.want == "" {
			require.Error(t, err, test.voice)
			var apiErr *types.NewAPIError
			require.True(t, errors.As(err, &apiErr), test.voice)
			assert.Equal(t, http.StatusBadRequest, apiErr.StatusCode, test.voice)
			continue
		}
		require.NoError(t, err, test.voice)
		assert.Equal(t, test.want, got)
	}
}

func TestOpenAICompatibleSpeechRejectsOverlongInputAndClampsSpeed(t *testing.T) {
	info := &relaycommon.RelayInfo{ChannelMeta: &relaycommon.ChannelMeta{}}
	c := newElevenLabsTestContext(http.MethodPost, "/v1/audio/speech", "application/json", nil)
	_, err := (&Adaptor{}).convertSpeechRequest(c, info, dto.AudioRequest{Model: DefaultTTSModel, Input: strings.Repeat("a", 5001), Voice: "alloy"})
	var apiErr *types.NewAPIError
	require.True(t, errors.As(err, &apiErr))
	assert.Equal(t, http.StatusBadRequest, apiErr.StatusCode)

	speed := 2.0
	body, err := (&Adaptor{}).convertSpeechRequest(c, info, dto.AudioRequest{Model: DefaultTTSModel, Input: "xin chào", Voice: "alloy", Speed: &speed})
	require.NoError(t, err)
	encoded, err := io.ReadAll(body)
	require.NoError(t, err)
	var payload struct {
		VoiceSettings struct {
			Speed float64 `json:"speed"`
		} `json:"voice_settings"`
	}
	require.NoError(t, common.Unmarshal(encoded, &payload))
	assert.Equal(t, MaxTTSSpeed, payload.VoiceSettings.Speed)
}
