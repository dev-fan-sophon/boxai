package elevenlabs

import (
	"bytes"
	"errors"
	"fmt"
	"io"
	"math"
	"mime/multipart"
	"net/http"
	"net/url"
	"path/filepath"
	"strconv"
	"strings"
	"unicode/utf8"

	"github.com/dev-fan-sophon/boxai/common"
	"github.com/dev-fan-sophon/boxai/constant"
	"github.com/dev-fan-sophon/boxai/dto"
	"github.com/dev-fan-sophon/boxai/logger"
	"github.com/dev-fan-sophon/boxai/relay/channel"
	relaycommon "github.com/dev-fan-sophon/boxai/relay/common"
	relayhelper "github.com/dev-fan-sophon/boxai/relay/helper"
	"github.com/dev-fan-sophon/boxai/service"
	"github.com/dev-fan-sophon/boxai/setting/ratio_setting"
	"github.com/dev-fan-sophon/boxai/types"

	"github.com/gin-gonic/gin"
	"github.com/tidwall/gjson"
)

const (
	NativeSoundGenerationModel = "eleven_text_to_sound_v2"
	NativeMusicModel           = "music_v2"
	NativeAudioIsolationModel  = "elevenlabs-audio-isolation"
	NativeForcedAlignmentModel = "elevenlabs-forced-alignment"
	DefaultTTSModel            = "eleven_v3"
	DefaultSTTModel            = "scribe_v2"
	DefaultSpeechToSpeechModel = "eleven_multilingual_sts_v2"
)

const (
	BillingNone = iota
	BillingCharacters
	BillingAudioUnits
	BillingMusicDuration
)

const defaultMusicDurationSeconds = 30

type NativeEndpoint struct {
	Name         string
	BillingKind  int
	DefaultModel string
	Stream       bool
}

type NativeUsage struct {
	ModelName    string
	BillingKind  int
	Units        int
	UnitName     string
	ExtraContent string
}

var DefaultModelList = []string{
	DefaultTTSModel,
	DefaultSTTModel,
	DefaultSpeechToSpeechModel,
	NativeSoundGenerationModel,
	NativeMusicModel,
	NativeAudioIsolationModel,
	NativeForcedAlignmentModel,
}

func IsNativeProxyPath(path string) bool {
	return strings.HasPrefix(path, "/elevenlabs/") || IsBareNativeAliasPath(path)
}

func IsBareNativeAliasPath(path string) bool {
	clean := normalizeNativePath(path)
	switch clean {
	case "/v1/sound-generation", "/v1/music", "/v1/music/stream",
		"/v1/audio-isolation", "/v1/audio-isolation/stream", "/v1/forced-alignment":
		return true
	default:
		return strings.HasPrefix(clean, "/v1/speech-to-speech/")
	}
}

func UpstreamPathFromProxyPath(path string) string {
	if strings.HasPrefix(path, "/elevenlabs") {
		path = strings.TrimPrefix(path, "/elevenlabs")
		if path == "" {
			return "/"
		}
	}
	return path
}

