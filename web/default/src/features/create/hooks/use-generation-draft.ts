import { useTranslation } from 'react-i18next'

import {
  getVideoCapabilityMode,
  useVideoCapabilities,
} from '@/features/playground/hooks/use-video-capabilities'
import {
  planGenerationJobs,
  type GenerationJobPlan,
} from '@/features/playground/lib/studio/batch-plan'
import { normalizeImageCount } from '@/features/playground/lib/studio/image-request-schema'
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
  uploading: boolean
}) {
  const { t } = useTranslation()
  const model = usePlaygroundStore((state) => state.config.model)
  const group = usePlaygroundStore((state) => state.config.group)
  const groups = usePlaygroundStore((state) => state.groups)
  const settings = usePlaygroundStore((state) => state.studioSettings)
  const isVideo = input.modality === 'video'
  const signedIn = useAuthStore((state) => Boolean(state.auth.user))
  const hasImage = input.references.length > 0

  const capabilityQuery = useVideoCapabilities(group, model, isVideo)
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

  let maxFiles = 4
  if (isVideo && uploadProfile) {
    maxFiles = getActiveVideoReferenceLimit({
      capabilities: uploadProfile.capabilities,
      referenceMode: uploadProfile.mode,
      disableLastFrame: settings.videoDisableLastFrame,
    })
  } else if (isVideo) {
    maxFiles = 1
  }

  let mediaLabel = t('Reference image')
  if (isVideo && videoOptions?.referenceMode === 'frames') {
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

  // Speech text is spoken verbatim, so it never expands into variants.
  const trimmed = input.text.trim()
  const plan: GenerationJobPlan =
    input.modality === 'audio'
      ? { prompts: trimmed ? [trimmed] : [], truncated: 0 }
      : planGenerationJobs({ text: input.text, batchMode, count })
  const jobCount = plan.prompts.length
  const distinctPrompts = new Set(plan.prompts).size
  const referencesValid = Boolean(
    videoCapabilities && input.references.length <= maxFiles
  )
  // Guests cannot load video options; Generate stays live so the click can
  // open the sign-in prompt instead of looking broken.
  const videoReady =
    !isVideo ||
    !signedIn ||
    Boolean(videoOptions && videoCapabilities && referencesValid)
  const canSubmit =
    !input.uploading && Boolean(model) && jobCount > 0 && videoReady

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
  } else if (isVideo && !referencesValid) {
    videoIssue = t('Remove extra reference images before generating.')
  }

  let placeholder = t('Describe what you want to create…')
  if (input.modality === 'audio') {
    placeholder = t('Enter the text to speak…')
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
      : settings.imageSize,
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
    videoOptions,
    usesLastFrame,
    maxFiles,
    mediaLabel,
    batchMode,
    plan,
    jobCount,
    canSubmit,
    videoIssue,
    placeholder,
    submitLabel,
    planSummary,
    estimateParams,
    showMediaSlot: input.modality === 'image' || isVideo,
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
