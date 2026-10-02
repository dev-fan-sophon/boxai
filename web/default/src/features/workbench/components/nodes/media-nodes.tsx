import { useTranslation } from 'react-i18next'
import { useShallow } from 'zustand/react/shallow'

import {
  Gauge,
  Image as ImageIcon,
  Layers,
  Loader2,
  Music,
  Proportions,
  RotateCcw,
} from '@/components/icons'
import { Button } from '@/components/ui/button'
import { Checkbox } from '@/components/ui/checkbox'
import { NativeSelect } from '@/components/ui/native-select'
import { Textarea } from '@/components/ui/textarea'
import {
  AspectGlyph,
  ParamChip,
} from '@/features/playground/components/composer/param-chip'
import {
  IMAGE_COUNTS,
  IMAGE_QUALITIES,
  IMAGE_SIZES,
  AUDIO_FORMATS,
  SPEEDS,
  VOICES,
  imageQualityLabelKey,
} from '@/features/playground/lib/studio/generation-options'
import { normalizeImageGenerationSettings } from '@/features/playground/lib/studio/image-request-schema'
import { cn } from '@/lib/utils'

import { useWorkbenchModels } from '../../hooks/use-workbench-models'
import { useCanvasStore } from '../../store/canvas-store'
import type { CanvasNodeMetadata } from '../../types'
import {
  NodeEmptyMedia,
  NodeModelSelect,
  NodePromptBar,
  NodeSettingsChips,
  NodeStatusOverlay,
  type CanvasNodeBodyProps,
} from './node-shared'

export function ImageNodeBody(props: CanvasNodeBodyProps) {
  const { t } = useTranslation()
  const models = useWorkbenchModels()
  const metadata = props.node.metadata ?? {}
  const batchChildIds = metadata.batchChildIds ?? []
  const updateNodeMetadata = useCanvasStore((state) => state.updateNodeMetadata)
  const experienceMode = useCanvasStore((state) => state.experienceMode)
  const normalized = normalizeImageGenerationSettings({
    imageCount: metadata.count,
    imageSize: metadata.size,
    imageQuality: metadata.quality,
  })
  const hasNatural = Boolean(metadata.naturalWidth && metadata.naturalHeight)
  const naturalAspect =
    hasNatural && metadata.naturalHeight
      ? `${metadata.naturalWidth} / ${metadata.naturalHeight}`
      : undefined

  return (
    <div className='flex h-full min-h-0 flex-col gap-2'>
      <div
        className='bg-muted/30 ring-border/50 relative flex min-h-24 flex-1 items-center justify-center overflow-hidden rounded-xl ring-1 ring-inset'
        style={naturalAspect ? { aspectRatio: naturalAspect } : undefined}
      >
        {metadata.content ? (
          <img
            src={metadata.content}
            alt={props.node.title}
            draggable={false}
            className='max-h-full max-w-full rounded-xl object-contain'
          />
        ) : (
          <NodeEmptyMedia
            icon={<ImageIcon className='size-4' />}
            label={t('Describe the image to generate')}
          />
        )}
        <NodeStatusOverlay
          status={metadata.status}
          errorDetails={metadata.errorDetails}
        />
        {metadata.content && hasNatural ? (
          <span className='bg-background/85 text-foreground/90 text-3xs pointer-events-none absolute top-2 left-2 rounded-full px-2 py-0.5 font-mono shadow-sm backdrop-blur-sm'>
            {metadata.naturalWidth}×{metadata.naturalHeight}
          </span>
        ) : null}
        {batchChildIds.length ? (
          <Button
            size='sm'
            variant='secondary'
            className='text-2xs absolute right-2 bottom-2 h-6 gap-1 rounded-full px-2'
            onPointerDown={(event) => event.stopPropagation()}
            onClick={() =>
              updateNodeMetadata(props.node.id, {
                imageBatchExpanded: !metadata.imageBatchExpanded,
              })
            }
          >
            <Layers className='size-3' />
            {metadata.imageBatchExpanded
              ? t('Collapse batch')
              : t('Spread on canvas')}
          </Button>
        ) : null}
      </div>

      {batchChildIds.length ? (
        <ImageBatchStrip
          rootId={props.node.id}
          childIds={batchChildIds}
          readOnly={props.readOnly}
          onGenerateSlot={props.onGenerateSlot}
        />
      ) : null}

      <NodePromptBar
        value={metadata.prompt ?? ''}
        placeholder={t('Describe the image to generate')}
        isGenerating={props.isGenerating}
        disabled={!metadata.model}
        generateBadge={
          normalized.imageCount > 1 ? `×${normalized.imageCount}` : undefined
        }
        onChange={(prompt) => props.onMetadataChange({ prompt })}
        onGenerate={props.onGenerate}
        onCancel={props.onCancel}
        modality='image'
        nodeId={props.node.id}
      >
        <NodeModelSelect
          value={metadata.model}
          options={models.byModality('image')}
          onChange={(model) => props.onMetadataChange({ model })}
        />
      </NodePromptBar>

      <div
        className='flex shrink-0 flex-wrap items-center gap-1.5'
        data-canvas-no-zoom
      >
        <ParamChip
          icon={<Proportions />}
          ariaLabel={t('Image size')}
          valueLabel={
            normalized.imageSize === 'auto'
              ? t('Auto')
              : normalized.imageSize.replace('x', '×')
          }
          value={normalized.imageSize}
          onChange={(size) => props.onMetadataChange({ size })}
          options={IMAGE_SIZES.map((size) => ({
            value: size,
            label: size === 'auto' ? t('Auto') : size.replace('x', '×'),
            glyph: <AspectGlyph size={size} />,
          }))}
        />
        <ParamChip
          icon={<Gauge />}
          ariaLabel={t('Image quality')}
          valueLabel={t(imageQualityLabelKey(normalized.imageQuality))}
          value={normalized.imageQuality}
          onChange={(quality) => props.onMetadataChange({ quality })}
          options={IMAGE_QUALITIES.map((quality) => ({
            value: quality,
            label: t(imageQualityLabelKey(quality)),
          }))}
        />
        <ParamChip
          icon={<Layers />}
          ariaLabel={t('Images per prompt')}
          valueLabel={`×${normalized.imageCount}`}
          value={String(normalized.imageCount)}
          onChange={(count) => props.onMetadataChange({ count: Number(count) })}
          options={IMAGE_COUNTS.map((count) => ({
            value: String(count),
            label: t('{{count}} images', { count }),
          }))}
        />
      </div>
      <div
        className={
          experienceMode === 'professional'
            ? 'flex shrink-0 flex-wrap items-center gap-3'
            : 'hidden'
        }
        data-canvas-no-zoom
      >
        <label className='text-2xs flex items-center gap-1'>
          <Checkbox
            checked={Boolean(metadata.freeResize)}
            onCheckedChange={(checked) =>
              props.onMetadataChange({ freeResize: checked === true })
            }
          />
          {t('Free resize')}
        </label>
        <label
          className='text-2xs flex items-center gap-1'
          title={t(
            'Transparent background is not supported by this generation API.'
          )}
        >
          <Checkbox disabled checked={false} /> {t('Transparent background')}
        </label>
      </div>
    </div>
  )
}