func MatchNativeEndpoint(method, upstreamPath string) (*NativeEndpoint, bool) {
	method = strings.ToUpper(method)
	cleanPath := normalizeNativePath(upstreamPath)
	segments := splitPathSegments(cleanPath)
	if len(segments) == 0 || (segments[0] != "v1" && segments[0] != "v2") || isBlockedNativePath(segments) {
		return nil, false
	}
	if method == http.MethodGet {
		if cleanPath == "/v1/models" {
			return &NativeEndpoint{Name: "models", BillingKind: BillingNone, DefaultModel: DefaultTTSModel}, true
		}
		if isReadOnlyVoicePath(segments) {
			return &NativeEndpoint{Name: "voices", BillingKind: BillingNone, DefaultModel: DefaultTTSModel}, true
		}
		return nil, false
	}
	if method != http.MethodPost {
		return nil, false
	}
	if len(segments) >= 3 && segments[0] == "v1" && segments[1] == "text-to-speech" {
		switch {
		case len(segments) == 3:
			return &NativeEndpoint{Name: "text-to-speech", BillingKind: BillingCharacters, DefaultModel: DefaultTTSModel}, true
		case len(segments) == 4 && (segments[3] == "stream" || segments[3] == "with-timestamps"):
			return &NativeEndpoint{Name: "text-to-speech", BillingKind: BillingCharacters, DefaultModel: DefaultTTSModel, Stream: segments[3] == "stream"}, true
		case len(segments) == 5 && segments[3] == "stream" && segments[4] == "with-timestamps":
			return &NativeEndpoint{Name: "text-to-speech", BillingKind: BillingCharacters, DefaultModel: DefaultTTSModel, Stream: true}, true
		default:
			return nil, false
		}
	}
	if segments[0] != "v1" || len(segments) < 2 {
		return nil, false
	}
	switch segments[1] {
	case "speech-to-text":
		if len(segments) == 2 {
			return &NativeEndpoint{Name: "speech-to-text", BillingKind: BillingAudioUnits, DefaultModel: DefaultSTTModel}, true
		}
	case "speech-to-speech":
		if len(segments) == 3 || (len(segments) == 4 && segments[3] == "stream") {
			return &NativeEndpoint{Name: "speech-to-speech", BillingKind: BillingAudioUnits, DefaultModel: DefaultSpeechToSpeechModel, Stream: len(segments) == 4}, true
		}
	case "audio-isolation":
		if len(segments) == 2 || (len(segments) == 3 && segments[2] == "stream") {
			return &NativeEndpoint{Name: "audio-isolation", BillingKind: BillingAudioUnits, DefaultModel: NativeAudioIsolationModel, Stream: len(segments) == 3}, true
		}
	case "forced-alignment":
		if len(segments) == 2 {
			return &NativeEndpoint{Name: "forced-alignment", BillingKind: BillingAudioUnits, DefaultModel: NativeForcedAlignmentModel}, true
		}
	case "sound-generation":
		if len(segments) == 2 {
			return &NativeEndpoint{Name: "sound-generation", BillingKind: BillingCharacters, DefaultModel: NativeSoundGenerationModel}, true
		}
	case "music":
		if len(segments) == 2 || (len(segments) == 3 && segments[2] == "stream") {
			return &NativeEndpoint{Name: "music", BillingKind: BillingMusicDuration, DefaultModel: NativeMusicModel, Stream: len(segments) == 3}, true
		}
	case "text-to-dialogue":
		if len(segments) == 2 || (len(segments) == 3 && (segments[2] == "stream" || segments[2] == "with-timestamps")) ||
			(len(segments) == 4 && segments[2] == "stream" && segments[3] == "with-timestamps") {
			return &NativeEndpoint{Name: "text-to-dialogue", BillingKind: BillingCharacters, DefaultModel: DefaultTTSModel, Stream: segments[len(segments)-1] == "stream" || (len(segments) == 4 && segments[2] == "stream")}, true
		}
	}
	return nil, false
}

func NativeModelForRequest(c *gin.Context, endpoint *NativeEndpoint) (string, error) {
	if endpoint == nil {
		return "", errors.New("ElevenLabs endpoint is required")
	}
	if endpoint.BillingKind == BillingNone {
		return endpoint.DefaultModel, nil
	}
	if endpoint.BillingKind == BillingAudioUnits && isMultipartRequest(c) {
		modelID, err := formField(c, "model_id", "model")
		if err != nil {
			return "", err
		}
		if modelID != "" {
			return modelID, nil
		}
		return endpoint.DefaultModel, nil
	}
	if isJSONRequest(c) {
		body, err := requestBodyBytes(c)
		if err != nil {
			return "", err
		}
		for _, key := range []string{"model_id", "model"} {
			if value := strings.TrimSpace(gjson.GetBytes(body, key).String()); value != "" {
				return value, nil
			}
		}
	}
	return endpoint.DefaultModel, nil
}

func EstimateNativeUsage(c *gin.Context, endpoint *NativeEndpoint, modelName string) (NativeUsage, error) {
	usage := NativeUsage{ModelName: modelName, BillingKind: endpoint.BillingKind}
	switch endpoint.BillingKind {
	case BillingNone:
		usage.UnitName = "none"
		return usage, nil
	case BillingCharacters:
		chars, err := estimateCharacterUnits(c)
		if err != nil {
			return usage, err
		}
		usage.Units, usage.UnitName = chars, "characters"
		usage.ExtraContent = fmt.Sprintf("ElevenLabs %s, characters %d", endpoint.Name, chars)
		return usage, nil
	case BillingAudioUnits:
		duration, err := estimateAudioDuration(c)
		if err != nil {
			return usage, err
		}
		units, err := durationToAudioUnits(duration)
		if err != nil {
			return usage, err
		}
		usage.Units, usage.UnitName = units, "audio_units"
		usage.ExtraContent = fmt.Sprintf("ElevenLabs %s, audio duration %.2fs, units %d", endpoint.Name, duration, units)
		return usage, nil
	case BillingMusicDuration:
		duration, err := estimateMusicDuration(c)
		if err != nil {
			return usage, err
		}
		units, err := durationToAudioUnits(duration)
		if err != nil {
			return usage, err
		}
		usage.Units, usage.UnitName = units, "audio_units"
		usage.ExtraContent = fmt.Sprintf("ElevenLabs %s, requested duration %.2fs, units %d", endpoint.Name, duration, units)
		return usage, nil
	default:
		return usage, fmt.Errorf("unsupported ElevenLabs billing kind: %d", endpoint.BillingKind)
	}
}

