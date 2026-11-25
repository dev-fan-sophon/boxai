package minimax

import (
	"encoding/hex"
	"io"
	"net/http"
	"net/http/httptest"
	"strings"
	"testing"

	"github.com/dev-fan-sophon/boxai/common"
	"github.com/dev-fan-sophon/boxai/dto"
	relaycommon "github.com/dev-fan-sophon/boxai/relay/common"
	relayconstant "github.com/dev-fan-sophon/boxai/relay/constant"
	"github.com/gin-gonic/gin"
	"github.com/stretchr/testify/assert"
	"github.com/stretchr/testify/require"
)

func TestConvertAudioRequestCodecAndMapping(t *testing.T) {
	for _, tt := range []struct {
		name, format, metadata, wantCodec, wantTransport string
	}{
		{"default mp3", "", "", "mp3", "hex"},
		{"explicit mp3", "mp3", "", "mp3", "hex"},
		{"wav", "wav", "", "wav", "hex"},
		{"flac", "flac", "", "flac", "hex"},
		{"native url", "mp3", `{"output_format":"url"}`, "mp3", "url"},
		{"metadata cannot replace mapped model", "mp3", `{"model":"unrouted-model"}`, "mp3", "hex"},
		{"native codec", "mp3", `{"audio_setting":{"format":"wav","sample_rate":32000}}`, "wav", "hex"},
		{"null native settings", "mp3", `{"audio_setting":null,"output_format":""}`, "mp3", "hex"},
	} {
		t.Run(tt.name, func(t *testing.T) {
			c, _ := gin.CreateTestContext(httptest.NewRecorder())
			info := &relaycommon.RelayInfo{
				RelayMode: relayconstant.RelayModeAudioSpeech, OriginModelName: "public-speech",
				ChannelMeta: &relaycommon.ChannelMeta{UpstreamModelName: "speech-2.8-turbo"},
			}
			request := dto.AudioRequest{
				Model: "speech-2.8-turbo", Input: "Welcome to Box AI.", Voice: "male-qn-qingse",
				ResponseFormat: tt.format, Metadata: []byte(tt.metadata),
			}
			body, err := (&Adaptor{}).ConvertAudioRequest(c, info, request)
			require.NoError(t, err)
			var payload MiniMaxTTSRequest
			require.NoError(t, common.DecodeJson(body, &payload))
			assert.Equal(t, "speech-2.8-turbo", payload.Model)
			assert.Equal(t, request.Input, payload.Text)
			assert.Equal(t, request.Voice, payload.VoiceSetting.VoiceID)
			require.NotNil(t, payload.AudioSetting)
			assert.Equal(t, tt.wantCodec, payload.AudioSetting.Format)
			assert.Equal(t, tt.wantTransport, payload.OutputFormat)
			assert.False(t, payload.Stream)
		})
	}
}

func TestConvertAudioRequestRejectsUnsupportedSpeech(t *testing.T) {
	for _, tt := range []struct {
		name, metadata, streamFormat, wantError string
		isStream                                bool
	}{
		{name: "native SSE", metadata: `{"stream":true}`, wantError: "streaming speech"},
		{name: "OpenAI SSE", streamFormat: "sse", wantError: "streaming speech"},
		{name: "metadata cannot bypass SSE", metadata: `{"stream":false}`, isStream: true, wantError: "streaming speech"},
		{name: "invalid transport", metadata: `{"output_format":"mp3"}`, wantError: "output_format must be hex or url"},
	} {
		t.Run(tt.name, func(t *testing.T) {
			c, _ := gin.CreateTestContext(httptest.NewRecorder())
			info := &relaycommon.RelayInfo{RelayMode: relayconstant.RelayModeAudioSpeech, IsStream: tt.isStream,
				ChannelMeta: &relaycommon.ChannelMeta{UpstreamModelName: "speech-2.8-turbo"}}
			body, err := (&Adaptor{}).ConvertAudioRequest(c, info, dto.AudioRequest{
				Model: "speech-2.8-turbo", Input: "hello", Voice: "male-qn-qingse",
				StreamFormat: tt.streamFormat, Metadata: []byte(tt.metadata),
			})
			require.ErrorContains(t, err, tt.wantError)
			assert.Nil(t, body)
		})
	}
}

