package elevenlabs

import (
	"fmt"
	"net/http"
	"regexp"
	"sort"
	"strings"

	"github.com/dev-fan-sophon/boxai/types"
)

// openAIVoiceAliases maps OpenAI TTS voice names to ElevenLabs default
// (premade) voices of a similar character, so OpenAI SDK clients that send
// `voice: "alloy"` to an ElevenLabs model get speech instead of an upstream
// "voice not found". Before this mapping those names always failed upstream,
// so no working integration depends on them being passed through.
var openAIVoiceAliases = map[string]string{
	"alloy":   "SAz9YHcvj6GT2YYXdXww", // River — neutral, calm
	"ash":     "nPczCjzI2devNBz1zQrb", // Brian — deep, resonant male
	"ballad":  "N2lVS1w4EtoT3dr4eOWO", // Callum — husky male
	"coral":   "cgSgspJ2msm6clMCkdW9", // Jessica — playful, warm female
	"echo":    "cjVigY5qzO86Huf0OWal", // Eric — smooth male
	"fable":   "JBFqnCBsd6RMkjVDRZzb", // George — British storyteller
	"nova":    "FGY2WhTYpPnrIDTdsKH5", // Laura — upbeat female
	"onyx":    "onwK4e9ZLuTAKqWW03F9", // Daniel — deep British male
	"sage":    "XrExE9yKIg1WjnnlVkGX", // Matilda — knowledgeable female
	"shimmer": "pFZP5JQG7iQjIQuC4Bku", // Lily — velvety female
	"verse":   "TX3LPaxmHKxFdv7VOQHJ", // Liam — energetic male
	"marin":   "EXAVITQu4vr4xnSDxMaL", // Sarah — confident female
	"cedar":   "CwhRBWXzGAHq8TQ4Fs17", // Roger — laid-back male
}

// ElevenLabs voice ids are opaque alphanumeric strings (20 characters today).
var elevenLabsVoiceIDPattern = regexp.MustCompile(`^[A-Za-z0-9]{10,64}$`)

// ResolveSpeechVoiceID turns the OpenAI-compatible `voice` field into an
// ElevenLabs voice id: OpenAI voice names map to default voices, ElevenLabs
// ids pass through, and anything else is a 400 that tells the caller what to
// send instead of a billed upstream failure.
func ResolveSpeechVoiceID(voice string) (string, error) {
	voice = strings.TrimSpace(voice)
	if voice == "" {
		return "", invalidVoiceError("voice is required")
	}
	if mapped, ok := openAIVoiceAliases[strings.ToLower(voice)]; ok {
		return mapped, nil
	}
	if elevenLabsVoiceIDPattern.MatchString(voice) {
		return voice, nil
	}
	return "", invalidVoiceError(fmt.Sprintf("voice %q is not an ElevenLabs voice_id", voice))
}

func invalidVoiceError(reason string) error {
	aliases := make([]string, 0, len(openAIVoiceAliases))
	for name := range openAIVoiceAliases {
		aliases = append(aliases, name)
	}
	sort.Strings(aliases)
	return types.NewOpenAIError(
		fmt.Errorf("%s; send an ElevenLabs voice_id (GET /elevenlabs/v2/voices) or one of the OpenAI voice names %s", reason, strings.Join(aliases, ", ")),
		types.ErrorCodeInvalidRequest,
		http.StatusBadRequest,
	)
}