func UpdateUsageFromResponseHeaders(usage NativeUsage, header http.Header) NativeUsage {
	if usage.BillingKind != BillingCharacters {
		return usage
	}
	corrected := correctedCharacterCost(usage.Units, header)
	if corrected != usage.Units {
		usage.Units = corrected
		usage.ExtraContent += fmt.Sprintf(", upstream character-cost %d", corrected)
	}
	return usage
}

func correctedCharacterCost(estimated int, header http.Header) int {
	value, err := strconv.Atoi(strings.TrimSpace(header.Get("character-cost")))
	if err != nil || value <= 0 {
		return estimated
	}
	return value
}

func NativePriceData(c *gin.Context, info *relaycommon.RelayInfo) (types.PriceData, error) {
	groupRatioInfo := relayhelper.HandleGroupRatio(c, info)
	modelRatio, success, matchName := ratio_setting.GetModelRatio(info.OriginModelName)
	if !success && !info.UserSetting.AcceptUnsetRatioModel {
		return types.PriceData{}, fmt.Errorf("model %s price is not configured", matchName)
	}
	priceData := types.PriceData{
		ModelRatio:           modelRatio,
		GroupRatioInfo:       groupRatioInfo,
		AudioRatio:           ratio_setting.GetAudioRatio(info.OriginModelName),
		AudioCompletionRatio: ratio_setting.GetAudioCompletionRatio(info.OriginModelName),
		FreeModel:            modelRatio == 0 || groupRatioInfo.GroupRatio == 0,
	}
	info.PriceData = priceData
	return priceData, nil
}

func UsageDTO(usage NativeUsage) *dto.Usage {
	result := &dto.Usage{}
	switch usage.BillingKind {
	case BillingCharacters:
		result.PromptTokens = usage.Units
		result.PromptTokensDetails.TextTokens = usage.Units
	case BillingAudioUnits, BillingMusicDuration:
		result.CompletionTokens = usage.Units
		result.CompletionTokenDetails.AudioTokens = usage.Units
	}
	result.TotalTokens = result.PromptTokens + result.CompletionTokens
	return result
}

func NativeProxy(c *gin.Context, info *relaycommon.RelayInfo, upstreamPath string) (*http.Response, error) {
	body, contentLength, err := nativeRequestBody(c, info.OriginModelName, info.UpstreamModelName)
	if err != nil {
		return nil, err
	}
	requestURL, err := buildNativeRequestURL(info.ChannelBaseUrl, upstreamPath, c.Request.URL.RawQuery)
	if err != nil {
		return nil, err
	}
	req, err := http.NewRequestWithContext(c.Request.Context(), c.Request.Method, requestURL, body)
	if err != nil {
		return nil, fmt.Errorf("new ElevenLabs request failed: %w", err)
	}
	channel.ApplyUpstreamBodyMetadata(req, body)
	if req.ContentLength == 0 && contentLength > 0 {
		req.ContentLength = contentLength
	}
	copyNativeRequestHeaders(c, req)
	req.Header.Set("xi-api-key", info.ApiKey)
	headerOverride, err := channel.ResolveHeaderOverride(info, c)
	if err != nil {
		return nil, err
	}
	for key, value := range headerOverride {
		req.Header.Set(key, value)
		if strings.EqualFold(key, "Host") {
			req.Host = value
		}
	}
	return channel.DoRequest(c, req, info)
}

func CopyNativeResponse(c *gin.Context, resp *http.Response) error {
	if resp == nil {
		return errors.New("nil ElevenLabs response")
	}
	defer service.CloseResponseBodyGracefully(resp)
	for key, values := range resp.Header {
		if len(values) > 0 && shouldCopyNativeResponseHeader(key) && service.ShouldCopyUpstreamHeader(c, key, values) {
			c.Writer.Header().Set(key, values[0])
		}
	}
	c.Writer.WriteHeader(resp.StatusCode)
	if _, err := io.Copy(c.Writer, resp.Body); err != nil {
		logger.LogError(c, "failed to copy ElevenLabs response: "+err.Error())
		return err
	}
	c.Writer.Flush()
	return nil
}

