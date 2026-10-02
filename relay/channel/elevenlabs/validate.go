package elevenlabs

import (
	"bytes"
	"errors"
	"fmt"
	"math"
	"strings"
	"unicode/utf8"

	"github.com/gin-gonic/gin"
	"github.com/tidwall/gjson"
)

// MaxTTSCharacters is the per-request text limit ElevenLabs documents for a
// text-to-speech model (https://elevenlabs.io/docs/models).
func MaxTTSCharacters(modelName string) int {
	switch strings.TrimSpace(modelName) {
	case "eleven_v3":
		return MaxTTSCharactersV3
	case "eleven_multilingual_v2", "eleven_multilingual_v1", "eleven_monolingual_v1":
		return MaxTTSCharactersMultilingual
	default:
		return MaxTTSCharactersDefault
	}
}

// ValidateNativeRequest rejects requests that ElevenLabs would refuse, before
// any quota is reserved. It checks the documented bounds of the user-supplied
// parameters that matter for billing or that the studio exposes as controls;
// everything else is left for upstream to validate.
func ValidateNativeRequest(c *gin.Context, endpoint *NativeEndpoint, modelName string) error {
	if endpoint == nil {
		return errors.New("ElevenLabs endpoint is required")
	}
	switch endpoint.Name {
	case "text-to-speech", "sound-generation", "music":
	default:
		return nil
	}
	if !isJSONRequest(c) {
		return fmt.Errorf("ElevenLabs %s requires a JSON request body", endpoint.Name)
	}
	body, err := requestBodyBytes(c)
	if err != nil {
		return err
	}
	if len(bytes.TrimSpace(body)) == 0 || !gjson.ValidBytes(body) {
		return errors.New("request body must be valid JSON")
	}
	switch endpoint.Name {
	case "text-to-speech":
		return validateTextToSpeech(body, modelName)
	case "sound-generation":
		return validateSoundGeneration(body)
	default:
		_, err := requestedMusicLengthMs(body)
		return err
	}
}

func validateTextToSpeech(body []byte, modelName string) error {
	if bodyModel := gjson.GetBytes(body, "model_id"); bodyModel.Type == gjson.String && bodyModel.String() != "" {
		modelName = bodyModel.String()
	}
	text := gjson.GetBytes(body, "text")
	if text.Type != gjson.String || strings.TrimSpace(text.String()) == "" {
		return errors.New("text is required")
	}
	limit := MaxTTSCharacters(modelName)
	if chars := utf8.RuneCountInString(text.String()); chars > limit {
		return fmt.Errorf("text is %d characters; %s accepts at most %d per request", chars, modelName, limit)
	}
	settings := gjson.GetBytes(body, "voice_settings")
	if settings.Exists() && settings.Type != gjson.Null {
		if !settings.IsObject() {
			return errors.New("voice_settings must be an object")
		}
		for _, field := range []string{"stability", "similarity_boost", "style"} {
			if err := checkOptionalRange(settings.Get(field), "voice_settings."+field, 0, 1); err != nil {
				return err
			}
		}
		if err := checkOptionalRange(settings.Get("speed"), "voice_settings.speed", MinTTSSpeed, MaxTTSSpeed); err != nil {
			return err
		}
	}
	return checkOptionalSeed(gjson.GetBytes(body, "seed"))
}

func validateSoundGeneration(body []byte) error {
	text := gjson.GetBytes(body, "text")
	if text.Type != gjson.String || strings.TrimSpace(text.String()) == "" {
		return errors.New("text is required")
	}
	if err := checkOptionalRange(gjson.GetBytes(body, "duration_seconds"), "duration_seconds", MinSoundDurationSeconds, MaxSoundDurationSeconds); err != nil {
		return err
	}
	return checkOptionalRange(gjson.GetBytes(body, "prompt_influence"), "prompt_influence", 0, 1)
}

func checkOptionalRange(value gjson.Result, name string, minValue, maxValue float64) error {
	if !value.Exists() || value.Type == gjson.Null {
		return nil
	}
	if value.Type != gjson.Number {
		return fmt.Errorf("%s must be a number", name)
	}
	number := value.Float()
	if math.IsNaN(number) || number < minValue || number > maxValue {
		return fmt.Errorf("%s must be between %g and %g", name, minValue, maxValue)
	}
	return nil
}

func checkOptionalSeed(value gjson.Result) error {
	if !value.Exists() || value.Type == gjson.Null {
		return nil
	}
	if value.Type != gjson.Number {
		return errors.New("seed must be an integer")
	}
	number := value.Float()
	if number < 0 || number > MaxSeed || number != math.Trunc(number) {
		return fmt.Errorf("seed must be an integer between 0 and %d", int64(MaxSeed))
	}
	return nil
}