/**
 * Contact sheet for an image batch inside its root node. Every slot shows
 * its own state; clicking a finished child makes it the cover (the image the
 * root passes downstream), clicking a failed slot regenerates just that slot.
 */
function ImageBatchStrip(props: {
  rootId: string
  childIds: string[]
  readOnly?: boolean
  onGenerateSlot?: (slotId: string) => void
}) {
  const { t } = useTranslation()
  const slotIds = [props.rootId, ...props.childIds]
  const slots = useCanvasStore(
    useShallow((state) =>
      slotIds.map(
        (id) => state.nodes.find((node) => node.id === id)?.metadata ?? null
      )
    )
  )
  const updateNodeMetadata = useCanvasStore((state) => state.updateNodeMetadata)
  const done = slots.filter((slot) => slot?.status === 'success').length

  const makeCover = (childId: string, child: CanvasNodeMetadata) => {
    const root = slots[0]
    const coverFields = (source: CanvasNodeMetadata | null) => ({
      content: source?.content,
      assetId: source?.assetId,
      naturalWidth: source?.naturalWidth,
      naturalHeight: source?.naturalHeight,
      status: source?.status,
      errorDetails: source?.errorDetails,
    })
    updateNodeMetadata(props.rootId, coverFields(child))
    updateNodeMetadata(childId, coverFields(root))
  }

  return (
    <div className='flex shrink-0 flex-col gap-1' data-canvas-no-zoom>
      <span className='text-muted-foreground text-3xs px-0.5 tabular-nums'>
        {t('{{done}} of {{total}} done', { done, total: slotIds.length })}
      </span>
      <div
        className='flex items-center gap-1 overflow-x-auto pb-0.5'
        data-canvas-wheel-scroll
      >
        {slotIds.map((slotId, index) => {
          const slot = slots[index]
          const isCover = index === 0
          let label = t('Use as cover')
          if (slot?.status === 'error') label = t('Retry this image')
          if (isCover) label = t('Cover image')
          const canRetry =
            slot?.status === 'error' && !props.readOnly && props.onGenerateSlot
          // The root's own request may still land and would overwrite a
          // swapped-in cover, so covers can only change once it settles.
          const canCover =
            !isCover &&
            slots[0]?.status !== 'loading' &&
            slot?.status === 'success' &&
            slot.content &&
            !props.readOnly
          return (
            <button
              key={slotId}
              type='button'
              title={label}
              aria-label={`${index + 1}: ${label}`}
              disabled={!canRetry && !canCover}
              className={cn(
                'bg-muted/40 relative flex size-10 shrink-0 items-center justify-center overflow-hidden rounded-md ring-1 ring-inset',
                isCover ? 'ring-primary ring-2' : 'ring-border/60',
                slot?.status === 'error' && 'ring-destructive/50',
                'enabled:hover:ring-primary/60 disabled:cursor-default'
              )}
              onPointerDown={(event) => event.stopPropagation()}
              onClick={() => {
                if (canRetry) {
                  props.onGenerateSlot?.(slotId)
                } else if (canCover && slot) {
                  makeCover(slotId, slot)
                }
              }}
            >
              {slot?.content && slot.status !== 'loading' ? (
                <img
                  src={slot.content}
                  alt=''
                  draggable={false}
                  className='size-full object-cover'
                />
              ) : null}
              {slot?.status === 'loading' ? (
                <Loader2 className='text-muted-foreground size-3.5 animate-spin' />
              ) : null}
              {slot?.status === 'error' ? (
                <RotateCcw className='text-destructive size-3.5' />
              ) : null}
            </button>
          )
        })}
      </div>
    </div>
  )
}