func normalizeNativePath(path string) string {
	if path == "" {
		return "/"
	}
	if !strings.HasPrefix(path, "/") {
		path = "/" + path
	}
	trimmed := strings.TrimRight(path, "/")
	if trimmed == "" {
		return "/"
	}
	return trimmed
}

func splitPathSegments(path string) []string {
	path = strings.Trim(path, "/")
	if path == "" {
		return nil
	}
	return strings.Split(path, "/")
}

func isBlockedNativePath(segments []string) bool {
	if len(segments) < 2 {
		return false
	}
	blocked := map[string]struct{}{
		"history": {}, "convai": {}, "workspace": {}, "workspaces": {}, "api-keys": {},
		"service-accounts": {}, "webhooks": {}, "dubbing": {}, "realtime": {}, "studio": {},
	}
	_, ok := blocked[segments[1]]
	return ok
}

func isReadOnlyVoicePath(segments []string) bool {
	if len(segments) < 2 || segments[1] != "voices" {
		return false
	}
	if len(segments) == 2 {
		return true
	}
	if segments[0] != "v1" {
		return false
	}
	return len(segments) == 3 || (len(segments) == 4 && ((segments[2] == "settings" && segments[3] == "default") || segments[3] == "settings"))
}

func isMultipartRequest(c *gin.Context) bool {
	return strings.HasPrefix(c.Request.Header.Get("Content-Type"), "multipart/form-data")
}

func isJSONRequest(c *gin.Context) bool {
	contentType := c.Request.Header.Get("Content-Type")
	return contentType == "" || strings.HasPrefix(contentType, "application/json")
}

func requestBodyBytes(c *gin.Context) ([]byte, error) {
	storage, err := common.GetBodyStorage(c)
	if err != nil {
		return nil, err
	}
	body, err := storage.Bytes()
	if err != nil {
		return nil, err
	}
	if _, err := storage.Seek(0, io.SeekStart); err != nil {
		return nil, err
	}
	c.Request.Body = io.NopCloser(storage)
	return body, nil
}

func formField(c *gin.Context, names ...string) (string, error) {
	form, err := common.ParseMultipartFormReusable(c)
	if err != nil {
		return "", err
	}
	defer func() { _ = form.RemoveAll() }()
	for _, name := range names {
		if values := form.Value[name]; len(values) > 0 && strings.TrimSpace(values[0]) != "" {
			return strings.TrimSpace(values[0]), nil
		}
	}
	return "", nil
}

func estimateCharacterUnits(c *gin.Context) (int, error) {
	if !isJSONRequest(c) {
		return 0, errors.New("ElevenLabs character-billed endpoint requires JSON request body")
	}
	body, err := requestBodyBytes(c)
	if err != nil {
		return 0, err
	}
	if len(bytes.TrimSpace(body)) == 0 {
		return 0, errors.New("request body is required")
	}
	var payload any
	if err := common.Unmarshal(body, &payload); err != nil {
		return 0, err
	}
	chars := countTextFields(payload)
	if chars <= 0 {
		return 0, errors.New("ElevenLabs request must contain text or prompt for character billing")
	}
	return chars, nil
}

func countTextFields(value any) int {
	switch typed := value.(type) {
	case map[string]any:
		total := 0
		for key, child := range typed {
			if text, ok := child.(string); ok && (strings.EqualFold(key, "text") || strings.EqualFold(key, "prompt")) {
				total += utf8.RuneCountInString(text)
				continue
			}
			total += countTextFields(child)
		}
		return total
	case []any:
		total := 0
		for _, child := range typed {
			total += countTextFields(child)
		}
		return total
	default:
		return 0
	}
}

func estimateAudioDuration(c *gin.Context) (float64, error) {
	if !isMultipartRequest(c) {
		return 0, errors.New("ElevenLabs audio-billed endpoint requires multipart/form-data request body")
	}
	form, err := common.ParseMultipartFormReusable(c)
	if err != nil {
		return 0, err
	}
	defer func() { _ = form.RemoveAll() }()
	for _, fileHeaders := range form.File {
		for _, fileHeader := range fileHeaders {
			if fileHeader == nil || fileHeader.Size <= 0 {
				continue
			}
			file, err := fileHeader.Open()
			if err != nil {
				return 0, err
			}
			duration, durationErr := common.GetAudioDuration(c.Request.Context(), file, strings.ToLower(filepath.Ext(fileHeader.Filename)))
			_ = file.Close()
			if durationErr != nil {
				return 0, durationErr
			}
			if duration > 0 {
				return duration, nil
			}
		}
	}
	return 0, errors.New("audio file is required")
}

