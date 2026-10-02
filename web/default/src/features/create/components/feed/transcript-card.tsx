import { Captions, Check, Copy, FileDown, FileText } from 'lucide-react'
import { useState } from 'react'
import { useTranslation } from 'react-i18next'
import { toast } from 'sonner'

import { Button } from '@/components/ui/button'
import { copyToClipboard } from '@/lib/copy-to-clipboard'
import { cn } from '@/lib/utils'

import { languageName } from '../../lib/audio-format'
import {
  formatClock,
  speakerLabel,
  transcriptToSrt,
  transcriptToText,
  type Transcript,
} from '../../lib/transcript'

/** Distinct, theme-safe accents for up to six speakers. */
const SPEAKER_TONES = [
  'text-primary',
  'text-chart-2',
  'text-chart-3',
  'text-chart-4',
  'text-chart-5',
  'text-chart-1',
]

function saveText(content: string, filename: string, type: string) {
  const url = URL.createObjectURL(new Blob([content], { type }))
  const anchor = document.createElement('a')
  anchor.href = url
  anchor.download = filename
  document.body.append(anchor)
  anchor.click()
  anchor.remove()
  URL.revokeObjectURL(url)
}

/**
 * Result of a transcription run: speaker-labelled, timestamped lines with
 * copy and .txt / .srt downloads.
 */
export function TranscriptCard(props: {
  transcript: Transcript
  /** Show only the first lines (library tiles). */
  preview?: boolean
}) {
  const { t, i18n } = useTranslation()
  const [copied, setCopied] = useState(false)
  const transcript = props.transcript
  const speakers = [
    ...new Set(
      transcript.segments.flatMap((segment) =>
        segment.speaker ? [segment.speaker] : []
      )
    ),
  ]
  const baseName = transcript.source.replace(/\.[^.]+$/, '') || 'transcript'
  const srt = transcriptToSrt(transcript, t)
  const visible = props.preview
    ? transcript.segments.slice(0, 4)
    : transcript.segments
  const segments = visible.map((segment, position) => ({
    ...segment,
    id: `${position}:${segment.start ?? ''}`,
  }))

  const copy = async () => {
    const ok = await copyToClipboard(transcriptToText(transcript, t))
    if (!ok) {
      toast.error(t('Copy failed'))
      return
    }
    setCopied(true)
    window.setTimeout(() => setCopied(false), 1600)
  }

  return (
    <div className='border-border/70 bg-card generation-result-enter overflow-hidden rounded-xl border'>
      <div className='border-border/60 flex items-center gap-2 border-b px-3 py-2'>
        <Captions className='text-primary size-4 shrink-0' aria-hidden='true' />
        <p className='text-muted-foreground text-2xs min-w-0 flex-1 truncate'>
          {[
            transcript.source,
            transcript.language
              ? languageName(transcript.language, i18n.language)
              : '',
            speakers.length > 0
              ? t('{{count}} speakers', { count: speakers.length })
              : '',
          ]
            .filter(Boolean)
            .join(' · ')}
        </p>
        {!props.preview && (
          <div className='flex shrink-0 items-center gap-0.5'>
            <Button
              type='button'
              size='icon-sm'
              variant='ghost'
              aria-label={t('Copy transcript')}
              title={t('Copy transcript')}
              onClick={() => void copy()}
            >
              {copied ? (
                <Check className='text-success size-3.5' />
              ) : (
                <Copy className='size-3.5' />
              )}
            </Button>
            <Button
              type='button'
              size='icon-sm'
              variant='ghost'
              aria-label={t('Download .txt')}
              title={t('Download .txt')}
              onClick={() =>
                saveText(
                  transcriptToText(transcript, t),
                  `${baseName}.txt`,
                  'text/plain;charset=utf-8'
                )
              }
            >
              <FileText className='size-3.5' />
            </Button>
            {srt && (
              <Button
                type='button'
                size='icon-sm'
                variant='ghost'
                aria-label={t('Download subtitles (.srt)')}
                title={t('Download subtitles (.srt)')}
                onClick={() =>
                  saveText(srt, `${baseName}.srt`, 'application/x-subrip')
                }
              >
                <FileDown className='size-3.5' />
              </Button>
            )}
          </div>
        )}
      </div>
      <ol
        className={cn(
          'space-y-2 px-3 py-2.5 text-sm leading-relaxed',
          !props.preview && 'max-h-96 overflow-y-auto overscroll-contain'
        )}
      >
        {segments.map((segment) => (
          <li key={segment.id} className='flex gap-2.5'>
            {segment.start !== undefined && (
              <span className='text-muted-foreground text-2xs w-10 shrink-0 pt-0.5 tabular-nums'>
                {formatClock(segment.start)}
              </span>
            )}
            <p className='min-w-0 flex-1 text-pretty'>
              {segment.speaker && (
                <span
                  className={cn(
                    'mr-1.5 text-xs font-semibold',
                    SPEAKER_TONES[
                      speakers.indexOf(segment.speaker) % SPEAKER_TONES.length
                    ]
                  )}
                >
                  {speakerLabel(segment.speaker, t)}
                </span>
              )}
              {segment.text}
            </p>
          </li>
        ))}
      </ol>
      {props.preview && transcript.segments.length > segments.length && (
        <p className='text-muted-foreground text-2xs px-3 pb-2'>
          {t('+{{count}} more lines', {
            count: transcript.segments.length - segments.length,
          })}
        </p>
      )}
    </div>
  )
}
