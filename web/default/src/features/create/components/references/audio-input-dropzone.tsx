import { useRef, useState } from 'react'
import { useTranslation } from 'react-i18next'
import { toast } from 'sonner'

import { FileAudio, Upload, X } from '@/components/icons'
import { Button } from '@/components/ui/button'
import { cn } from '@/lib/utils'

import {
  AUDIO_INPUT_ACCEPT,
  isAcceptedAudioInput,
  MAX_AUDIO_INPUT_BYTES,
  registerAudioInput,
} from '../../lib/audio-inputs'
import { formatClock } from '../../lib/transcript'
import type { MediaReference } from './media-reference-slot'

function formatBytes(bytes: number): string {
  if (bytes < 1024 * 1024) return `${Math.max(1, Math.round(bytes / 1024))} KB`
  return `${(bytes / (1024 * 1024)).toFixed(1)} MB`
}

/**
 * Single audio/video input of the file-based audio tools. The file stays in
 * the browser until Generate sends it straight to the provider; the card
 * shows its name, size and length with a preview player.
 */
export function AudioInputDropzone(props: {
  value: MediaReference[]
  onChange: (value: MediaReference[]) => void
  /** Composer variant: a single chip instead of the drop area. */
  compact?: boolean
}) {
  const { t } = useTranslation()
  const inputRef = useRef<HTMLInputElement>(null)
  const [dragging, setDragging] = useState(false)
  const [duration, setDuration] = useState<number | null>(null)
  const current = props.value[0]

  const acceptFile = (file: File | undefined) => {
    if (!file) return
    if (!isAcceptedAudioInput(file)) {
      toast.error(t('Choose an audio or video file.'))
      return
    }
    if (file.size > MAX_AUDIO_INPUT_BYTES) {
      toast.error(
        t('File must be under {{size}}.', {
          size: formatBytes(MAX_AUDIO_INPUT_BYTES),
        })
      )
      return
    }
    setDuration(null)
    props.onChange([
      {
        id: crypto.randomUUID(),
        name: file.name,
        dataUrl: registerAudioInput(file),
        file,
      },
    ])
  }

  const picker = (
    <input
      ref={inputRef}
      type='file'
      accept={AUDIO_INPUT_ACCEPT}
      className='sr-only'
      tabIndex={-1}
      onChange={(event) => {
        acceptFile(event.target.files?.[0])
        event.target.value = ''
      }}
    />
  )

  if (props.compact) {
    return (
      <span className='inline-flex shrink-0 items-center gap-1'>
        <button
          type='button'
          onClick={() => inputRef.current?.click()}
          className={cn(
            'text-2xs focus-visible:ring-ring inline-flex h-8 max-w-44 items-center gap-1.5 rounded-full border px-2.5 font-medium outline-none focus-visible:ring-2',
            current
              ? 'border-primary/40 bg-primary/10 text-primary'
              : 'border-border/80 text-muted-foreground hover:text-foreground'
          )}
          aria-label={current ? current.name : t('Attach audio')}
        >
          <FileAudio className='size-3.5 shrink-0' aria-hidden='true' />
          <span className='truncate'>{current?.name ?? t('Attach audio')}</span>
        </button>
        {current && (
          <Button
            type='button'
            size='icon-sm'
            variant='ghost'
            className='size-7'
            aria-label={`${t('Remove file')}: ${current.name}`}
            onClick={() => props.onChange([])}
          >
            <X className='size-3' />
          </Button>
        )}
        {picker}
      </span>
    )
  }

  if (current) {
    return (
      <div className='border-border/70 bg-muted/30 space-y-2 rounded-xl border p-2.5'>
        <div className='flex items-center gap-2'>
          <span className='bg-primary/10 text-primary flex size-8 shrink-0 items-center justify-center rounded-lg'>
            <FileAudio className='size-4' aria-hidden='true' />
          </span>
          <span className='min-w-0 flex-1'>
            <span className='text-foreground block truncate text-sm font-medium'>
              {current.name}
            </span>
            <span className='text-muted-foreground text-2xs block tabular-nums'>
              {[
                current.file ? formatBytes(current.file.size) : '',
                duration === null ? '' : formatClock(duration),
              ]
                .filter(Boolean)
                .join(' · ')}
            </span>
          </span>
          <Button
            type='button'
            size='xs'
            variant='ghost'
            onClick={() => inputRef.current?.click()}
          >
            {t('Replace')}
          </Button>
          <Button
            type='button'
            size='icon-sm'
            variant='ghost'
            aria-label={`${t('Remove file')}: ${current.name}`}
            onClick={() => props.onChange([])}
          >
            <X className='size-3.5' />
          </Button>
        </div>
        {/* oxlint-disable-next-line jsx-a11y/media-has-caption -- user-supplied input audio */}
        <audio
          controls
          preload='metadata'
          src={current.dataUrl}
          className='h-9 w-full'
          onLoadedMetadata={(event) => {
            const seconds = event.currentTarget.duration
            setDuration(Number.isFinite(seconds) ? seconds : null)
          }}
        />
        {picker}
      </div>
    )
  }

  return (
    <div
      className={cn(
        'border-border/80 transition-ui duration-control flex flex-col items-center justify-center gap-1.5 rounded-xl border border-dashed px-3 py-6 text-center',
        dragging ? 'border-primary bg-primary/5' : 'hover:bg-muted/40'
      )}
      onDragOver={(event) => {
        event.preventDefault()
        setDragging(true)
      }}
      onDragLeave={() => setDragging(false)}
      onDrop={(event) => {
        event.preventDefault()
        setDragging(false)
        acceptFile(event.dataTransfer.files[0])
      }}
    >
      <Upload className='text-muted-foreground size-5' aria-hidden='true' />
      <p className='text-foreground text-sm font-medium'>
        {t('Drop an audio or video file')}
      </p>
      <p className='text-muted-foreground text-2xs'>
        {t('MP3, WAV, M4A, OGG, FLAC, MP4, WEBM · up to {{size}}', {
          size: formatBytes(MAX_AUDIO_INPUT_BYTES),
        })}
      </p>
      <Button
        type='button'
        size='sm'
        variant='outline'
        className='mt-1'
        onClick={() => inputRef.current?.click()}
      >
        {t('Choose file')}
      </Button>
      {picker}
    </div>
  )
}
