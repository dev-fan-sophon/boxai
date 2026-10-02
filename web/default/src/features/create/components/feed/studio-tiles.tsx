import {
  AlertCircle,
  Check,
  Clock,
  Download,
  ImageIcon,
  ImagePlus,
  Loader2,
  Music2,
  RefreshCcw,
  Sparkles,
  Video,
  X,
} from 'lucide-react'
import { useEffect, useState } from 'react'
import { useTranslation } from 'react-i18next'

import { Button } from '@/components/ui/button'
import { cn } from '@/lib/utils'

import { useVideoTaskResult } from '@/features/playground/hooks/use-video-task-result'
import { retryGeneratedImage } from '@/features/playground/lib/download-generated-media'
import type { StudioRunSummary } from '@/features/playground/lib/session/session-types'
import type { PendingStudioRun } from '@/features/playground/lib/studio/studio-feed'

function formatElapsed(ms: number): string {
  const totalSec = Math.max(0, Math.floor(ms / 1000))
  const min = Math.floor(totalSec / 60)
  const sec = totalSec % 60
  if (min <= 0) return `${sec}s`
  return `${min}:${String(sec).padStart(2, '0')}`
}

function useElapsedLabel(startedAt?: number): string {
  const [now, setNow] = useState(() => Date.now())
  useEffect(() => {
    if (startedAt == null) return
    const id = window.setInterval(() => setNow(Date.now()), 1000)
    return () => window.clearInterval(id)
  }, [startedAt])
  return startedAt == null ? '' : formatElapsed(now - startedAt)
}

const MODALITY_ICON = { image: ImageIcon, video: Video, audio: Music2 }

const TILE_FRAME =
  'relative w-full overflow-hidden rounded-xl border generation-slot-enter'

/**
 * Placeholder for one job of a batch: queued (cancellable), running (live
 * timer), or failed (retry / dismiss). Occupies the same box its result will,
 * so a streaming batch does not reflow as tiles resolve.
 */
export function PendingTile(props: {
  job: PendingStudioRun
  ratio: number
  showPrompt: boolean
  onRetry: () => void
  onCancel: () => void
  onDismiss: () => void
}) {
  const { t } = useTranslation()
  const { job } = props
  const elapsed = useElapsedLabel(
    job.status === 'running' ? job.startedAt : undefined
  )
  const Icon = MODALITY_ICON[job.input.modality]

  if (job.status === 'error') {
    return (
      <div
        className={cn(
          TILE_FRAME,
          'border-destructive/30 bg-destructive/5 flex flex-col gap-2 p-3'
        )}
        style={{ aspectRatio: props.ratio }}
        role='alert'
      >
        <div className='flex min-h-0 flex-1 items-start gap-1.5'>
          <AlertCircle className='text-destructive mt-0.5 size-3.5 shrink-0' />
          <p
            className='text-destructive line-clamp-4 text-xs text-pretty'
            title={job.error}
          >
            {job.error || t('Generation failed.')}
          </p>
        </div>
        <div className='flex flex-wrap items-center gap-1.5'>
          <Button size='xs' variant='outline' onClick={props.onRetry}>
            <RefreshCcw className='size-3' />
            {t('Retry')}
          </Button>
          <Button
            size='xs'
            variant='ghost'
            className='text-muted-foreground'
            onClick={props.onDismiss}
          >
            {t('Dismiss')}
          </Button>
        </div>
      </div>
    )
  }

  const queued = job.status === 'queued'
  return (
    <div
      className={cn(
        TILE_FRAME,
        queued
          ? 'border-border/70 bg-muted/20 border-dashed'
          : 'border-border/70 bg-muted/40'
      )}
      style={{ aspectRatio: props.ratio }}
      role='status'
      aria-label={
        queued ? t('Queued') : t('Generating… {{elapsed}}', { elapsed })
      }
    >
      {!queued && <div className='skeleton-shimmer absolute inset-0' />}
      {!queued && (
        <div
          className='generation-scanline pointer-events-none absolute inset-x-0 h-1/3 opacity-70'
          aria-hidden='true'
        />
      )}
      <div className='absolute inset-0 flex flex-col items-center justify-center gap-1.5 px-2 text-center'>
        <span
          className={cn(
            'bg-background/50 text-muted-foreground flex size-9 items-center justify-center rounded-full backdrop-blur-sm',
            !queued && 'generation-orb-pulse'
          )}
          aria-hidden='true'
        >
          {queued ? (
            <Clock className='size-4 opacity-70' />
          ) : (
            <Icon className='size-4 opacity-70' />
          )}
        </span>
        <span className='text-muted-foreground text-2xs font-medium tabular-nums'>
          {queued ? t('Queued') : elapsed}
        </span>
      </div>
      {queued && (
        <button
          type='button'
          className='bg-background/80 text-muted-foreground hover:text-foreground focus-visible:ring-ring absolute top-1.5 right-1.5 flex size-6 items-center justify-center rounded-full outline-none focus-visible:ring-2'
          aria-label={t('Cancel')}
          title={t('Cancel')}
          onClick={props.onCancel}
        >
          <X className='size-3.5' />
        </button>
      )}
      {props.showPrompt && (
        <p className='text-muted-foreground text-2xs absolute inset-x-2 bottom-2 line-clamp-1 text-center'>
          {job.input.prompt}
        </p>
      )}
      {!queued && (
        <div className='bg-background/40 absolute inset-x-0 bottom-0 h-0.5 overflow-hidden'>
          <div className='from-primary/10 via-primary to-primary/10 generation-indeterminate absolute inset-y-0 w-1/3 bg-gradient-to-r' />
        </div>
      )}
    </div>
  )
}

