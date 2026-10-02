import { useQueries } from '@tanstack/react-query'
import {
  FolderDown,
  Grid2x2,
  Grid3x3,
  ListChecks,
  Loader2,
  PenLine,
  RefreshCcw,
  Sparkles,
  Square,
  SquareCheck,
  X,
} from 'lucide-react'
import { useReducedMotion } from 'motion/react'
import { useEffect, useMemo, useRef, useState } from 'react'
import { useTranslation } from 'react-i18next'
import { toast } from 'sonner'

import { Button } from '@/components/ui/button'
import {
  Tooltip,
  TooltipContent,
  TooltipTrigger,
} from '@/components/ui/tooltip'
import {
  MediaLightbox,
  type LightboxItem,
} from '@/features/playground/components/media/media-lightbox'
import { videoTaskQueryOptions } from '@/features/playground/hooks/use-video-task-result'
import {
  downloadGeneratedMedia,
  downloadGeneratedMediaZip,
} from '@/features/playground/lib/download-generated-media'
import type { StudioRunSummary } from '@/features/playground/lib/session/session-types'
import type { StudioFeedDensity } from '@/features/playground/lib/storage/store-migration'
import {
  ratioFromSize,
  type StudioFeedBatch,
} from '@/features/playground/lib/studio/studio-feed'
import {
  EMPTY_STUDIO_SELECTION,
  clickStudioSelection,
  selectableStudioImages,
  toggleStudioSelectionGroup,
  type StudioSelection,
} from '@/features/playground/lib/studio/studio-selection'
import { cn } from '@/lib/utils'
import { usePlaygroundStore } from '@/stores/playground-store'

import { parseTranscript } from '../../lib/transcript'
import { StudioSelectionBar } from './studio-selection-bar'
import {
  AudioResultRow,
  ImageResultTile,
  PendingTile,
  VideoResultTile,
} from './studio-tiles'

type StudioModalityKind = 'image' | 'video' | 'audio'

type ResultImage = { url: string; assetId?: number }

type StudioFeedProps = {
  modality: StudioModalityKind
  batches: StudioFeedBatch[]
  /** Loads the batch's prompt(s) back into the composer, one per line. */
  onReusePrompt: (prompt: string) => void
  /** Queues the same jobs again with the current settings. */
  onRerun: (prompts: string[]) => void
  onUseAsReference?: (image: ResultImage) => void
  /** Adds several results as composer references (capped at the limit). */
  onUseAsReferences?: (images: ResultImage[]) => void
  /** New batch of the result's prompt, editing from that image. */
  onVary?: (image: ResultImage & { prompt?: string }) => void
  /** Seeds the next video run with a finished video's last frame. */
  onContinueFromFrame?: (frameUrl: string) => void
  onSendToCanvas: (runs: StudioRunSummary[]) => void
  sendingToCanvas: boolean
  onRetry: (clientIds: string[]) => void
  onCancelQueued: (clientIds: string[]) => void
  onDismiss: (clientIds: string[]) => void
}

const GRID_BY_DENSITY: Record<
  'image' | 'video',
  Record<StudioFeedDensity, string>
> = {
  image: {
    compact: 'grid-cols-[repeat(auto-fill,minmax(7.5rem,1fr))]',
    comfortable: 'grid-cols-[repeat(auto-fill,minmax(11rem,1fr))]',
    large: 'grid-cols-[repeat(auto-fill,minmax(18rem,1fr))]',
  },
  video: {
    compact: 'grid-cols-[repeat(auto-fill,minmax(12rem,1fr))]',
    comfortable: 'grid-cols-[repeat(auto-fill,minmax(18rem,1fr))]',
    large: 'grid-cols-1 max-w-3xl',
  },
}

const DENSITY_OPTIONS: Array<{
  value: StudioFeedDensity
  labelKey: string
  Icon: typeof Grid3x3
}> = [
  { value: 'compact', labelKey: 'Compact grid', Icon: Grid3x3 },
  { value: 'comfortable', labelKey: 'Comfortable grid', Icon: Grid2x2 },
  { value: 'large', labelKey: 'Large tiles', Icon: Square },
]

function formatBatchTime(timestamp?: number): string {
  if (!timestamp || !Number.isFinite(timestamp)) return ''
  const date = new Date(timestamp)
  const sameDay = new Date().toDateString() === date.toDateString()
  return new Intl.DateTimeFormat(undefined, {
    ...(sameDay ? {} : { month: 'short', day: 'numeric' }),
    hour: '2-digit',
    minute: '2-digit',
  }).format(date)
}

