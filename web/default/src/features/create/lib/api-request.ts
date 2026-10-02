import { bareModelId } from '@/features/playground/lib/studio/image-request-schema'
import type { StudioSettings } from '@/features/playground/types'

import type { CreateTool } from '../constants'
import type { GenerationDraft } from '../hooks/use-generation-draft'

/** The parts of the generation draft the API snippet mirrors. */
export type ApiRequestDraft = Pick<
  GenerationDraft,
  'videoOptions' | 'estimateParams'
> &
  Partial<
    Pick<
      GenerationDraft,
      | 'videoCapabilities'
      | 'capabilityMode'
      | 'referenceCounts'
      | 'usesLastFrame'
      | 'audio'
    >
  >

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
  draft: ApiRequestDraft
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
    return { path: '/v1/video/generations', body: buildVideoApiBody(input) }
  }
  if (input.draft.audio?.native) {
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

/** Placeholder media: the snippet never leaks private studio asset links. */
function exampleUrls(kind: string, count: number, extension: string) {
  return Array.from(
    { length: count },
    (_, index) => `https://example.com/${kind}-${index + 1}.${extension}`
  )
}

/**
 * Video body mirroring the studio request: duration and size, the options
 * the selected model reads from metadata, and frames or typed references.
 */
function buildVideoApiBody(input: {
  model: string
  prompt: string
  settings: StudioSettings
  draft: ApiRequestDraft
}): Record<string, unknown> {
  const prompt = input.prompt.trim() || 'A lighthouse on a cliff at sunrise'
  const options = input.draft.videoOptions
  const capabilities = input.draft.videoCapabilities
  const duration = options?.duration ?? input.settings.videoDuration
  const body: Record<string, unknown> = {
    model: input.model,
    prompt,
    duration,
  }
  if (input.draft.estimateParams.size) {
    body.size = input.draft.estimateParams.size
  }
  const metadata: Record<string, unknown> = {}
  if (capabilities?.supportsAudioToggle && options) {
    metadata.generate_audio = options.generateAudio
  }
  if (capabilities?.usesVolcengineMetadata && options) {
    metadata.resolution = options.resolution
    metadata.ratio = options.aspectRatio
    if (
      capabilities.supportsSeed &&
      typeof input.settings.videoSeed === 'number'
    ) {
      metadata.seed = input.settings.videoSeed
    }
    if (capabilities.supportsWatermark && input.settings.videoWatermark) {
      metadata.watermark = true
    }
    if (capabilities.returnsLastFrame) metadata.return_last_frame = true
  }
  if (Object.keys(metadata).length) body.metadata = metadata

  const counts = input.draft.referenceCounts
  if (input.draft.capabilityMode === 'frames') {
    body.first_frame = 'https://example.com/first-frame.png'
    if (input.draft.usesLastFrame && (counts?.images ?? 0) > 1) {
      body.last_frame = 'https://example.com/last-frame.png'
    }
  } else if (input.draft.capabilityMode === 'references' && counts) {
    if (counts.images > 0) {
      body.reference_images = exampleUrls('reference', counts.images, 'png')
    }
    if (counts.videos > 0) {
      body.reference_videos = exampleUrls('clip', counts.videos, 'mp4')
    }
    if (counts.audios > 0) {
      body.reference_audios = exampleUrls('audio', counts.audios, 'mp3')
    }
  }
  return body
}
