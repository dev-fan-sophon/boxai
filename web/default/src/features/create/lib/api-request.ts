import { bareModelId } from '@/features/playground/lib/studio/image-request-schema'
import type { StudioSettings } from '@/features/playground/types'

import type { CreateTool } from '../constants'
import type { GenerationDraft } from '../hooks/use-generation-draft'

export type ApiRequest = {
  path: string
  /** JSON body, or the text fields of a multipart form. */
  body: Record<string, unknown>
  /** Multipart upload: name of the file field and an example file. */
  file?: { field: string; example: string }
  /** The response is an audio file rather than JSON. */
  binaryOutput?: boolean
}

function withOutputFormat(path: string, format: string): string {
  return `${path}?output_format=${encodeURIComponent(format)}`
}

/** Native ElevenLabs call (`/elevenlabs/v1/...`) behind an audio sub-tool. */
function elevenLabsRequest(
  model: string,
  prompt: string,
  settings: StudioSettings
): ApiRequest {
  const voice = encodeURIComponent(settings.elevenVoiceId)
  switch (settings.audioTool) {
    case 'sfx':
      return {
        path: withOutputFormat(
          '/elevenlabs/v1/sound-generation',
          settings.elevenOutputFormat
        ),
        body: {
          text: prompt,
          model_id: model,
          prompt_influence: settings.sfxPromptInfluence,
          loop: settings.sfxLoop,
          ...(settings.sfxDuration !== null
            ? { duration_seconds: settings.sfxDuration }
            : {}),
        },
        binaryOutput: true,
      }
    case 'music':
      return {
        path: withOutputFormat('/elevenlabs/v1/music', 'mp3_44100_128'),
        body: {
          prompt,
          model_id: model,
          force_instrumental: settings.musicInstrumental,
          ...(settings.musicLengthSeconds !== null
            ? { music_length_ms: settings.musicLengthSeconds * 1000 }
            : {}),
        },
        binaryOutput: true,
      }
    case 'transcribe':
      return {
        path: '/elevenlabs/v1/speech-to-text',
        body: {
          model_id: model,
          ...(settings.sttLanguage
            ? { language_code: settings.sttLanguage }
            : {}),
          diarize: settings.sttDiarize,
          ...(settings.sttDiarize && settings.sttNumSpeakers !== null
            ? { num_speakers: settings.sttNumSpeakers }
            : {}),
          timestamps_granularity: settings.sttTimestamps,
          tag_audio_events: settings.sttTagAudioEvents,
        },
        file: { field: 'file', example: 'meeting.mp3' },
      }
    case 'voice-changer':
      return {
        path: withOutputFormat(
          `/elevenlabs/v1/speech-to-speech/${voice}`,
          settings.elevenOutputFormat
        ),
        body: {
          model_id: model,
          remove_background_noise: settings.stsRemoveNoise,
        },
        file: { field: 'audio', example: 'recording.mp3' },
        binaryOutput: true,
      }
    case 'isolate':
      return {
        path: '/elevenlabs/v1/audio-isolation',
        body: {},
        file: { field: 'audio', example: 'noisy.mp3' },
        binaryOutput: true,
      }
    case 'align':
      return {
        path: '/elevenlabs/v1/forced-alignment',
        body: { text: prompt },
        file: { field: 'file', example: 'narration.mp3' },
      }
    default:
      return {
        path: withOutputFormat(
          `/elevenlabs/v1/text-to-speech/${voice}`,
          settings.elevenOutputFormat
        ),
        body: {
          text: prompt,
          model_id: model,
          ...(settings.elevenLanguage
            ? { language_code: settings.elevenLanguage }
            : {}),
          ...(settings.elevenSeed !== null
            ? { seed: settings.elevenSeed }
            : {}),
          voice_settings: {
            stability: settings.elevenStability,
            similarity_boost: settings.elevenSimilarity,
            style: settings.elevenStyle,
            use_speaker_boost: settings.elevenSpeakerBoost,
            speed: settings.elevenSpeed,
          },
        },
        binaryOutput: true,
      }
  }
}

/** The public API request equivalent to the run the panel would start. */
export function buildApiRequest(input: {
  modality: CreateTool
  model: string
  prompt: string
  settings: StudioSettings
  draft: Pick<GenerationDraft, 'videoOptions' | 'estimateParams' | 'audio'>
}): ApiRequest {
  const prompt = input.prompt.trim() || 'A lighthouse on a cliff at sunrise'
  if (input.modality === 'image') {
    return {
      path: '/v1/images/generations',
      body: {
        model: bareModelId(input.model) || input.model,
        prompt,
        n: input.settings.imageCount,
        size: input.settings.imageSize,
        quality: input.settings.imageQuality,
      },
    }
  }
  if (input.modality === 'video') {
    const duration =
      input.draft.videoOptions?.duration ?? input.settings.videoDuration
    return {
      path: '/v1/video/generations',
      body: {
        model: input.model,
        prompt,
        duration,
        ...(input.draft.estimateParams.size
          ? { size: input.draft.estimateParams.size }
          : {}),
      },
    }
  }
  if (input.draft.audio.native) {
    return elevenLabsRequest(input.model, prompt, input.settings)
  }
  return {
    path: '/v1/audio/speech',
    body: {
      model: input.model,
      input: prompt,
      voice: input.settings.voice,
      speed: input.settings.speed,
      response_format: input.settings.audioFormat,
    },
    binaryOutput: true,
  }
}
