package elevenlabs

import (
	"bytes"
	"encoding/binary"
	"io"
	"mime/multipart"
	"net/http"
	"net/http/httptest"
	"testing"

	"github.com/dev-fan-sophon/boxai/common"
	"github.com/dev-fan-sophon/boxai/dto"
	relaycommon "github.com/dev-fan-sophon/boxai/relay/common"
	relayconstant "github.com/dev-fan-sophon/boxai/relay/constant"
	"github.com/dev-fan-sophon/boxai/service"
	"github.com/dev-fan-sophon/boxai/types"

	"github.com/gin-gonic/gin"
	"github.com/stretchr/testify/assert"
	"github.com/stretchr/testify/require"
)

func newElevenLabsTestContext(method, path, contentType string, body io.Reader) *gin.Context {
	recorder := httptest.NewRecorder()
	c, _ := gin.CreateTestContext(recorder)
	c.Request = httptest.NewRequest(method, path, body)
	if contentType != "" {
		c.Request.Header.Set("Content-Type", contentType)
	}
	return c
}

func oneSecondWAV() []byte {
	const sampleRate = 8000
	const dataSize = sampleRate * 2
	buffer := bytes.NewBuffer(make([]byte, 0, 44+dataSize))
	buffer.WriteString("RIFF")
	_ = binary.Write(buffer, binary.LittleEndian, uint32(36+dataSize))
	buffer.WriteString("WAVEfmt ")
	_ = binary.Write(buffer, binary.LittleEndian, uint32(16))
	_ = binary.Write(buffer, binary.LittleEndian, uint16(1))
	_ = binary.Write(buffer, binary.LittleEndian, uint16(1))
	_ = binary.Write(buffer, binary.LittleEndian, uint32(sampleRate))
	_ = binary.Write(buffer, binary.LittleEndian, uint32(sampleRate*2))
	_ = binary.Write(buffer, binary.LittleEndian, uint16(2))
	_ = binary.Write(buffer, binary.LittleEndian, uint16(16))
	buffer.WriteString("data")
	_ = binary.Write(buffer, binary.LittleEndian, uint32(dataSize))
	buffer.Write(make([]byte, dataSize))
	return buffer.Bytes()
}

func TestDefaultModelListUsesSevenPublicModels(t *testing.T) {
	require.Equal(t, []string{
		"eleven_v3", "scribe_v2", "eleven_multilingual_sts_v2",
		"eleven_text_to_sound_v2", "music_v2", "elevenlabs-audio-isolation",
		"elevenlabs-forced-alignment",
	}, DefaultModelList)
}

func TestNativeEndpointAllowlist(t *testing.T) {
	allowed := []struct {
		method string
		path   string
	}{
		{http.MethodGet, "/v1/models"},
		{http.MethodGet, "/v2/voices"},
		{http.MethodPost, "/v1/text-to-speech/voice"},
		{http.MethodPost, "/v1/text-to-speech/voice/stream/with-timestamps"},
		{http.MethodPost, "/v1/speech-to-text"},
		{http.MethodPost, "/v1/speech-to-speech/voice/stream"},
		{http.MethodPost, "/v1/sound-generation"},
		{http.MethodPost, "/v1/music/stream"},
		{http.MethodPost, "/v1/audio-isolation/stream"},
		{http.MethodPost, "/v1/forced-alignment"},
		{http.MethodPost, "/v1/text-to-dialogue/with-timestamps"},
	}
	for _, test := range allowed {
		_, ok := MatchNativeEndpoint(test.method, test.path)
		assert.True(t, ok, "%s %s", test.method, test.path)
	}

	blocked := []struct {
		method string
		path   string
	}{
		{http.MethodGet, "/v1/history"},
		{http.MethodPost, "/v1/convai/agents"},
		{http.MethodPost, "/v1/voices/add"},
		{http.MethodPost, "/v1/api-keys"},
		{http.MethodDelete, "/v1/voices/voice"},
		{http.MethodPost, "/v1/dubbing"},
	}
	for _, test := range blocked {
		_, ok := MatchNativeEndpoint(test.method, test.path)
		assert.False(t, ok, "%s %s", test.method, test.path)
	}
}

func TestBareAliasesNeverClaimOpenAIRoutes(t *testing.T) {
	for _, path := range []string{"/v1/sound-generation", "/v1/music", "/v1/audio-isolation", "/v1/forced-alignment", "/v1/speech-to-speech/voice"} {
		assert.True(t, IsBareNativeAliasPath(path), path)
	}
	for _, path := range []string{"/v1/audio/speech", "/v1/audio/transcriptions", "/v1/models", "/v1/chat/completions"} {
		assert.False(t, IsBareNativeAliasPath(path), path)
	}
}