function batchRatio(modality: StudioModalityKind, batch: StudioFeedBatch) {
  if (modality === 'image') {
    return ratioFromSize(batch.settings?.imageSize) ?? 1
  }
  return ratioFromSize(batch.settings?.videoAspectRatio) ?? 16 / 9
}

/**
 * Chronological generation feed: one card per batch, newest at the bottom.
 * Each card is a contact sheet — finished results and in-flight jobs share
 * one grid, so a 10-image batch fills in place as results arrive.
 */
export function StudioFeed(props: StudioFeedProps) {
  const { t } = useTranslation()
  const shouldReduce = useReducedMotion()
  const anchorRef = useRef<HTMLDivElement>(null)
  const density = usePlaygroundStore((state) => state.ui.feedDensity)
  const setFeedDensity = usePlaygroundStore((state) => state.setFeedDensity)
  const [downloading, setDownloading] = useState('')
  const [lightbox, setLightbox] = useState<{
    items: LightboxItem[]
    index: number
  } | null>(null)
  const [selectModeOn, setSelectModeOn] = useState(false)
  const [selection, setSelection] = useState<StudioSelection>(
    EMPTY_STUDIO_SELECTION
  )
  const taskIds = [
    ...new Set(
      props.modality === 'video'
        ? props.batches.flatMap((batch) =>
            batch.runs.flatMap((run) =>
              !run.resultUrl && run.taskId ? [run.taskId] : []
            )
          )
        : []
    ),
  ]
  const tasks = useQueries({ queries: taskIds.map(videoTaskQueryOptions) })
  const successfulTasks = new Set(
    taskIds.filter((_, index) => tasks[index].data?.status === 'SUCCESS')
  )

  // Multi-select covers finished images; reading the selection back through
  // the current feed drops runs that left it (session switch, history trim).
  const canSelect = props.modality === 'image'
  const selectable = useMemo(
    () => (canSelect ? selectableStudioImages(props.batches) : []),
    [canSelect, props.batches]
  )
  const selectMode = selectModeOn && selectable.length > 0
  // Leaving the image feed (or emptying it) ends select mode for good.
  if (selectModeOn && selectable.length === 0) {
    setSelectModeOn(false)
    setSelection(EMPTY_STUDIO_SELECTION)
  }
  const selectionOrder = useMemo(
    () => selectable.map((run) => run.id),
    [selectable]
  )
  const selectedRuns = selectMode
    ? selectable.filter((run) => selection.ids.has(run.id))
    : []

  const exitSelectMode = () => {
    setSelectModeOn(false)
    setSelection(EMPTY_STUDIO_SELECTION)
  }

  const clickSelect = (id: number, range: boolean) => {
    setSelectModeOn(true)
    setSelection((current) =>
      clickStudioSelection(current, selectionOrder, id, range)
    )
  }

  const lightboxOpen = lightbox != null
  useEffect(() => {
    if (!selectMode || lightboxOpen) return
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key !== 'Escape' || event.defaultPrevented) return
      setSelectModeOn(false)
      setSelection(EMPTY_STUDIO_SELECTION)
    }
    window.addEventListener('keydown', onKeyDown)
    return () => window.removeEventListener('keydown', onKeyDown)
  }, [selectMode, lightboxOpen])

  const resultCount = props.batches.reduce(
    (sum, batch) => sum + batch.runs.length,
    0
  )
  const activeCount = props.batches.reduce(
    (sum, batch) =>
      sum + batch.pending.filter((job) => job.status !== 'error').length,
    0
  )

  // Follow new batches to the bottom, but leave the scroll alone while a
  // batch streams in so reviewing earlier results is not interrupted.
  const batchCount = props.batches.length
  useEffect(() => {
    anchorRef.current?.scrollIntoView({
      block: 'nearest',
      behavior: shouldReduce ? 'auto' : 'smooth',
    })
  }, [batchCount, shouldReduce])

  const download = async (
    url: string,
    filename: string,
    kind: StudioModalityKind
  ) => {
    setDownloading(filename)
    try {
      await downloadGeneratedMedia(url, filename, kind)
      toast.success(t('Download started'))
    } catch {
      toast.error(t('Download failed'))
    } finally {
      setDownloading('')
    }
  }

  const downloadBatch = async (batch: StudioFeedBatch) => {
    const items = batch.runs.flatMap((run, index) => {
      let url = run.resultUrl
      if (
        !url &&
        props.modality === 'video' &&
        run.taskId &&
        successfulTasks.has(run.taskId)
      ) {
        url = `/v1/videos/${run.taskId}/content`
      }
      if (!url) return []
      return [
        {
          url,
          filename: `${props.modality}-${String(index + 1).padStart(2, '0')}`,
          kind: props.modality,
        },
      ]
    })
    setDownloading(batch.key)
    try {
      const added = await downloadGeneratedMediaZip(
        items,
        `boxai-${props.modality}-${batch.batchId ?? batch.key}`
      )
      toast.success(t('Saved {{count}} files as ZIP', { count: added }))
    } catch {
      toast.error(t('Download failed'))
    } finally {
      setDownloading('')
    }
  }

  const downloadSelected = async () => {
    const items = selectedRuns.map((run, index) => ({
      url: run.resultUrl as string,
      filename: `image-${String(index + 1).padStart(2, '0')}`,
      kind: 'image' as const,
    }))
    setDownloading('selection')
    try {
      const added = await downloadGeneratedMediaZip(
        items,
        `boxai-image-selection-${items.length}`
      )
      toast.success(t('Saved {{count}} files as ZIP', { count: added }))
    } catch {
      toast.error(t('Download failed'))
    } finally {
      setDownloading('')
    }
  }

  return (
    <div className='flex flex-col gap-4'>
      <div className='bg-background/85 supports-backdrop-filter:bg-background/70 sticky top-0 z-20 -mx-1 flex items-center justify-between gap-2 px-1 py-1.5 backdrop-blur-md'>
        <p className='text-muted-foreground text-xs tabular-nums'>
          {t('{{count}} results', { count: resultCount })}
          {activeCount > 0 && (
            <span className='text-foreground/80 ml-2 inline-flex items-center gap-1'>
              <Loader2 className='size-3 animate-spin' aria-hidden='true' />
              {t('{{count}} in progress', { count: activeCount })}
            </span>
          )}
        </p>
        <div className='flex items-center gap-1.5'>
          {canSelect && selectable.length > 0 && (
            <Button
              size='xs'
              variant={selectMode ? 'secondary' : 'ghost'}
              className={cn(!selectMode && 'text-muted-foreground')}
              aria-pressed={selectMode}
              title={t('Select results to download, reuse or send to canvas')}
              onClick={() =>
                selectMode ? exitSelectMode() : setSelectModeOn(true)
              }
            >
              <SquareCheck aria-hidden='true' />
              {selectMode ? t('Done') : t('Select')}
            </Button>
          )}
          {props.modality !== 'audio' && (
            <div
              className='bg-muted/60 flex items-center rounded-lg p-0.5'
              role='radiogroup'
              aria-label={t('Tile size')}
            >
              {DENSITY_OPTIONS.map((option) => (
                <button
                  key={option.value}
                  type='button'
                  role='radio'
                  aria-checked={density === option.value}
                  aria-label={t(option.labelKey)}
                  title={t(option.labelKey)}
                  className={cn(
                    'focus-visible:ring-ring flex size-7 items-center justify-center rounded-md outline-none focus-visible:ring-2',
                    'transition-ui duration-control',
                    density === option.value
                      ? 'bg-background text-foreground shadow-sm'
                      : 'text-muted-foreground hover:text-foreground'
                  )}
                  onClick={() => setFeedDensity(option.value)}
                >
                  <option.Icon className='size-3.5' aria-hidden='true' />
                </button>
              ))}
            </div>
          )}
        </div>
      </div>

      {props.batches.map((batch) => (
        <BatchCard
          key={batch.key}
          batch={batch}
          modality={props.modality}
          density={density}
          downloading={downloading}
          successfulTasks={successfulTasks}
          selectMode={selectMode}
          selectedIds={selection.ids}
          onSelect={canSelect ? clickSelect : undefined}
          onToggleBatchSelection={(ids) =>
            setSelection((current) => toggleStudioSelectionGroup(current, ids))
          }
          onDownload={download}
          onDownloadAll={() => void downloadBatch(batch)}
          onOpenImage={(items, index) => setLightbox({ items, index })}
          onReusePrompt={props.onReusePrompt}
          onRerun={props.onRerun}
          onUseAsReference={props.onUseAsReference}
          onVary={props.onVary}
          onContinueFromFrame={props.onContinueFromFrame}
          onRetry={props.onRetry}
          onCancelQueued={props.onCancelQueued}
          onDismiss={props.onDismiss}
        />
      ))}

      {selectMode && (
        <StudioSelectionBar
          count={selectedRuns.length}
          total={selectable.length}
          downloading={downloading === 'selection'}
          sending={props.sendingToCanvas}
          onDownload={() => void downloadSelected()}
          onUseAsReferences={
            props.onUseAsReferences
              ? () => {
                  props.onUseAsReferences?.(
                    selectedRuns.map((run) => ({
                      url: run.resultUrl as string,
                      assetId: run.assetId,
                    }))
                  )
                  exitSelectMode()
                }
              : undefined
          }
          onSendToCanvas={() => props.onSendToCanvas(selectedRuns)}
          onSelectAll={() =>
            setSelection((current) => ({
              ids: new Set(selectionOrder),
              anchor: current.anchor,
            }))
          }
          onClear={() => setSelection(EMPTY_STUDIO_SELECTION)}
          onDone={exitSelectMode}
        />
      )}

      <div ref={anchorRef} aria-hidden='true' />

      <MediaLightbox
        open={lightbox != null}
        onOpenChange={(open) => {
          if (!open) setLightbox(null)
        }}
        items={lightbox?.items ?? []}
        index={lightbox?.index ?? 0}
        onIndexChange={(index) =>
          setLightbox((state) => (state ? { ...state, index } : state))
        }
        actions={
          props.onUseAsReference || props.onVary
            ? (item) => (
                <>
                  {props.onVary && (
                    <Button
                      size='sm'
                      variant='ghost'
                      className='rounded-full text-white hover:bg-white/15 hover:text-white'
                      onClick={() => {
                        props.onVary?.({
                          url: item.url,
                          assetId: item.assetId,
                          prompt: item.caption,
                        })
                        setLightbox(null)
                      }}
                    >
                      <Sparkles className='size-4' />
                      {t('Vary')}
                    </Button>
                  )}
                  {props.onUseAsReference && (
                    <Button
                      size='sm'
                      variant='ghost'
                      className='rounded-full text-white hover:bg-white/15 hover:text-white'
                      onClick={() => {
                        props.onUseAsReference?.({
                          url: item.url,
                          assetId: item.assetId,
                        })
                        setLightbox(null)
                      }}
                    >
                      <PenLine className='size-4' />
                      {t('Use as reference')}
                    </Button>
                  )}
                </>
              )
            : undefined
        }
      />
    </div>
  )
}

