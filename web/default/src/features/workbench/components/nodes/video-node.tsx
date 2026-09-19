import {
  Clock,
  ImagePlus,
  Layers,
  ListOrdered,
  Monitor,
  Proportions,
  Video,
  Volume2,
  VolumeX,
  X,
} from 'lucide-react'
import { useRef } from 'react'
import { useTranslation } from 'react-i18next'

import {
  AspectGlyph,
  ParamChip,
  TogglePill,
} from '@/features/playground/components/composer/param-chip'
import {
  MAX_VIDEO_BATCH_JOBS,
  VIDEO_COUNTS,
  getVideoModelCapabilities,
  resolveVideoOptions,
  type VideoAspectRatio,
  type VideoReferenceMode,
} from '@/features/playground/lib/studio/video-capabilities'
import { cn } from '@/lib/utils'

import { useCanvasTheme } from '../../engine/canvas-theme'
import { planVideoBatch } from '../../engine/canvas-video-batch'
import { useCanvasMediaImport } from '../../hooks/use-canvas-media-import'
import { useWorkbenchModels } from '../../hooks/use-workbench-models'
import { useCanvasStore } from '../../store/canvas-store'
import { CanvasNodeType } from '../../types'
import {
  NodeEmptyMedia,
  NodeModelSelect,
  NodePromptBar,
  NodeSettingsChips,
  NodeStatusOverlay,
  type CanvasNodeBodyProps,
} from './node-shared'

type ReferenceEntry = {
  connectionId: string
  nodeId: string
  url: string
  title: string
}

function aspectRatioCss(ratio: VideoAspectRatio): string {
  if (ratio === 'adaptive') return '16 / 9'
  return ratio.replace(':', ' / ')
}

