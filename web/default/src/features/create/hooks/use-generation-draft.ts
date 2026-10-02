import { useTranslation } from 'react-i18next'

import {
  getVideoCapabilityMode,
  useVideoCapabilities,
} from '@/features/playground/hooks/use-video-capabilities'
import { elevenTtsCharLimit } from '@/features/playground/lib/studio/audio-settings'
import {
  planGenerationJobs,
  type GenerationJobPlan,
} from '@/features/playground/lib/studio/batch-plan'
import { resolveImageOptions } from '@/features/playground/lib/studio/image-capabilities'
import {
  isPlaygroundImageModel,
  normalizeImageCount,
} from '@/features/playground/lib/studio/image-request-schema'
import {
  getActiveVideoReferenceLimit,
  getVideoUploadProfile,
  resolveVideoOptions,
  videoSizeForOptions,
} from '@/features/playground/lib/studio/video-capabilities'
import { useAuthStore } from '@/stores/auth-store'
import { usePlaygroundStore } from '@/stores/playground-store'

import type { MediaReference } from '../components/references/media-reference-slot'
import type { CreateTool } from '../constants'
import { useAudioTool } from './use-audio-tool'
import { useImageCapabilities } from './use-image-capabilities'

/** Reference cap while the image capabilities are unknown (guest/loading). */
const DEFAULT_IMAGE_REFERENCE_LIMIT = 4

export type GenerationEstimateParams = {
  modality: CreateTool
  n: number
  size?: string
  duration?: number
  has_reference: boolean
}

/**
 * Everything derived from the current prompt, references and settings that
 * a submit surface needs: the expanded batch plan, the reference limits of
 * the selected video mode, and whether the run can start. Both the desktop
 * control panel and the mobile composer render from this one derivation, so
 * they can never disagree about what "Generate" will do.
 */