function TileActionIcon(props: { downloading: boolean; done: boolean }) {
  if (props.downloading) return <Loader2 className='size-3.5 animate-spin' />
  if (props.done) return <Check className='text-success size-3.5' />
  return <Download className='size-3.5' />
}

/**
 * Finished image in the batch grid. The box starts at the requested ratio and
 * snaps to the natural one on load; click opens the lightbox.
 */
export function ImageResultTile(props: {
  url: string
  alt: string
  caption?: string
  ratio: number
  index: number
  downloading: boolean
  /** In select mode a click toggles selection instead of opening. */
  selectMode?: boolean
  selected?: boolean
  /** `range` is true for a shift-click (extend from the last clicked tile). */
  onSelect?: (range: boolean) => void
  onOpen: () => void
  onDownload: () => void
  onUseAsReference?: () => void
  onVary?: () => void
}) {
  const { t } = useTranslation()
  const [loaded, setLoaded] = useState(false)
  const [natural, setNatural] = useState<{ w: number; h: number } | null>(null)
  const [justDownloaded, setJustDownloaded] = useState(false)

  useEffect(() => {
    if (!justDownloaded) return
    const id = window.setTimeout(() => setJustDownloaded(false), 1600)
    return () => window.clearTimeout(id)
  }, [justDownloaded])

  return (
    <figure
      className={cn(
        TILE_FRAME,
        'border-border/70 bg-muted/40 group generation-result-enter hover:border-border hover:shadow-raised transition-ui duration-control',
        props.selected &&
          'border-primary ring-primary ring-offset-background hover:border-primary ring-2 ring-offset-2'
      )}
      style={{
        aspectRatio: natural ? natural.w / natural.h : props.ratio,
        animationDelay: `${Math.min(props.index, 8) * 50}ms`,
      }}
    >
      {!loaded && <div className='skeleton-shimmer absolute inset-0' />}
      <img
        src={props.url}
        alt={props.alt}
        className={cn(
          'absolute inset-0 size-full object-contain',
          loaded ? 'generation-image-reveal opacity-100' : 'opacity-0'
        )}
        referrerPolicy='no-referrer'
        loading='lazy'
        decoding='async'
        onError={(event) => retryGeneratedImage(event.currentTarget)}
        onLoad={(event) => {
          const image = event.currentTarget
          if (image.naturalWidth > 0 && image.naturalHeight > 0) {
            setNatural({ w: image.naturalWidth, h: image.naturalHeight })
          }
          setLoaded(true)
        }}
      />
      {props.selectMode ? (
        <button
          type='button'
          role='checkbox'
          aria-checked={Boolean(props.selected)}
          aria-label={t('Select image')}
          className='focus-visible:ring-ring absolute inset-0 z-[5] cursor-pointer rounded-xl outline-none focus-visible:ring-2 focus-visible:ring-inset'
          // Shift-click would otherwise extend the page's text selection.
          onMouseDown={(event) => {
            if (event.shiftKey) event.preventDefault()
          }}
          onClick={(event) => props.onSelect?.(event.shiftKey)}
        />
      ) : (
        <button
          type='button'
          className='focus-visible:ring-ring absolute inset-0 z-[5] cursor-zoom-in rounded-xl outline-none focus-visible:ring-2 focus-visible:ring-inset'
          aria-label={t('View full image')}
          onClick={(event) => {
            // Modifier-click starts a selection straight from browsing.
            const modified = event.shiftKey || event.metaKey || event.ctrlKey
            if (modified && props.onSelect) {
              props.onSelect(event.shiftKey)
              return
            }
            props.onOpen()
          }}
        />
      )}
      {props.selectMode && (
        <span
          aria-hidden='true'
          className={cn(
            'pointer-events-none absolute top-2 left-2 z-10 flex size-5 items-center justify-center rounded-full border shadow-sm',
            'transition-ui duration-control',
            props.selected
              ? 'bg-primary border-primary text-primary-foreground'
              : 'bg-background/80 border-border backdrop-blur-sm'
          )}
        >
          {props.selected && <Check className='size-3' strokeWidth={3} />}
        </span>
      )}
      {props.selected && (
        <span
          aria-hidden='true'
          className='bg-primary/10 pointer-events-none absolute inset-0'
        />
      )}
      {natural && !props.selectMode && (
        <span className='bg-background/85 text-foreground/90 text-3xs pointer-events-none absolute top-2 left-2 z-10 rounded-full px-1.5 py-0.5 font-mono opacity-0 shadow-sm backdrop-blur-sm transition-opacity group-hover:opacity-100'>
          {natural.w}×{natural.h}
        </span>
      )}
      <div
        className={cn(
          'pointer-events-none absolute inset-x-0 bottom-0 z-10 flex flex-col gap-1.5 p-1.5',
          'bg-gradient-to-t from-black/60 via-black/25 to-transparent',
          'opacity-100 transition-opacity sm:opacity-0 sm:group-hover:opacity-100 sm:group-focus-within:opacity-100',
          props.selectMode && 'hidden'
        )}
      >
        {props.caption && (
          <figcaption className='text-2xs line-clamp-2 px-1 text-white/90'>
            {props.caption}
          </figcaption>
        )}
        <div className='flex items-center justify-end gap-1'>
          {props.onVary && (
            <Button
              type='button'
              size='icon-sm'
              variant='secondary'
              className='bg-background/90 text-foreground hover:bg-background pointer-events-auto shadow-sm'
              aria-label={t('Vary')}
              title={t('Vary: new batch from this image')}
              onClick={props.onVary}
            >
              <Sparkles className='size-3.5' />
            </Button>
          )}
          {props.onUseAsReference && (
            <Button
              type='button'
              size='icon-sm'
              variant='secondary'
              className='bg-background/90 text-foreground hover:bg-background pointer-events-auto shadow-sm'
              aria-label={t('Use as reference')}
              title={t('Use as reference')}
              onClick={props.onUseAsReference}
            >
              <ImagePlus className='size-3.5' />
            </Button>
          )}
          <Button
            type='button'
            size='icon-sm'
            variant='secondary'
            className='bg-background/90 text-foreground hover:bg-background pointer-events-auto shadow-sm'
            aria-label={t('Download')}
            title={t('Download')}
            disabled={props.downloading}
            onClick={() => {
              props.onDownload()
              setJustDownloaded(true)
            }}
          >
            <TileActionIcon
              downloading={props.downloading}
              done={justDownloaded && !props.downloading}
            />
          </Button>
        </div>
      </div>
    </figure>
  )
}

