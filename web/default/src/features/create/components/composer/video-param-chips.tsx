import {
  Clock,
  Layers,
  ListOrdered,
  Monitor,
  Proportions,
  Volume2,
  VolumeX,
} from 'lucide-react'
import { useTranslation } from 'react-i18next'

import {
  AspectGlyph,
  ParamChip,
  TogglePill,
} from '@/features/playground/components/composer/param-chip'
import {
  getVideoCapabilityMode,
  useVideoCapabilities,
} from '@/features/playground/hooks/use-video-capabilities'
import { BATCH_COUNTS } from '@/features/playground/lib/studio/batch-plan'
import {
  applyResolvedVideoSettings,
  resolveVideoOptions,
  videoDurationOptions,
  videoResolutionsForRatio,
  type VideoAspectRatio,
} from '@/features/playground/lib/studio/video-capabilities'
import type { StudioSettings } from '@/features/playground/types'
import { usePlaygroundStore } from '@/stores/playground-store'

/** Inline video parameters, resolved from the model capability profile. */
export function VideoParamChips(props: { hasImage: boolean }) {
  const { t } = useTranslation()
  const model = usePlaygroundStore((state) => state.config.model)
  const group = usePlaygroundStore((state) => state.config.group)
  const settings = usePlaygroundStore((state) => state.studioSettings)
  const setStudioSettings = usePlaygroundStore(
    (state) => state.setStudioSettings
  )
  const query = useVideoCapabilities(group, model, true)
  const mode = getVideoCapabilityMode(
    props.hasImage,
    settings.videoReferenceMode
  )
  const capabilities = query.data?.[mode]
  if (!capabilities) return null
  const options = resolveVideoOptions(
    capabilities,
    {
      aspectRatio: settings.videoAspectRatio,
      resolution: settings.videoResolution,
      seconds: settings.videoDuration,
      size: settings.videoSize,
      generateAudio: settings.videoGenerateAudio,
      referenceMode: settings.videoReferenceMode,
      count: settings.videoCount,
    },
    { hasImage: props.hasImage, mode }
  )

  const persist = (patch: Partial<StudioSettings>) =>
    setStudioSettings((prev) =>
      applyResolvedVideoSettings(prev, capabilities, patch, {
        hasImage: props.hasImage,
        mode,
      })
    )

  const ratioLabel = (ratio: VideoAspectRatio) =>
    ratio === 'adaptive' ? t('Auto') : ratio

  return (
    <>
      <ParamChip
        icon={<Proportions />}
        ariaLabel={t('Aspect ratio')}
        valueLabel={ratioLabel(options.aspectRatio)}
        value={options.aspectRatio}
        onChange={(aspectRatio) => persist({ videoAspectRatio: aspectRatio })}
        options={capabilities.aspectRatios.map((ratio) => ({
          value: ratio,
          label:
            ratio === 'adaptive' ? t('Auto (match image)') : ratioLabel(ratio),
          glyph: <AspectGlyph size={ratio} />,
        }))}
      />
      <ParamChip
        icon={<Monitor />}
        ariaLabel={t('Resolution')}
        valueLabel={options.resolution}
        value={options.resolution}
        onChange={(resolution) => persist({ videoResolution: resolution })}
        options={videoResolutionsForRatio(
          capabilities,
          options.aspectRatio
        ).map((resolution) => {
          const needsImage =
            capabilities.imageOnlyResolutions.includes(resolution) &&
            !props.hasImage
          return {
            value: resolution,
            label: resolution,
            disabled: needsImage,
            hint: needsImage ? t('Needs a reference image') : undefined,
          }
        })}
      />
      <ParamChip
        icon={<Clock />}
        ariaLabel={t('Duration (seconds)')}
        valueLabel={`${options.duration}s`}
        value={String(options.duration)}
        onChange={(seconds) => persist({ videoDuration: Number(seconds) })}
        options={videoDurationOptions(capabilities).map((duration) => ({
          value: String(duration),
          label: t('{{count}}s', { count: duration }),
        }))}
      />
      {capabilities.supportsAudioToggle ? (
        <TogglePill
          icon={options.generateAudio ? <Volume2 /> : <VolumeX />}
          label={options.generateAudio ? t('Audio') : t('Muted')}
          title={t('Generate audio with the video')}
          active={options.generateAudio}
          onToggle={() =>
            persist({ videoGenerateAudio: !options.generateAudio })
          }
        />
      ) : null}
      <ParamChip
        icon={<Layers />}
        ariaLabel={t('Videos per prompt')}
        valueLabel={`×${options.count}`}
        value={String(options.count)}
        onChange={(count) => persist({ videoCount: Number(count) })}
        options={BATCH_COUNTS.map((count) => ({
          value: String(count),
          label: t('{{count}} videos', { count }),
        }))}
      />
      <TogglePill
        icon={<ListOrdered />}
        label={t('Batch')}
        title={t('Enter several prompts and generate them at once')}
        active={settings.videoBatchMode}
        onToggle={() => persist({ videoBatchMode: !settings.videoBatchMode })}
      />
    </>
  )
}