export function AudioNodeBody(props: CanvasNodeBodyProps) {
  const { t } = useTranslation()
  const models = useWorkbenchModels()
  const metadata = props.node.metadata ?? {}
  const experienceMode = useCanvasStore((state) => state.experienceMode)

  return (
    <div className='flex h-full min-h-0 flex-col gap-2'>
      <div className='bg-muted/30 ring-border/50 relative flex min-h-14 flex-1 items-center overflow-hidden rounded-xl px-2 ring-1 ring-inset'>
        {metadata.content ? (
          <audio
            src={metadata.content}
            controls
            className='w-full'
            onPointerDown={(event) => event.stopPropagation()}
          />
        ) : (
          <NodeEmptyMedia
            icon={<Music className='size-4' />}
            label={t('Enter the text to speak')}
          />
        )}
        <NodeStatusOverlay
          status={metadata.status}
          errorDetails={metadata.errorDetails}
        />
      </div>

      <NodePromptBar
        value={metadata.prompt ?? ''}
        placeholder={t('Enter the text to speak')}
        isGenerating={props.isGenerating}
        disabled={!metadata.model}
        onChange={(prompt) => props.onMetadataChange({ prompt })}
        onGenerate={props.onGenerate}
        onCancel={props.onCancel}
        modality='audio'
        nodeId={props.node.id}
      >
        <NodeModelSelect
          value={metadata.model}
          options={models.byModality('audio')}
          onChange={(model) => props.onMetadataChange({ model })}
        />
      </NodePromptBar>
      <NodeSettingsChips
        items={[
          metadata.audioVoice ?? 'alloy',
          metadata.audioFormat ?? 'mp3',
          `${metadata.audioSpeed ?? '1'}×`,
        ]}
      />
      <div
        className={
          experienceMode === 'professional'
            ? 'grid shrink-0 grid-cols-3 gap-2'
            : 'hidden'
        }
        data-canvas-no-zoom
      >
        <NativeSelect
          size='sm'
          value={metadata.audioVoice ?? 'alloy'}
          onChange={(event) =>
            props.onMetadataChange({ audioVoice: event.target.value })
          }
        >
          {VOICES.map((voice) => (
            <option key={voice}>{voice}</option>
          ))}
        </NativeSelect>
        <NativeSelect
          size='sm'
          value={metadata.audioFormat ?? 'mp3'}
          onChange={(event) =>
            props.onMetadataChange({ audioFormat: event.target.value })
          }
        >
          {AUDIO_FORMATS.map((format) => (
            <option key={format}>{format}</option>
          ))}
        </NativeSelect>
        <NativeSelect
          size='sm'
          value={metadata.audioSpeed ?? '1'}
          onChange={(event) =>
            props.onMetadataChange({ audioSpeed: event.target.value })
          }
        >
          {SPEEDS.map((speed) => (
            <option key={speed} value={speed}>
              {speed}×
            </option>
          ))}
        </NativeSelect>
      </div>
      {experienceMode === 'professional' ? (
        <Textarea
          value={metadata.audioInstructions ?? ''}
          placeholder={t('Voice instructions')}
          rows={2}
          className='min-h-10 shrink-0 resize-none text-xs'
          onChange={(event) =>
            props.onMetadataChange({ audioInstructions: event.target.value })
          }
        />
      ) : null}
    </div>
  )
}