func estimateMusicDuration(c *gin.Context) (float64, error) {
	if !isJSONRequest(c) {
		return 0, errors.New("ElevenLabs music endpoint requires JSON request body")
	}
	body, err := requestBodyBytes(c)
	if err != nil {
		return 0, err
	}
	if len(bytes.TrimSpace(body)) == 0 {
		return 0, errors.New("request body is required")
	}
	lengthMs := gjson.GetBytes(body, "music_length_ms")
	if !lengthMs.Exists() || lengthMs.Type == gjson.Null {
		return defaultMusicDurationSeconds, nil
	}
	if lengthMs.Type != gjson.Number {
		return 0, errors.New("music_length_ms must be a number")
	}
	duration := lengthMs.Float() / 1000
	if duration <= 0 || duration > relaycommon.MaxTaskDurationSeconds {
		return 0, fmt.Errorf("music_length_ms must be between 1 and %d seconds", relaycommon.MaxTaskDurationSeconds)
	}
	return duration, nil
}

func durationToAudioUnits(duration float64) (int, error) {
	if duration <= 0 {
		return 0, nil
	}
	return common.QuotaRoundStrict(math.Ceil(duration) / 60 * 1000)
}

func nativeRequestBody(c *gin.Context, originModel, upstreamModel string) (io.Reader, int64, error) {
	if c.Request.Method == http.MethodGet || c.Request.Body == nil {
		return http.NoBody, 0, nil
	}
	storage, err := common.GetBodyStorage(c)
	if err != nil {
		return nil, 0, err
	}
	if originModel == upstreamModel || strings.TrimSpace(upstreamModel) == "" {
		if _, err := storage.Seek(0, io.SeekStart); err != nil {
			return nil, 0, err
		}
		return common.NewReplayableBodyReader(storage), storage.Size(), nil
	}
	if isJSONRequest(c) {
		body, err := storage.Bytes()
		if err != nil {
			return nil, 0, err
		}
		var payload map[string]any
		if err := common.Unmarshal(body, &payload); err != nil {
			return nil, 0, err
		}
		modelKey := ""
		if _, ok := payload["model_id"]; ok {
			modelKey = "model_id"
		} else if _, ok := payload["model"]; ok {
			modelKey = "model"
		}
		if modelKey != "" {
			payload[modelKey] = upstreamModel
			encoded, err := common.Marshal(payload)
			if err != nil {
				return nil, 0, err
			}
			return bytes.NewReader(encoded), int64(len(encoded)), nil
		}
	}
	if isMultipartRequest(c) {
		form, err := common.ParseMultipartFormReusable(c)
		if err != nil {
			return nil, 0, err
		}
		defer func() { _ = form.RemoveAll() }()
		modelKey := ""
		if _, ok := form.Value["model_id"]; ok {
			modelKey = "model_id"
		} else if _, ok := form.Value["model"]; ok {
			modelKey = "model"
		}
		if modelKey != "" {
			var rewritten bytes.Buffer
			writer := multipart.NewWriter(&rewritten)
			for key, values := range form.Value {
				if key == modelKey {
					values = []string{upstreamModel}
				}
				for _, value := range values {
					if err := writer.WriteField(key, value); err != nil {
						return nil, 0, err
					}
				}
			}
			for key, fileHeaders := range form.File {
				for _, fileHeader := range fileHeaders {
					part, err := writer.CreateFormFile(key, fileHeader.Filename)
					if err != nil {
						return nil, 0, err
					}
					file, err := fileHeader.Open()
					if err != nil {
						return nil, 0, err
					}
					_, copyErr := io.Copy(part, file)
					closeErr := file.Close()
					if copyErr != nil {
						return nil, 0, copyErr
					}
					if closeErr != nil {
						return nil, 0, closeErr
					}
				}
			}
			if err := writer.Close(); err != nil {
				return nil, 0, err
			}
			c.Request.Header.Set("Content-Type", writer.FormDataContentType())
			return bytes.NewReader(rewritten.Bytes()), int64(rewritten.Len()), nil
		}
	}
	if _, err := storage.Seek(0, io.SeekStart); err != nil {
		return nil, 0, err
	}
	return common.NewReplayableBodyReader(storage), storage.Size(), nil
}

