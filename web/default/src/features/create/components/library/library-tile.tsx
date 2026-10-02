import { motion } from 'motion/react'
import { useState } from 'react'
import { useTranslation } from 'react-i18next'

import { Download, Repeat2 } from '@/components/icons'
import { Button } from '@/components/ui/button'
import type { PlaygroundRun } from '@/features/playground/api'
import { downloadGeneratedMedia } from '@/features/playground/lib/download-generated-media'
import type { StudioRunSummary } from '@/features/playground/lib/session/session-types'
import { persistedStudioResultUrl } from '@/features/playground/lib/studio/studio-selection'
import { MOTION_SPRING, MOTION_VARIANTS } from '@/lib/motion'

import { parseTranscript } from '../../lib/transcript'
import { AudioPlayer } from '../feed/audio-player'
import { VideoResultTile } from '../feed/studio-tiles'
import { TranscriptCard } from '../feed/transcript-card'

function formatDate(seconds: number): string {
  if (!seconds) return ''
  return new Intl.DateTimeFormat(undefined, {
    month: 'short',
    day: 'numeric',
    hour: '2-digit',
    minute: '2-digit',
  }).format(new Date(seconds * 1000))
}

/** One library result: the media, its prompt, and reuse/download actions. */
export function LibraryTile(props: {
  run: PlaygroundRun
  summary: StudioRunSummary
  onOpen: () => void
  onReuse: () => void
}) {
  const { t } = useTranslation()
  const [downloading, setDownloading] = useState(false)
  const run = props.run
  const persistedUrl = persistedStudioResultUrl(props.summary)
  const transcript =
    run.modality === 'audio' ? parseTranscript(run.prompt) : null

  const download = (src: string, kind: 'image' | 'video' | 'audio') => {
    const extension = { image: 'png', video: 'mp4', audio: 'mp3' }[kind]
    setDownloading(true)
    void downloadGeneratedMedia(
      src,
      `boxai-${run.id}.${extension}`,
      kind
    ).finally(() => setDownloading(false))
  }

  let media: React.ReactNode = null
  if (run.modality === 'image') {
    media = persistedUrl ? (
      <button
        type='button'
        onClick={props.onOpen}
        className='focus-visible:ring-ring block w-full overflow-hidden rounded-xl outline-none focus-visible:ring-2'
        aria-label={t('Open image')}
      >
        <img
          src={persistedUrl}
          alt={run.prompt}
          loading='lazy'
          className='bg-muted duration-page aspect-square w-full object-cover transition-transform group-hover:scale-[1.03]'
        />
      </button>
    ) : (
      <ExpiredResult />
    )
  } else if (run.modality === 'video') {
    media = (
      <VideoResultTile
        run={props.summary}
        ratio={16 / 9}
        downloading={downloading}
        onDownload={(src) => download(src, 'video')}
      />
    )
  } else if (transcript) {
    media = <TranscriptCard transcript={transcript} preview />
  } else if (persistedUrl) {
    media = (
      <AudioPlayer
        src={persistedUrl}
        downloading={downloading}
        onDownload={() => download(persistedUrl, 'audio')}
      />
    )
  } else {
    media = <ExpiredResult />
  }

  return (
    <motion.article
      {...MOTION_VARIANTS.cardItem}
      whileHover={{ y: -2 }}
      transition={MOTION_SPRING.smooth}
      className='group border-border/70 bg-card flex flex-col gap-2.5 rounded-2xl border p-2 shadow-xs'
    >
      {media}
      <div className='flex min-h-0 flex-1 flex-col gap-1.5 px-1'>
        <p className='text-foreground line-clamp-2 text-xs leading-relaxed'>
          {transcript
            ? `${t('Transcript')} · ${transcript.source}`
            : run.prompt || t('No prompt')}
        </p>
        <div className='text-muted-foreground text-2xs mt-auto flex items-center gap-1'>
          <span className='min-w-0 flex-1 truncate font-mono'>{run.model}</span>
          <span className='shrink-0'>{formatDate(run.created_at)}</span>
        </div>
        <div className='flex items-center gap-1'>
          <Button
            variant='ghost'
            size='sm'
            className='h-7 flex-1 gap-1 text-xs'
            onClick={props.onReuse}
          >
            <Repeat2 className='size-3.5' aria-hidden='true' />
            {t('Reuse prompt')}
          </Button>
          {persistedUrl && run.modality === 'image' && (
            <Button
              variant='ghost'
              size='icon'
              className='size-7'
              disabled={downloading}
              aria-label={t('Download')}
              onClick={() => download(persistedUrl, 'image')}
            >
              <Download className='size-3.5' />
            </Button>
          )}
        </div>
      </div>
    </motion.article>
  )
}

function ExpiredResult() {
  const { t } = useTranslation()
  return (
    <p className='border-border/70 bg-muted/30 text-muted-foreground flex aspect-square items-center justify-center rounded-xl border border-dashed px-3 text-center text-xs'>
      {t('Result is no longer available.')}
    </p>
  )
}