function BatchCard(props: {
  batch: StudioFeedBatch
  modality: StudioModalityKind
  density: StudioFeedDensity
  downloading: string
  successfulTasks: ReadonlySet<string>
  selectMode: boolean
  selectedIds: ReadonlySet<number>
  /** Select-mode click; `range` extends from the last clicked result. */
  onSelect?: (runId: number, range: boolean) => void
  onToggleBatchSelection: (runIds: number[]) => void
  onDownload: (
    url: string,
    filename: string,
    kind: StudioModalityKind
  ) => Promise<void>
  onDownloadAll: () => void
  onOpenImage: (items: LightboxItem[], index: number) => void
  onReusePrompt: (prompt: string) => void
  onRerun: (prompts: string[]) => void
  onUseAsReference?: (image: ResultImage) => void
  onVary?: (image: ResultImage & { prompt?: string }) => void
  onContinueFromFrame?: (frameUrl: string) => void
  onRetry: (clientIds: string[]) => void
  onCancelQueued: (clientIds: string[]) => void
  onDismiss: (clientIds: string[]) => void
}) {
  const { t } = useTranslation()
  const { batch } = props
  const ratio = batchRatio(props.modality, batch)
  const multiPrompt = batch.prompts.length > 1
  const failed = batch.pending.filter((job) => job.status === 'error')
  const queued = batch.pending.filter((job) => job.status === 'queued')
  const total = batch.runs.length + batch.pending.length
  const inFlight = batch.pending.length - failed.length
  const jobPrompts = [
    ...batch.runs.map((run) => run.prompt?.trim() ?? ''),
    ...batch.pending.map((job) => job.input.prompt),
  ].filter(Boolean)
  const timeLabel = formatBatchTime(batch.createdAt)
  // Transcription runs store the transcript as their text; the card title
  // names the file instead of repeating the whole transcript.
  const transcript =
    props.modality === 'audio' ? parseTranscript(batch.prompt) : null
  const title = transcript
    ? `${t('Transcript')} · ${transcript.source}`
    : batch.prompt
  const downloadable = batch.runs.filter(
    (run) =>
      run.resultUrl ||
      (props.modality === 'video' &&
        run.taskId &&
        props.successfulTasks.has(run.taskId))
  ).length

  const images = batch.runs.filter((run) => Boolean(run.resultUrl))
  const lightboxItems: LightboxItem[] = images.map((run, index) => ({
    url: run.resultUrl as string,
    alt: run.prompt || t('Generated image'),
    caption: run.prompt,
    downloadName: `image-run-${Math.abs(run.id) || index + 1}`,
    assetId: run.assetId,
  }))
  const imageIds = images.map((run) => run.id)
  const batchFullySelected =
    imageIds.length > 0 && imageIds.every((id) => props.selectedIds.has(id))

  let gridClass = 'flex flex-col gap-2 max-w-2xl'
  if (props.modality !== 'audio') {
    gridClass = cn(
      'grid gap-2 sm:gap-3',
      GRID_BY_DENSITY[props.modality][props.density]
    )
  }

  const pendingTiles = batch.pending.map((job) => (
    <PendingTile
      key={job.clientId}
      job={job}
      ratio={props.modality === 'audio' ? 6 : ratio}
      showPrompt={multiPrompt}
      onRetry={() => props.onRetry([job.clientId])}
      onCancel={() => props.onCancelQueued([job.clientId])}
      onDismiss={() => props.onDismiss([job.clientId])}
    />
  ))

  return (
    <article className='flex flex-col gap-2.5' aria-busy={inFlight > 0}>
      <header className='flex items-start justify-between gap-2'>
        <div className='min-w-0'>
          <p
            className='text-foreground/90 line-clamp-2 text-sm text-pretty'
            title={transcript ? title : batch.prompts.join('\n')}
          >
            {title || t('(no prompt)')}
            {multiPrompt && (
              <span className='bg-muted text-muted-foreground text-3xs ml-1.5 inline-flex rounded-full px-1.5 py-0.5 align-middle font-medium'>
                {t('+{{count}} prompts', { count: batch.prompts.length - 1 })}
              </span>
            )}
          </p>
          <p className='text-muted-foreground text-2xs mt-0.5 tabular-nums'>
            {[
              batch.model,
              timeLabel,
              total > 1 ? t('{{count}} results', { count: total }) : '',
            ]
              .filter(Boolean)
              .join(' · ')}
          </p>
        </div>
        <div className='flex shrink-0 items-center gap-0.5'>
          {props.selectMode && imageIds.length > 1 && (
            <Button
              size='xs'
              variant={batchFullySelected ? 'secondary' : 'ghost'}
              className={cn(!batchFullySelected && 'text-muted-foreground')}
              aria-pressed={batchFullySelected}
              onClick={() => props.onToggleBatchSelection(imageIds)}
            >
              <ListChecks aria-hidden='true' />
              {batchFullySelected ? t('Deselect batch') : t('Select batch')}
            </Button>
          )}
          {jobPrompts.length > 0 && !transcript && (
            <BatchAction
              label={t('Edit prompt in composer')}
              onClick={() => props.onReusePrompt(batch.prompts.join('\n'))}
            >
              <PenLine className='size-3.5' />
            </BatchAction>
          )}
          {jobPrompts.length > 0 && !transcript && (
            <BatchAction
              label={
                jobPrompts.length > 1
                  ? t('Generate {{count}} again', { count: jobPrompts.length })
                  : t('Generate again')
              }
              onClick={() => props.onRerun(jobPrompts)}
            >
              <RefreshCcw className='size-3.5' />
            </BatchAction>
          )}
          {downloadable > 1 && (
            <BatchAction
              label={t('Download all as ZIP')}
              disabled={props.downloading === batch.key}
              onClick={props.onDownloadAll}
            >
              {props.downloading === batch.key ? (
                <Loader2 className='size-3.5 animate-spin' />
              ) : (
                <FolderDown className='size-3.5' />
              )}
            </BatchAction>
          )}
        </div>
      </header>

      {batch.pending.length > 0 && (
        <BatchProgress
          done={batch.runs.length}
          total={total}
          failed={failed.length}
          queued={queued.length}
          onRetryFailed={() => props.onRetry(failed.map((job) => job.clientId))}
          onCancelQueued={() =>
            props.onCancelQueued(queued.map((job) => job.clientId))
          }
        />
      )}

      <div className={gridClass}>
        {props.modality === 'image' &&
          images.map((run, index) => {
            const url = run.resultUrl as string
            const filename = `image-run-${Math.abs(run.id) || index + 1}`
            return (
              <ImageResultTile
                key={run.id}
                url={url}
                alt={run.prompt || t('Generated image')}
                caption={multiPrompt ? run.prompt : undefined}
                ratio={ratio}
                index={index}
                downloading={props.downloading === filename}
                selectMode={props.selectMode}
                selected={props.selectMode && props.selectedIds.has(run.id)}
                onSelect={
                  props.onSelect
                    ? (range) => props.onSelect?.(run.id, range)
                    : undefined
                }
                onOpen={() => props.onOpenImage(lightboxItems, index)}
                onDownload={() => void props.onDownload(url, filename, 'image')}
                onUseAsReference={
                  props.onUseAsReference
                    ? () =>
                        props.onUseAsReference?.({ url, assetId: run.assetId })
                    : undefined
                }
                onVary={
                  props.onVary && run.prompt?.trim()
                    ? () =>
                        props.onVary?.({
                          url,
                          assetId: run.assetId,
                          prompt: run.prompt,
                        })
                    : undefined
                }
              />
            )
          })}
        {props.modality === 'video' &&
          batch.runs.map((run) => {
            const filename = `video-run-${Math.abs(run.id)}`
            return (
              <VideoResultTile
                key={run.id}
                run={run}
                ratio={ratio}
                caption={multiPrompt ? run.prompt : undefined}
                downloading={props.downloading === filename}
                onDownload={(src) =>
                  void props.onDownload(src, filename, 'video')
                }
                onContinueFromFrame={props.onContinueFromFrame}
              />
            )
          })}
        {props.modality === 'audio' &&
          batch.runs.map((run) => {
            const filename = `audio-run-${Math.abs(run.id)}`
            return (
              <AudioResultRow
                key={run.id}
                run={run}
                caption={multiPrompt ? run.prompt : undefined}
                downloading={props.downloading === filename}
                onDownload={() =>
                  void props.onDownload(
                    run.resultUrl as string,
                    filename,
                    'audio'
                  )
                }
              />
            )
          })}
        {pendingTiles}
      </div>

      {props.modality === 'image' &&
        images.length === 0 &&
        batch.runs.length > 0 &&
        batch.pending.length === 0 && (
          <p className='text-muted-foreground border-border/70 bg-muted/30 rounded-xl border border-dashed px-3 py-4 text-center text-xs'>
            {t('Result is no longer available.')}
          </p>
        )}
    </article>
  )
}