func buildNativeRequestURL(baseURL, upstreamPath, rawQuery string) (string, error) {
	if strings.TrimSpace(baseURL) == "" {
		baseURL = constant.ChannelBaseURLs[constant.ChannelTypeElevenLabs]
	}
	parsed, err := url.Parse(strings.TrimRight(baseURL, "/"))
	if err != nil {
		return "", err
	}
	parsed.Path = strings.TrimRight(parsed.Path, "/") + normalizeNativePath(upstreamPath)
	parsed.RawQuery = rawQuery
	return parsed.String(), nil
}

func copyNativeRequestHeaders(c *gin.Context, req *http.Request) {
	for key, values := range c.Request.Header {
		if shouldSkipNativeRequestHeader(key) {
			continue
		}
		for _, value := range values {
			req.Header.Add(key, value)
		}
	}
}

func shouldSkipNativeRequestHeader(name string) bool {
	switch strings.ToLower(strings.TrimSpace(name)) {
	case "", "host", "content-length", "accept-encoding", "connection", "keep-alive", "proxy-authenticate", "proxy-authorization", "te", "trailer", "transfer-encoding", "upgrade", "authorization", "x-api-key", "xi-api-key", "cookie":
		return true
	default:
		return false
	}
}

func shouldCopyNativeResponseHeader(name string) bool {
	switch strings.ToLower(strings.TrimSpace(name)) {
	case "connection", "keep-alive", "proxy-authenticate", "proxy-authorization", "te", "trailer", "transfer-encoding", "upgrade":
		return false
	default:
		return true
	}
}

func multipartFileToBytes(fileHeader *multipart.FileHeader) ([]byte, error) {
	file, err := fileHeader.Open()
	if err != nil {
		return nil, err
	}
	defer file.Close()
	return io.ReadAll(file)
}

func BuildOpenAITranscriptionMultipart(c *gin.Context, upstreamModel string) (io.Reader, int, error) {
	form, err := common.ParseMultipartFormReusable(c)
	if err != nil {
		return nil, 0, fmt.Errorf("error parsing multipart form: %w", err)
	}
	defer func() { _ = form.RemoveAll() }()
	var requestBody bytes.Buffer
	writer := multipart.NewWriter(&requestBody)
	_ = writer.WriteField("model_id", upstreamModel)
	for key, values := range form.Value {
		if key == "model" || key == "model_id" {
			continue
		}
		fieldName := key
		if key == "language" {
			fieldName = "language_code"
		}
		for _, value := range values {
			_ = writer.WriteField(fieldName, value)
		}
	}
	fileHeaders := form.File["file"]
	if len(fileHeaders) == 0 {
		return nil, 0, errors.New("file is required")
	}
	fileHeader := fileHeaders[0]
	fileBytes, err := multipartFileToBytes(fileHeader)
	if err != nil {
		return nil, 0, err
	}
	part, err := writer.CreateFormFile("file", fileHeader.Filename)
	if err != nil {
		return nil, 0, err
	}
	if _, err := part.Write(fileBytes); err != nil {
		return nil, 0, err
	}
	file, err := fileHeader.Open()
	if err != nil {
		return nil, 0, err
	}
	duration, durationErr := common.GetAudioDuration(c.Request.Context(), file, strings.ToLower(filepath.Ext(fileHeader.Filename)))
	_ = file.Close()
	if durationErr != nil {
		return nil, 0, durationErr
	}
	audioUnits, err := durationToAudioUnits(duration)
	if err != nil {
		return nil, 0, err
	}
	if err := writer.Close(); err != nil {
		return nil, 0, err
	}
	c.Request.Header.Set("Content-Type", writer.FormDataContentType())
	return &requestBody, audioUnits, nil
}

func OpenAIAudioModel(modelName string, speech bool) string {
	modelName = strings.TrimSpace(modelName)
	if modelName != "" {
		return modelName
	}
	if speech {
		return DefaultTTSModel
	}
	return DefaultSTTModel
}

func OutputFormatQueryValue(responseFormat string) string {
	switch strings.ToLower(strings.TrimSpace(responseFormat)) {
	case "mp3", "":
		return "mp3_44100_128"
	case "opus":
		return "opus_48000_64"
	case "wav":
		return "wav_44100"
	case "pcm":
		return "pcm_24000"
	default:
		return ""
	}
}