func TestAudioResponseCodecAndUpstreamCharacters(t *testing.T) {
	// A mono PCM WAV containing one silent 16-bit sample.
	wav, err := hex.DecodeString("524946462600000057415645666d74201000000001000100401f0000803e00000200100064617461020000000000")
	require.NoError(t, err)
	for _, tt := range []struct {
		codec, contentType string
		audio              []byte
	}{
		{"mp3", "audio/mpeg", []byte{0xff, 0xfb, 0x90, 0x00}},
		{"wav", "audio/wav", wav},
		{"flac", "audio/flac", []byte("fLaC\x00\x00")},
		{"pcm", "audio/pcm", []byte{0, 0, 1, 0}},
	} {
		t.Run(tt.codec, func(t *testing.T) {
			recorder := httptest.NewRecorder()
			c, _ := gin.CreateTestContext(recorder)
			info := &relaycommon.RelayInfo{RelayMode: relayconstant.RelayModeAudioSpeech,
				ChannelMeta: &relaycommon.ChannelMeta{UpstreamModelName: "speech-2.8-turbo"}}
			info.SetEstimatePromptTokens(7)
			_, err := (&Adaptor{}).ConvertAudioRequest(c, info, dto.AudioRequest{
				Model: "speech-2.8-turbo", Input: "hello", Voice: "male-qn-qingse", ResponseFormat: tt.codec,
			})
			require.NoError(t, err)
			responseJSON, err := common.Marshal(MiniMaxTTSResponse{
				Data:      MiniMaxTTSData{Audio: hex.EncodeToString(tt.audio), Status: 2},
				ExtraInfo: MiniMaxExtraInfo{UsageCharacters: 23},
			})
			require.NoError(t, err)
			usage, apiErr := (&Adaptor{}).DoResponse(c, &http.Response{
				StatusCode: http.StatusOK, Header: http.Header{"Content-Type": {"application/json"}},
				Body: io.NopCloser(strings.NewReader(string(responseJSON))),
			}, info)
			require.Nil(t, apiErr)
			assert.Equal(t, http.StatusOK, recorder.Code)
			assert.Equal(t, tt.contentType, recorder.Header().Get("Content-Type"))
			assert.Equal(t, tt.audio, recorder.Body.Bytes())
			require.IsType(t, &dto.Usage{}, usage)
			audioUsage := usage.(*dto.Usage)
			assert.Equal(t, 23, audioUsage.PromptTokens)
			assert.Equal(t, 23, audioUsage.TotalTokens)
			assert.Equal(t, 23, audioUsage.PromptTokensDetails.TextTokens)
			assert.Zero(t, audioUsage.CompletionTokens)
		})
	}
}

func TestAudioResponseUsageBoundsAndSSE(t *testing.T) {
	for _, tt := range []struct {
		name, contentType, body string
		wantError, wantClamp    bool
		wantCharacters          int
	}{
		{name: "unexpected SSE", contentType: "text/event-stream; charset=utf-8", body: "data: {}\n\n", wantError: true},
		{name: "negative usage", contentType: "application/json", body: `{"data":{"audio":"0000"},"extra_info":{"usage_characters":-1}}`, wantError: true},
		{name: "zero usage is not estimate", contentType: "application/json", body: `{"data":{"audio":"0000"},"extra_info":{"usage_characters":0}}`},
		{name: "oversized usage saturates", contentType: "application/json", body: `{"data":{"audio":"0000"},"extra_info":{"usage_characters":9223372036854775807}}`, wantClamp: true, wantCharacters: common.MaxQuota},
	} {
		t.Run(tt.name, func(t *testing.T) {
			recorder := httptest.NewRecorder()
			c, _ := gin.CreateTestContext(recorder)
			info := &relaycommon.RelayInfo{RelayMode: relayconstant.RelayModeAudioSpeech}
			info.SetEstimatePromptTokens(7)
			usage, apiErr := (&Adaptor{}).DoResponse(c, &http.Response{
				StatusCode: http.StatusOK, Header: http.Header{"Content-Type": {tt.contentType}},
				Body: io.NopCloser(strings.NewReader(tt.body)),
			}, info)
			if tt.wantError {
				require.NotNil(t, apiErr)
				assert.Nil(t, usage)
				assert.Empty(t, recorder.Body.Bytes(), "errors must not leak SSE or invalid audio")
				return
			}
			require.Nil(t, apiErr)
			require.IsType(t, &dto.Usage{}, usage)
			assert.Equal(t, tt.wantCharacters, usage.(*dto.Usage).PromptTokens)
			assert.Equal(t, tt.wantCharacters, usage.(*dto.Usage).TotalTokens)
			assert.Equal(t, tt.wantClamp, info.QuotaClamp != nil)
		})
	}
}