export function useGenerationDraft(input: {
  modality: CreateTool
  text: string
  references: MediaReference[]
  /** Typed reference media; only sent in references mode. */
  referenceVideos?: MediaReference[]
  referenceAudios?: MediaReference[]
  uploading: boolean
}) {
  const { t } = useTranslation()
  const model = usePlaygroundStore((state) => state.config.model)
  const group = usePlaygroundStore((state) => state.config.group)
  const groups = usePlaygroundStore((state) => state.groups)
  const settings = usePlaygroundStore((state) => state.studioSettings)
  const isVideo = input.modality === 'video'
  const isAudio = input.modality === 'audio'
  const audio = useAudioTool()
  const signedIn = useAuthStore((state) => Boolean(state.auth.user))
  const capabilityQuery = useVideoCapabilities(group, model, isVideo)
  const referenceProfile = capabilityQuery.data?.references
  // Typed video/audio slots exist only while references mode is selected.
  const referencesModeSelected = Boolean(
    isVideo && settings.videoReferenceMode === 'references' && referenceProfile
  )
  const maxReferenceVideos = referencesModeSelected
    ? (referenceProfile?.maxReferenceVideos ?? 0)
    : 0
  const maxReferenceAudios = referencesModeSelected
    ? (referenceProfile?.maxReferenceAudios ?? 0)
    : 0
  const referenceVideoCount = referencesModeSelected
    ? (input.referenceVideos?.length ?? 0)
    : 0
  const referenceAudioCount = referencesModeSelected
    ? (input.referenceAudios?.length ?? 0)
    : 0
  const hasImage =
    input.references.length + referenceVideoCount + referenceAudioCount > 0

  const isImage = input.modality === 'image'
  const imageCapabilityQuery = useImageCapabilities(group, model, isImage)
  const imageCapabilities = isImage ? (imageCapabilityQuery.data ?? null) : null
  const imageOptions = imageCapabilities
    ? resolveImageOptions(imageCapabilities, settings)
    : undefined
  const capabilityMode = getVideoCapabilityMode(
    hasImage,
    settings.videoReferenceMode
  )
  const videoCapabilities = capabilityQuery.data?.[capabilityMode]
  const videoOptions = videoCapabilities
    ? resolveVideoOptions(
        videoCapabilities,
        {
          aspectRatio: settings.videoAspectRatio,
          resolution: settings.videoResolution,
          seconds: settings.videoDuration,
          size: settings.videoSize,
          generateAudio: settings.videoGenerateAudio,
          referenceMode: settings.videoReferenceMode,
          count: settings.videoCount,
        },
        { hasImage, mode: capabilityMode }
      )
    : undefined
  const uploadProfile = getVideoUploadProfile(
    capabilityQuery.data,
    settings.videoReferenceMode
  )
  const usesLastFrame = Boolean(
    isVideo &&
    videoOptions?.referenceMode === 'frames' &&
    videoCapabilities?.supportsLastFrame &&
    !settings.videoDisableLastFrame
  )

  let maxFiles = DEFAULT_IMAGE_REFERENCE_LIMIT
  if (isImage && imageCapabilities) {
    maxFiles = imageCapabilities.maxReferenceImages
  } else if (isVideo && uploadProfile) {
    maxFiles = getActiveVideoReferenceLimit({
      capabilities: uploadProfile.capabilities,
      referenceMode: uploadProfile.mode,
      disableLastFrame: settings.videoDisableLastFrame,
    })
  } else if (isVideo || isAudio) {
    maxFiles = 1
  }

  let mediaLabel = t('Reference image')
  if (referencesModeSelected) {
    mediaLabel = t('Reference images')
  } else if (isVideo && videoOptions?.referenceMode === 'frames') {
    mediaLabel = usesLastFrame ? t('First and last frame') : t('First frame')
  }

  let batchMode = false
  let count = 1
  if (input.modality === 'image') {
    batchMode = settings.imageBatchMode
    count = normalizeImageCount(settings.imageCount)
  } else if (isVideo) {
    batchMode = settings.videoBatchMode
    count = videoOptions?.count ?? 1
  }

  // Audio text is spoken or described verbatim, so it never expands into
  // variants. File tools (transcribe, voice changer, isolate) run on the
  // attached file; their run is labelled with the tool and the file name.
  const trimmed = input.text.trim()
  const audioInput = isAudio && audio.usesFile ? input.references[0] : undefined
  let audioPrompt = trimmed
  if (isAudio && audio.usesFile && audio.tool !== 'align') {
    audioPrompt = audioInput ? `${audio.label} · ${audioInput.name}` : ''
  } else if (isAudio && audio.tool === 'align' && !audioInput) {
    audioPrompt = ''
  }
  const plan: GenerationJobPlan = isAudio
    ? { prompts: audioPrompt ? [audioPrompt] : [], truncated: 0 }
    : planGenerationJobs({ text: input.text, batchMode, count })
  const charLimit =
    isAudio && audio.tool === 'speech' && audio.native
      ? elevenTtsCharLimit(model)
      : null
  const charCount = [...input.text].length
  const overCharLimit = charLimit !== null && charCount > charLimit
  const audioModelMismatch =
    isAudio && Boolean(model) && audio.modelKind !== audio.tool
  const jobCount = plan.prompts.length
  const distinctPrompts = new Set(plan.prompts).size
  const audioNeedsVisual = Boolean(
    referenceProfile?.audioReferenceRequiresVisual &&
    referenceAudioCount > 0 &&
    input.references.length + referenceVideoCount === 0
  )
  const typedMediaValid =
    referenceVideoCount <= maxReferenceVideos &&
    referenceAudioCount <= maxReferenceAudios &&
    !audioNeedsVisual
  const referencesValid = Boolean(
    videoCapabilities && input.references.length <= maxFiles && typedMediaValid
  )
  // Guests cannot load video options; Generate stays live so the click can
  // open the sign-in prompt instead of looking broken.
  const videoReady =
    !isVideo ||
    !signedIn ||
    Boolean(videoOptions && videoCapabilities && referencesValid)
  const imageReady =
    !isImage ||
    (isPlaygroundImageModel(model) && input.references.length <= maxFiles)
  const canSubmit =
    !input.uploading &&
    Boolean(model) &&
    jobCount > 0 &&
    videoReady &&
    !overCharLimit &&
    !audioModelMismatch &&
    imageReady

  let videoIssue: string | null = null
  if (isVideo && !signedIn) {
    videoIssue = t('Sign in to load the options of this video model.')
  } else if (isVideo && !videoCapabilities) {
    videoIssue = t('This video mode is unavailable for the selected model.')
    if (capabilityQuery.isLoading) {
      videoIssue = t('Loading video options…')
    } else if (capabilityQuery.isError) {
      videoIssue = t('Could not load video options. Retry to continue.')
    } else if (
      !hasImage &&
      !capabilityQuery.data?.text &&
      capabilityQuery.data?.frames?.requiresImage
    ) {
      videoIssue = t('This model needs a reference image')
    }
  } else if (isVideo && audioNeedsVisual) {
    videoIssue = t('Add a reference image or video to use reference audio.')
  } else if (isVideo && !typedMediaValid) {
    videoIssue = t('Remove extra reference videos or audios before generating.')
  } else if (isVideo && !referencesValid) {
    videoIssue = t('Remove extra reference images before generating.')
  }

  let audioIssue: string | null = null
  if (audioModelMismatch) {
    audioIssue = t('Select a model for {{tool}}.', { tool: audio.label })
  } else if (overCharLimit) {
    audioIssue = t('The script is over the {{limit}}-character limit.', {
      limit: charLimit,
    })
  } else if (isAudio && audio.usesFile && !audioInput) {
    audioIssue = t('Attach an audio or video file to continue.')
  }

  let imageIssue: string | null = null
  if (isImage && model && !isPlaygroundImageModel(model)) {
    imageIssue = t(
      'Image generation supports GPT Image, Grok Imagine and Gemini image models. Select one and try again.'
    )
  } else if (isImage && input.references.length > maxFiles) {
    imageIssue = t('Remove extra reference images before generating.')
  }

  let placeholder = t('Describe what you want to create…')
  if (isAudio) {
    placeholder = audioPlaceholder(audio.tool, t)
  } else if (batchMode) {
    placeholder = t('One prompt per line · use {a|b} for variants')
  } else if (isVideo) {
    placeholder = t('Describe the video scene and motion…')
  } else if (input.modality === 'image') {
    placeholder = t('Describe the image you want to create…')
  }

  let submitLabel = t('Generate')
  if (jobCount > 1) {
    submitLabel = t('Generate ×{{count}}', { count: jobCount })
  }

  let planSummary = ''
  if (jobCount > 1 && distinctPrompts > 1) {
    planSummary = t('{{count}} results from {{prompts}} prompts', {
      count: jobCount,
      prompts: distinctPrompts,
    })
  } else if (jobCount > 1) {
    planSummary = t('{{count}} results', { count: jobCount })
  }

  const estimateParams: GenerationEstimateParams = {
    modality: input.modality,
    n: Math.max(1, jobCount),
    size: isVideo
      ? videoSizeForOptions(
          videoOptions?.aspectRatio ?? 'adaptive',
          videoOptions?.resolution ?? '720p'
        )
      : (imageOptions?.size ?? settings.imageSize),
    duration: isVideo ? videoOptions?.duration : undefined,
    has_reference: hasImage,
  }

  return {
    model,
    group,
    groupRatio: groups.find((item) => item.value === group)?.ratio,
    settings,
    capabilityQuery,
    videoCapabilities,
    capabilityMode,
    videoOptions,
    usesLastFrame,
    maxFiles,
    referencesModeSelected,
    referenceCounts: {
      images: input.references.length,
      videos: referenceVideoCount,
      audios: referenceAudioCount,
    },
    maxReferenceVideos,
    maxReferenceAudios,
    audioReferenceRequiresVisual: Boolean(
      referenceProfile?.audioReferenceRequiresVisual
    ),
    mediaLabel,
    batchMode,
    plan,
    jobCount,
    canSubmit,
    videoIssue,
    imageCapabilities,
    imageCapabilityQuery,
    imageOptions,
    imageIssue,
    placeholder,
    submitLabel,
    planSummary,
    estimateParams,
    showMediaSlot: input.modality === 'image' || isVideo,
    audio,
    audioIssue,
    charLimit,
    charCount,
    /** Audio tool that runs on an attached file instead of a prompt. */
    usesAudioInput: isAudio && audio.usesFile,
    /** Whether the prompt box is used by the current audio tool. */
    usesPromptText: !isAudio || !audio.usesFile || audio.tool === 'align',
    canSwitchReferenceMode: Boolean(
      isVideo && capabilityQuery.data?.frames && capabilityQuery.data.references
    ),
    canToggleLastFrame: Boolean(
      isVideo &&
      videoOptions?.referenceMode === 'frames' &&
      videoCapabilities?.supportsLastFrame &&
      input.references.length > 1
    ),
  }
}

export type GenerationDraft = ReturnType<typeof useGenerationDraft>

function audioPlaceholder(
  tool: ReturnType<typeof useAudioTool>['tool'],
  t: (key: string) => string
): string {
  switch (tool) {
    case 'sfx':
      return t('Describe a sound, e.g. rain on a tin roof at night…')
    case 'music':
      return t('Describe the song: genre, mood, instruments, lyrics…')
    case 'align':
      return t('Paste the exact script spoken in the audio…')
    case 'transcribe':
    case 'voice-changer':
    case 'isolate':
      return t('Attach an audio or video file, then press Generate.')
    default:
      return t('Enter the text to speak…')
  }
}