func TestNativeModelSelectionFromJSONAndMultipart(t *testing.T) {
	endpoint, ok := MatchNativeEndpoint(http.MethodPost, "/v1/text-to-speech/voice")
	require.True(t, ok)
	jsonContext := newElevenLabsTestContext(http.MethodPost, "/elevenlabs/v1/text-to-speech/voice", "application/json", bytes.NewBufferString(`{"model_id":"eleven_v3","text":"xin chào"}`))
	modelName, err := NativeModelForRequest(jsonContext, endpoint)
	require.NoError(t, err)
	assert.Equal(t, "eleven_v3", modelName)

	endpoint, ok = MatchNativeEndpoint(http.MethodPost, "/v1/speech-to-text")
	require.True(t, ok)
	var body bytes.Buffer
	writer := multipart.NewWriter(&body)
	require.NoError(t, writer.WriteField("model_id", "scribe_v2"))
	part, err := writer.CreateFormFile("file", "one.wav")
	require.NoError(t, err)
	_, err = part.Write(oneSecondWAV())
	require.NoError(t, err)
	require.NoError(t, writer.Close())
	multipartContext := newElevenLabsTestContext(http.MethodPost, "/elevenlabs/v1/speech-to-text", writer.FormDataContentType(), &body)
	modelName, err = NativeModelForRequest(multipartContext, endpoint)
	require.NoError(t, err)
	assert.Equal(t, "scribe_v2", modelName)
	usage, err := EstimateNativeUsage(multipartContext, endpoint, modelName)
	require.NoError(t, err)
	assert.Equal(t, 17, usage.Units)
}

func TestCharacterMusicAndHeaderUsageDriveExactQuota(t *testing.T) {
	endpoint, ok := MatchNativeEndpoint(http.MethodPost, "/v1/sound-generation")
	require.True(t, ok)
	c := newElevenLabsTestContext(http.MethodPost, "/v1/sound-generation", "application/json", bytes.NewBufferString(`{"prompt":"xin chào","nested":[{"text":"世界"}]}`))
	usage, err := EstimateNativeUsage(c, endpoint, NativeSoundGenerationModel)
	require.NoError(t, err)
	assert.Equal(t, 10, usage.Units)

	info := &relaycommon.RelayInfo{
		OriginModelName: NativeSoundGenerationModel,
		PriceData:       types.PriceData{ModelRatio: 25, GroupRatioInfo: types.GroupRatioInfo{GroupRatio: 1}},
	}
	quota, err := service.CalculateAudioQuotaForUsage(info, UsageDTO(usage))
	require.NoError(t, err)
	assert.Equal(t, 250, quota)

	header := http.Header{"Character-Cost": []string{"12"}}
	corrected := UpdateUsageFromResponseHeaders(usage, header)
	quota, err = service.CalculateAudioQuotaForUsage(info, UsageDTO(corrected))
	require.NoError(t, err)
	assert.Equal(t, 300, quota, "removing response-header correction would undercharge this request")

	musicEndpoint, ok := MatchNativeEndpoint(http.MethodPost, "/v1/music")
	require.True(t, ok)
	musicContext := newElevenLabsTestContext(http.MethodPost, "/v1/music", "application/json", bytes.NewBufferString(`{"prompt":"ambient","music_length_ms":60000}`))
	musicUsage, err := EstimateNativeUsage(musicContext, musicEndpoint, NativeMusicModel)
	require.NoError(t, err)
	assert.Equal(t, 1000, musicUsage.Units)
	musicInfo := &relaycommon.RelayInfo{
		OriginModelName: NativeMusicModel,
		PriceData:       types.PriceData{ModelRatio: 50, GroupRatioInfo: types.GroupRatioInfo{GroupRatio: 1}},
	}
	quota, err = service.CalculateAudioQuotaForUsage(musicInfo, UsageDTO(musicUsage))
	require.NoError(t, err)
	assert.Equal(t, 50000, quota)
	musicUsage.Units++
	quota, err = service.CalculateAudioQuotaForUsage(musicInfo, UsageDTO(musicUsage))
	require.NoError(t, err)
	assert.Equal(t, 50050, quota, "dropping or fixing the duration multiplier would make this mutation invisible")
}

func TestMusicDurationIsBounded(t *testing.T) {
	endpoint, ok := MatchNativeEndpoint(http.MethodPost, "/v1/music")
	require.True(t, ok)
	c := newElevenLabsTestContext(http.MethodPost, "/v1/music", "application/json", bytes.NewBufferString(`{"prompt":"ambient","music_length_ms":3600001}`))
	_, err := EstimateNativeUsage(c, endpoint, NativeMusicModel)
	require.Error(t, err)
}