/** Playable URL for a video run: stored result or confirmed successful task. */
function useVideoRunSource(run: StudioRunSummary) {
  const shouldPoll = !run.resultUrl && Boolean(run.taskId)
  const task = useVideoTaskResult(run.taskId, shouldPoll)
  const src = run.resultUrl || task.resultUrl
  return {
    src,
    ready: Boolean(run.resultUrl) || task.ready,
    failed: task.failed,
    failReason: task.failReason,
    percent: task.percent,
  }
}

export function VideoResultTile(props: {
  run: StudioRunSummary
  ratio: number
  caption?: string
  downloading: boolean
  onDownload: (src: string) => void
}) {
  const { t } = useTranslation()
  const video = useVideoRunSource(props.run)
  const [natural, setNatural] = useState<number | null>(null)

  if (video.failed) {
    return (
      <div
        className={cn(
          TILE_FRAME,
          'border-destructive/30 bg-destructive/5 flex items-start gap-2 p-3'
        )}
        style={{ aspectRatio: props.ratio }}
        role='alert'
      >
        <AlertCircle className='text-destructive mt-0.5 size-4 shrink-0' />
        <p className='text-destructive line-clamp-4 text-xs text-pretty'>
          {video.failReason || t('Video generation failed.')}
        </p>
      </div>
    )
  }

  if (!video.ready || !video.src) {
    const percent =
      typeof video.percent === 'number' && video.percent > 0
        ? Math.min(100, video.percent)
        : null
    return (
      <div
        className={cn(TILE_FRAME, 'border-border/70 bg-muted/40')}
        style={{ aspectRatio: props.ratio }}
        role='status'
        aria-label={t('Rendering video…')}
      >
        <div className='skeleton-shimmer absolute inset-0' />
        <div className='absolute inset-0 flex flex-col items-center justify-center gap-1.5'>
          <Video className='text-muted-foreground size-5' aria-hidden='true' />
          <span className='text-muted-foreground text-2xs font-medium tabular-nums'>
            {percent == null
              ? t('Rendering video…')
              : `${Math.round(percent)}%`}
          </span>
        </div>
        <div className='bg-background/40 absolute inset-x-0 bottom-0 h-0.5 overflow-hidden'>
          {percent == null ? (
            <div className='from-primary/10 via-primary to-primary/10 generation-indeterminate absolute inset-y-0 w-1/3 bg-gradient-to-r' />
          ) : (
            <div
              className='bg-primary duration-expressive absolute inset-0 origin-left transition-transform'
              style={{ transform: `scaleX(${percent / 100})` }}
            />
          )}
        </div>
      </div>
    )
  }

  return (
    <figure className='group flex flex-col gap-1.5'>
      <div
        className={cn(TILE_FRAME, 'border-border/70 bg-black')}
        style={{ aspectRatio: natural ?? props.ratio }}
      >
        <video
          controls
          preload='metadata'
          className='absolute inset-0 size-full'
          src={video.src}
          onLoadedMetadata={(event) => {
            const element = event.currentTarget
            if (element.videoWidth > 0 && element.videoHeight > 0) {
              setNatural(element.videoWidth / element.videoHeight)
            }
          }}
        >
          {t('Your browser does not support video playback.')}
        </video>
      </div>
      <div className='flex items-center gap-1.5'>
        {props.caption ? (
          <figcaption className='text-muted-foreground text-2xs line-clamp-1 min-w-0 flex-1'>
            {props.caption}
          </figcaption>
        ) : (
          <span className='flex-1' />
        )}
        <Button
          type='button'
          size='icon-sm'
          variant='ghost'
          className='text-muted-foreground hover:text-foreground'
          aria-label={t('Download video')}
          title={t('Download video')}
          disabled={props.downloading}
          onClick={() => props.onDownload(video.src)}
        >
          <TileActionIcon downloading={props.downloading} done={false} />
        </Button>
      </div>
    </figure>
  )
}

export function AudioResultRow(props: {
  run: StudioRunSummary
  caption?: string
  downloading: boolean
  onDownload: () => void
}) {
  const { t } = useTranslation()
  if (!props.run.resultUrl) {
    return (
      <p className='text-muted-foreground border-border/70 bg-muted/30 rounded-xl border border-dashed px-3 py-3 text-center text-xs'>
        {t('Result is no longer available.')}
      </p>
    )
  }
  return (
    <div className='border-border/70 bg-muted/30 flex items-center gap-2 rounded-xl border p-2'>
      <div className='min-w-0 flex-1'>
        {props.caption && (
          <p className='text-muted-foreground text-2xs mb-1 line-clamp-1 px-1'>
            {props.caption}
          </p>
        )}
        <audio controls className='h-9 w-full' src={props.run.resultUrl}>
          {t('Your browser does not support audio playback.')}
        </audio>
      </div>
      <Button
        type='button'
        size='icon-sm'
        variant='ghost'
        className='text-muted-foreground hover:text-foreground shrink-0'
        aria-label={t('Download audio')}
        title={t('Download audio')}
        disabled={props.downloading}
        onClick={props.onDownload}
      >
        <TileActionIcon downloading={props.downloading} done={false} />
      </Button>
    </div>
  )
}