function BatchAction(props: {
  label: string
  disabled?: boolean
  onClick: () => void
  children: React.ReactNode
}) {
  return (
    <Tooltip>
      <TooltipTrigger
        render={
          <Button
            size='icon'
            variant='ghost'
            className='text-muted-foreground hover:text-foreground size-7'
            aria-label={props.label}
            disabled={props.disabled}
            onClick={props.onClick}
          />
        }
      >
        {props.children}
      </TooltipTrigger>
      <TooltipContent>{props.label}</TooltipContent>
    </Tooltip>
  )
}

function BatchProgress(props: {
  done: number
  total: number
  failed: number
  queued: number
  onRetryFailed: () => void
  onCancelQueued: () => void
}) {
  const { t } = useTranslation()
  const fraction = props.total > 0 ? props.done / props.total : 0
  return (
    <div className='flex flex-wrap items-center gap-x-3 gap-y-1.5'>
      <div className='bg-muted relative h-1 w-28 overflow-hidden rounded-full sm:w-40'>
        <div
          className='bg-primary duration-expressive absolute inset-0 origin-left rounded-full transition-transform'
          style={{ transform: `scaleX(${fraction})` }}
        />
      </div>
      <span className='text-muted-foreground text-2xs tabular-nums'>
        {t('{{done}} of {{total}} done', {
          done: props.done,
          total: props.total,
        })}
      </span>
      {props.failed > 0 && (
        <Button
          size='xs'
          variant='outline'
          className='text-destructive border-destructive/30'
          onClick={props.onRetryFailed}
        >
          <RefreshCcw className='size-3' />
          {t('Retry {{count}} failed', { count: props.failed })}
        </Button>
      )}
      {props.queued > 0 && (
        <Button
          size='xs'
          variant='ghost'
          className='text-muted-foreground'
          onClick={props.onCancelQueued}
        >
          <X className='size-3' />
          {t('Cancel {{count}} queued', { count: props.queued })}
        </Button>
      )}
    </div>
  )
}