export function VideoNodeBody(props: CanvasNodeBodyProps) {
  const { t } = useTranslation()
  const theme = useCanvasTheme()
  const models = useWorkbenchModels()
  const nodes = useCanvasStore((state) => state.nodes)
  const connections = useCanvasStore((state) => state.connections)
  const removeConnection = useCanvasStore((state) => state.removeConnection)
  const mediaImport = useCanvasMediaImport()
  const fileInputRef = useRef<HTMLInputElement>(null)

  const metadata = props.node.metadata ?? {}
  const capabilities = getVideoModelCapabilities(metadata.model)

  const references = connections.flatMap<ReferenceEntry>((connection) => {
    if (connection.toNodeId !== props.node.id) return []
    const source = nodes.find((node) => node.id === connection.fromNodeId)
    const url = source?.metadata?.content?.trim()
    if (!source || source.type !== CanvasNodeType.Image || !url) return []
    return [
      {
        connectionId: connection.id,
        nodeId: source.id,
        url,
        title: source.title,
      },
    ]
  })

  const options = resolveVideoOptions(
    capabilities,
    {
      aspectRatio: metadata.aspectRatio,
      resolution: metadata.resolution,
      seconds: metadata.seconds,
      size: metadata.size,
      generateAudio: metadata.generateAudio,
      referenceMode: metadata.videoReferenceMode,
      count: metadata.count,
    },
    { hasImage: references.length > 0 }
  )
  const usesLastFrame =
    options.referenceMode === 'frames' &&
    capabilities.supportsLastFrame &&
    !metadata.disableLastFrame
  const frameSlots = usesLastFrame ? 2 : 1
  const activeReferenceLimit =
    options.referenceMode === 'references'
      ? capabilities.maxReferenceImages
      : frameSlots
  const plan = planVideoBatch(props.node)
  const jobCount = plan.prompts.length
  const hasNatural = Boolean(metadata.naturalWidth && metadata.naturalHeight)
  const naturalAspect =
    hasNatural && metadata.naturalHeight
      ? `${metadata.naturalWidth} / ${metadata.naturalHeight}`
      : undefined
  const missingRequiredImage =
    capabilities.requiresImage && references.length === 0

  const referenceRole = (index: number): string => {
    if (options.referenceMode === 'references') return `${index + 1}`
    if (index === 0) return t('First')
    if (index === 1 && usesLastFrame) return t('Last')
    return '—'
  }

  const ratioLabel = (ratio: VideoAspectRatio) =>
    ratio === 'adaptive' ? t('Auto') : ratio

  const referenceSummary = (): string => {
    if (missingRequiredImage) return t('This model needs a reference image')
    if (options.referenceMode === 'references') {
      return t('{{count}} of {{max}} reference images', {
        count: Math.min(references.length, activeReferenceLimit),
        max: capabilities.maxReferenceImages,
      })
    }
    return usesLastFrame ? t('First and last frame') : t('First frame')
  }

  return (
    <div className='flex h-full min-h-0 flex-col gap-2'>
      <div className='bg-muted/30 ring-border/50 relative flex min-h-24 flex-1 items-center justify-center overflow-hidden rounded-xl ring-1 ring-inset'>
        {metadata.content ? (
          <video
            src={metadata.content}
            controls
            className='max-h-full max-w-full rounded-xl object-contain'
            style={naturalAspect ? { aspectRatio: naturalAspect } : undefined}
            onPointerDown={(event) => event.stopPropagation()}
          />
        ) : (
          <div
            className='border-border/60 flex max-h-full max-w-full items-center justify-center rounded-lg border border-dashed'
            style={{
              aspectRatio: aspectRatioCss(options.aspectRatio),
              width: '82%',
            }}
          >
            <NodeEmptyMedia
              icon={<Video className='size-4' />}
              label={
                missingRequiredImage
                  ? t('Add a reference image, then describe the motion')
                  : t('Describe the video to generate')
              }
            />
          </div>
        )}
        <NodeStatusOverlay
          status={metadata.status}
          taskStatus={metadata.taskStatus}
          progress={metadata.taskProgress}
          errorDetails={metadata.errorDetails}
        />
        {metadata.content && hasNatural ? (
          <span className='bg-background/85 text-foreground/90 pointer-events-none absolute top-2 left-2 rounded-full px-2 py-0.5 font-mono text-[10px] shadow-sm backdrop-blur-sm'>
            {metadata.naturalWidth}×{metadata.naturalHeight}
          </span>
        ) : null}
        {metadata.content ? (
          <div className='absolute bottom-2 left-2'>
            <NodeSettingsChips
              items={[
                ratioLabel(options.aspectRatio),
                options.resolution,
                `${options.duration}s`,
              ]}
            />
          </div>
        ) : null}
      </div>

      <div className='flex shrink-0 flex-col gap-1'>
        <div
          className='flex items-center gap-1.5 overflow-x-auto'
          data-canvas-no-zoom
          data-canvas-wheel-scroll
        >
          {references.map((reference, index) => {
            const unused = index >= activeReferenceLimit
            return (
              <div
                key={reference.connectionId}
                className={cn(
                  'group/ref relative size-11 shrink-0 overflow-hidden rounded-lg ring-1 ring-inset',
                  unused ? 'ring-border/40 opacity-45' : 'ring-border/70'
                )}
                title={
                  unused
                    ? t('Not sent: {{title}} exceeds what this model accepts', {
                        title: reference.title,
                      })
                    : reference.title
                }
              >
                <img
                  src={reference.url}
                  alt={reference.title}
                  draggable={false}
                  className='size-full object-cover'
                />
                <span className='bg-background/85 text-foreground/90 pointer-events-none absolute bottom-0.5 left-0.5 rounded px-1 text-[9px] font-semibold backdrop-blur-sm'>
                  {referenceRole(index)}
                </span>
                {props.readOnly ? null : (
                  <button
                    type='button'
                    aria-label={t('Remove reference')}
                    title={t('Remove reference')}
                    className='bg-background/90 text-foreground absolute top-0.5 right-0.5 hidden size-4 items-center justify-center rounded-full shadow-sm group-hover/ref:flex'
                    onPointerDown={(event) => event.stopPropagation()}
                    onClick={() => removeConnection(reference.connectionId)}
                  >
                    <X className='size-2.5' />
                  </button>
                )}
              </div>
            )
          })}
          {props.readOnly ? null : (
            <button
              type='button'
              title={t('Add reference images')}
              aria-label={t('Add reference images')}
              className={cn(
                'flex size-11 shrink-0 flex-col items-center justify-center gap-0.5 rounded-lg border border-dashed text-[9px] transition-colors',
                missingRequiredImage
                  ? 'border-amber-500/60 text-amber-600 hover:bg-amber-500/10'
                  : 'border-border/70 text-muted-foreground hover:text-foreground hover:bg-foreground/5'
              )}
              onPointerDown={(event) => event.stopPropagation()}
              onClick={() => fileInputRef.current?.click()}
            >
              <ImagePlus className='size-4' />
              {t('Add')}
            </button>
          )}
          <input
            ref={fileInputRef}
            type='file'
            accept='image/*'
            multiple={capabilities.maxReferenceImages > 1 || usesLastFrame}
            className='hidden'
            onChange={(event) => {
              const files = [...(event.target.files ?? [])]
              event.target.value = ''
              if (!files.length) return
              void mediaImport.attachReferenceImages(props.node.id, files)
            }}
          />
        </div>
        <div className='flex items-center gap-2'>
          <span
            className='min-w-0 flex-1 truncate text-[10px]'
            style={{ color: theme.node.muted }}
          >
            {referenceSummary()}
          </span>
          {capabilities.maxReferenceImages > 1 ? (
            <div
              className='bg-foreground/5 flex shrink-0 rounded-full p-0.5 text-[10px] font-medium'
              role='radiogroup'
              aria-label={t('Reference mode')}
            >
              {(['frames', 'references'] as VideoReferenceMode[]).map(
                (mode) => (
                  <button
                    key={mode}
                    type='button'
                    role='radio'
                    aria-checked={options.referenceMode === mode}
                    className={cn(
                      'rounded-full px-2 py-0.5 transition-colors',
                      options.referenceMode === mode
                        ? 'bg-background text-foreground shadow-sm'
                        : 'text-muted-foreground hover:text-foreground'
                    )}
                    onPointerDown={(event) => event.stopPropagation()}
                    onClick={() =>
                      props.onMetadataChange({ videoReferenceMode: mode })
                    }
                  >
                    {mode === 'frames' ? t('Frames') : t('References')}
                  </button>
                )
              )}
            </div>
          ) : null}
          {options.referenceMode === 'frames' &&
          capabilities.supportsLastFrame &&
          references.length > 1 ? (
            <label
              className='flex shrink-0 items-center gap-1 text-[10px]'
              style={{ color: theme.node.muted }}
              onPointerDown={(event) => event.stopPropagation()}
            >
              <input
                type='checkbox'
                className='size-3'
                checked={!metadata.disableLastFrame}
                onChange={(event) =>
                  props.onMetadataChange({
                    disableLastFrame: !event.target.checked,
                  })
                }
              />
              {t('Last frame')}
            </label>
          ) : null}
        </div>
      </div>

      <NodePromptBar
        value={
          metadata.videoBatchMode
            ? (metadata.videoBatchPrompts ?? '')
            : (metadata.prompt ?? '')
        }
        placeholder={
          metadata.videoBatchMode
            ? t('One prompt per line (up to {{max}} videos)', {
                max: MAX_VIDEO_BATCH_JOBS,
              })
            : t('Describe the video to generate')
        }
        rows={metadata.videoBatchMode ? 5 : 2}
        isGenerating={props.isGenerating}
        disabled={!metadata.model}
        generateBadge={
          jobCount > 1 ? t('{{count}} videos', { count: jobCount }) : undefined
        }
        onChange={(value) =>
          props.onMetadataChange(
            metadata.videoBatchMode
              ? { videoBatchPrompts: value }
              : { prompt: value }
          )
        }
        onGenerate={props.onGenerate}
        onCancel={props.onCancel}
        modality='video'
        nodeId={props.node.id}
      >
        <NodeModelSelect
          value={metadata.model}
          options={models.byModality('video')}
          onChange={(model) => props.onMetadataChange({ model })}
        />
      </NodePromptBar>

      <div
        className='flex shrink-0 flex-wrap items-center gap-1.5'
        data-canvas-no-zoom
      >
        <ParamChip
          icon={<Proportions />}
          ariaLabel={t('Aspect ratio')}
          valueLabel={ratioLabel(options.aspectRatio)}
          value={options.aspectRatio}
          onChange={(aspectRatio) => props.onMetadataChange({ aspectRatio })}
          options={capabilities.aspectRatios.map((ratio) => ({
            value: ratio,
            label:
              ratio === 'adaptive'
                ? t('Auto (match image)')
                : ratioLabel(ratio),
            glyph: <AspectGlyph size={ratio} />,
          }))}
        />
        <ParamChip
          icon={<Monitor />}
          ariaLabel={t('Resolution')}
          valueLabel={options.resolution}
          value={options.resolution}
          onChange={(resolution) => props.onMetadataChange({ resolution })}
          options={capabilities.resolutions.map((resolution) => {
            const needsImage =
              capabilities.imageOnlyResolutions.includes(resolution) &&
              references.length === 0
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
          onChange={(seconds) => props.onMetadataChange({ seconds })}
          options={capabilities.durations.map((duration) => ({
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
              props.onMetadataChange({ generateAudio: !options.generateAudio })
            }
          />
        ) : null}
        <ParamChip
          icon={<Layers />}
          ariaLabel={t('Videos per prompt')}
          valueLabel={`×${options.count}`}
          value={String(options.count)}
          onChange={(count) => props.onMetadataChange({ count: Number(count) })}
          options={VIDEO_COUNTS.map((count) => ({
            value: String(count),
            label: t('{{count}} videos', { count }),
          }))}
        />
        <TogglePill
          icon={<ListOrdered />}
          label={t('Batch')}
          title={t('Enter several prompts and generate them at once')}
          active={Boolean(metadata.videoBatchMode)}
          onToggle={() =>
            props.onMetadataChange(
              metadata.videoBatchMode
                ? { videoBatchMode: false }
                : {
                    videoBatchMode: true,
                    videoBatchPrompts:
                      metadata.videoBatchPrompts || metadata.prompt || '',
                  }
            )
          }
        />
      </div>
    </div>
  )
}
