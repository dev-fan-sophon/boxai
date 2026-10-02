import { useEffect, useRef, useState } from 'react'
import { useTranslation } from 'react-i18next'

import { Download, Loader2, Pause, Play } from '@/components/icons'
import { Button } from '@/components/ui/button'
import { fetchGeneratedMedia } from '@/features/playground/lib/download-generated-media'
import { cn } from '@/lib/utils'

import { formatClock } from '../../lib/transcript'

const BAR_COUNT = 56
/** Decoded peaks per source, so re-renders and remounts do not re-decode. */
const peakCache = new Map<string, WaveformBar[]>()

type WaveformBar = { position: number; peak: number }

/** Normalized peak amplitude of `count` equal slices of the first channel. */
function computePeaks(buffer: AudioBuffer, count: number): WaveformBar[] {
  const data = buffer.getChannelData(0)
  const slice = Math.max(1, Math.floor(data.length / count))
  const peaks: number[] = []
  for (let bar = 0; bar < count; bar += 1) {
    let peak = 0
    const end = Math.min(data.length, (bar + 1) * slice)
    for (let index = bar * slice; index < end; index += 16) {
      peak = Math.max(peak, Math.abs(data[index]))
    }
    peaks.push(peak)
  }
  const loudest = Math.max(...peaks, 0.01)
  return peaks.map((peak, position) => ({
    position,
    peak: Math.max(0.06, peak / loudest),
  }))
}

/**
 * Waveform of the clip, decoded once it scrolls into view. Returns null
 * until it is ready (or when decoding fails), so callers fall back to a
 * plain progress bar.
 */
function useWaveform(src: string, target: React.RefObject<HTMLElement | null>) {
  const [peaks, setPeaks] = useState<WaveformBar[] | null>(
    () => peakCache.get(src) ?? null
  )

  useEffect(() => {
    if (peakCache.has(src)) {
      setPeaks(peakCache.get(src) ?? null)
      return
    }
    const element = target.current
    if (!element || typeof IntersectionObserver === 'undefined') return
    let cancelled = false
    const observer = new IntersectionObserver((entries) => {
      if (!entries.some((entry) => entry.isIntersecting)) return
      observer.disconnect()
      void fetchGeneratedMedia(src)
        .then((blob) => blob.arrayBuffer())
        .then(async (bytes) => {
          const context = new AudioContext()
          try {
            return await context.decodeAudioData(bytes)
          } finally {
            void context.close()
          }
        })
        .then((buffer) => {
          const computed = computePeaks(buffer, BAR_COUNT)
          peakCache.set(src, computed)
          if (!cancelled) setPeaks(computed)
        })
        .catch(() => {
          // Undecodable or unreachable: the progress bar stays.
        })
    })
    observer.observe(element)
    return () => {
      cancelled = true
      observer.disconnect()
    }
  }, [src, target])

  return peaks
}

/**
 * Player for one generated clip: play/pause, a seekable waveform (or
 * progress bar), elapsed / total time and download.
 */
export function AudioPlayer(props: {
  src: string
  caption?: string
  downloading: boolean
  onDownload: () => void
}) {
  const { t } = useTranslation()
  const audioRef = useRef<HTMLAudioElement>(null)
  const trackRef = useRef<HTMLDivElement>(null)
  const [playing, setPlaying] = useState(false)
  const [current, setCurrent] = useState(0)
  const [duration, setDuration] = useState(0)
  const [failed, setFailed] = useState(false)
  const peaks = useWaveform(props.src, trackRef)
  const progress = duration > 0 ? Math.min(1, current / duration) : 0

  const toggle = () => {
    const audio = audioRef.current
    if (!audio) return
    if (audio.paused) {
      void audio.play().catch(() => setFailed(true))
    } else {
      audio.pause()
    }
  }

  const seekTo = (fraction: number) => {
    const audio = audioRef.current
    if (!audio || !duration) return
    audio.currentTime = Math.min(1, Math.max(0, fraction)) * duration
    setCurrent(audio.currentTime)
  }

  return (
    <div className='border-border/70 bg-muted/30 generation-result-enter flex items-center gap-2.5 rounded-xl border p-2.5'>
      <Button
        type='button'
        size='icon'
        className='size-9 shrink-0 rounded-full'
        aria-label={playing ? t('Pause') : t('Play')}
        disabled={failed}
        onClick={toggle}
      >
        {playing ? <Pause className='size-4' /> : <Play className='size-4' />}
      </Button>
      <div className='min-w-0 flex-1 space-y-1'>
        {props.caption && (
          <p className='text-muted-foreground text-2xs line-clamp-1'>
            {props.caption}
          </p>
        )}
        <div
          ref={trackRef}
          role='slider'
          tabIndex={0}
          aria-label={t('Seek')}
          aria-valuemin={0}
          aria-valuemax={Math.round(duration)}
          aria-valuenow={Math.round(current)}
          aria-valuetext={`${formatClock(current)} / ${formatClock(duration)}`}
          className='focus-visible:ring-ring relative flex h-8 cursor-pointer items-center rounded-md outline-none focus-visible:ring-2'
          onClick={(event) => {
            const box = event.currentTarget.getBoundingClientRect()
            seekTo((event.clientX - box.left) / box.width)
          }}
          onKeyDown={(event) => {
            if (event.key === 'ArrowRight') seekTo((current + 5) / duration)
            if (event.key === 'ArrowLeft') seekTo((current - 5) / duration)
            if (event.key === ' ' || event.key === 'Enter') {
              event.preventDefault()
              toggle()
            }
          }}
        >
          {peaks ? (
            <div className='flex h-full w-full items-center gap-px'>
              {peaks.map((bar) => (
                <span
                  key={bar.position}
                  className={cn(
                    'transition-ui duration-control flex-1 rounded-full',
                    (bar.position + 0.5) / peaks.length <= progress
                      ? 'bg-primary'
                      : 'bg-foreground/20'
                  )}
                  style={{ height: `${Math.round(bar.peak * 100)}%` }}
                />
              ))}
            </div>
          ) : (
            <div className='bg-foreground/15 relative h-1 w-full overflow-hidden rounded-full'>
              <div
                className='bg-primary absolute inset-0 origin-left rounded-full'
                style={{ transform: `scaleX(${progress})` }}
              />
            </div>
          )}
        </div>
        <p className='text-muted-foreground text-3xs flex justify-between tabular-nums'>
          <span>{formatClock(current)}</span>
          <span>
            {failed ? t('Cannot play this audio.') : formatClock(duration)}
          </span>
        </p>
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
        {props.downloading ? (
          <Loader2 className='size-3.5 animate-spin' />
        ) : (
          <Download className='size-3.5' />
        )}
      </Button>
      {/* oxlint-disable-next-line jsx-a11y/media-has-caption -- generated audio has no caption track */}
      <audio
        ref={audioRef}
        src={props.src}
        preload='metadata'
        className='hidden'
        onPlay={() => setPlaying(true)}
        onPause={() => setPlaying(false)}
        onEnded={() => setPlaying(false)}
        onError={() => setFailed(true)}
        onTimeUpdate={(event) => setCurrent(event.currentTarget.currentTime)}
        onLoadedMetadata={(event) => {
          const seconds = event.currentTarget.duration
          setDuration(Number.isFinite(seconds) ? seconds : 0)
        }}
        onDurationChange={(event) => {
          const seconds = event.currentTarget.duration
          if (Number.isFinite(seconds)) setDuration(seconds)
        }}
      />
    </div>
  )
}