func TestOpenAIAudioModelAndSpeechConversionPreserveExplicitModels(t *testing.T) {
	assert.Equal(t, "tts-1", OpenAIAudioModel("tts-1", true))
	assert.Equal(t, "whisper-1", OpenAIAudioModel("whisper-1", false))
	assert.Equal(t, DefaultTTSModel, OpenAIAudioModel("", true))
	assert.Equal(t, DefaultSTTModel, OpenAIAudioModel("", false))

	c := newElevenLabsTestContext(http.MethodPost, "/v1/audio/speech", "application/json", nil)
	info := &relaycommon.RelayInfo{ChannelMeta: &relaycommon.ChannelMeta{ChannelBaseUrl: "https://api.elevenlabs.io"}}
	adaptor := &Adaptor{}
	body, err := adaptor.convertSpeechRequest(c, info, dto.AudioRequest{Model: DefaultTTSModel, Input: "xin chào", Voice: "voice-id", ResponseFormat: "wav"})
	require.NoError(t, err)
	encoded, err := io.ReadAll(body)
	require.NoError(t, err)
	var payload map[string]any
	require.NoError(t, common.Unmarshal(encoded, &payload))
	assert.Equal(t, DefaultTTSModel, payload["model_id"])
	assert.Equal(t, "xin chào", payload["text"])
	assert.Equal(t, 8, c.GetInt(contextTextCharsKey))
	info.RelayMode = relayconstant.RelayModeAudioSpeech
	requestURL, err := adaptor.GetRequestURL(info)
	require.NoError(t, err)
	assert.Contains(t, requestURL, "/v1/text-to-speech/voice-id")
	assert.Contains(t, requestURL, "output_format=wav_44100")
}

func TestNativeRequestBodyAppliesJSONAndMultipartModelMapping(t *testing.T) {
	jsonContext := newElevenLabsTestContext(http.MethodPost, "/elevenlabs/v1/text-to-speech/voice", "application/json", bytes.NewBufferString(`{"model_id":"eleven_v3","text":"hello"}`))
	body, size, err := nativeRequestBody(jsonContext, "eleven_v3", "mapped-tts")
	require.NoError(t, err)
	encoded, err := io.ReadAll(body)
	require.NoError(t, err)
	assert.Equal(t, int64(len(encoded)), size)
	var payload map[string]any
	require.NoError(t, common.Unmarshal(encoded, &payload))
	assert.Equal(t, "mapped-tts", payload["model_id"])

	var multipartBody bytes.Buffer
	writer := multipart.NewWriter(&multipartBody)
	require.NoError(t, writer.WriteField("model_id", "scribe_v2"))
	filePart, err := writer.CreateFormFile("file", "one.wav")
	require.NoError(t, err)
	_, err = filePart.Write(oneSecondWAV())
	require.NoError(t, err)
	require.NoError(t, writer.Close())
	multipartContext := newElevenLabsTestContext(http.MethodPost, "/elevenlabs/v1/speech-to-text", writer.FormDataContentType(), &multipartBody)
	body, size, err = nativeRequestBody(multipartContext, "scribe_v2", "mapped-stt")
	require.NoError(t, err)
	encoded, err = io.ReadAll(body)
	require.NoError(t, err)
	assert.Equal(t, int64(len(encoded)), size)
	replayed := httptest.NewRequest(http.MethodPost, "/v1/speech-to-text", bytes.NewReader(encoded))
	replayed.Header.Set("Content-Type", multipartContext.Request.Header.Get("Content-Type"))
	require.NoError(t, replayed.ParseMultipartForm(32<<20))
	assert.Equal(t, "mapped-stt", replayed.FormValue("model_id"))
	require.Len(t, replayed.MultipartForm.File["file"], 1)
}

func TestNativeProxyHonorsHeaderOverrides(t *testing.T) {
	var receivedKey, receivedOverride string
	upstream := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		receivedKey = r.Header.Get("xi-api-key")
		receivedOverride = r.Header.Get("x-provider-option")
		w.Header().Set("Content-Type", "application/json")
		_, _ = w.Write([]byte(`{"models":[]}`))
	}))
	t.Cleanup(upstream.Close)
	c := newElevenLabsTestContext(http.MethodGet, "/elevenlabs/v1/models", "", nil)
	info := &relaycommon.RelayInfo{
		OriginModelName: DefaultTTSModel,
		ChannelMeta: &relaycommon.ChannelMeta{
			ApiKey:            "provider-key",
			ChannelBaseUrl:    upstream.URL,
			UpstreamModelName: DefaultTTSModel,
			HeadersOverride: map[string]any{
				"x-provider-option": "enabled",
			},
		},
	}
	resp, err := NativeProxy(c, info, "/v1/models")
	require.NoError(t, err)
	service.CloseResponseBodyGracefully(resp)
	assert.Equal(t, "provider-key", receivedKey)
	assert.Equal(t, "enabled", receivedOverride)
}
