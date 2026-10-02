import { motion } from 'motion/react'
import { useState } from 'react'
import { useTranslation } from 'react-i18next'

import {
  ArrowDown,
  ArrowUp,
  Clapperboard,
  RotateCcw,
  Trash2,
} from '@/components/icons'
import { Button } from '@/components/ui/button'
import { Checkbox } from '@/components/ui/checkbox'
import { Textarea } from '@/components/ui/textarea'
import { downloadGeneratedMedia } from '@/features/playground/lib/download-generated-media'
import { MOTION_SPRING } from '@/lib/motion'
import { cn } from '@/lib/utils'
import type { StoryboardScene } from '@/stores/create-store'

import type { SceneProgress } from '../../hooks/use-storyboard'
import { PendingTile, VideoResultTile } from '../feed/studio-tiles'
import {
  MediaReferenceSlot,
  type MediaReference,
} from '../references/media-reference-slot'

const SCENE_RATIO = 16 / 9

function frameReferences(scene: StoryboardScene): MediaReference[] {
  const frame = scene.frame
  if (!frame) return []
  const dataUrl =
    frame.dataUrl ??
    (frame.assetId ? `/api/playground/assets/${frame.assetId}/content` : '')
  if (!dataUrl) return []
  return [{ id: frame.id, name: frame.name, dataUrl, assetId: frame.assetId }]
}

/**
 * One storyboard scene: its first frame, its prompt, and the state of its
 * latest generation — queued, running, failed with a retry, or the video.
 */
export function SceneCard(props: {
  scene: StoryboardScene
  index: number
  total: number
  progress?: SceneProgress
  onChange: (value: Partial<StoryboardScene>) => void
  onRemove: () => void
  onMove: (delta: number) => void
  onGenerate: () => void
  onRetry: (clientIds: string[]) => void
  onCancel: (clientIds: string[]) => void
  onDismiss: (clientIds: string[]) => void
}) {
  const { t } = useTranslation()
  const [downloading, setDownloading] = useState(false)
  const scene = props.scene
  const pendingJob = props.progress?.pending[0]
  const latestRun = props.progress?.runs.at(-1)
  const busy =
    pendingJob?.status === 'queued' || pendingJob?.status === 'running'

  let result: React.ReactNode = (
    <div
      className='border-border/70 bg-muted/30 text-muted-foreground flex flex-col items-center justify-center gap-1.5 rounded-xl border border-dashed text-xs'
      style={{ aspectRatio: SCENE_RATIO }}
    >
      <Clapperboard className='size-5 opacity-60' aria-hidden='true' />
      {t('Not generated yet')}
    </div>
  )
  if (pendingJob) {
    result = (
      <PendingTile
        job={pendingJob}
        ratio={SCENE_RATIO}
        showPrompt={false}
        onRetry={() => props.onRetry([pendingJob.clientId])}
        onCancel={() => props.onCancel([pendingJob.clientId])}
        onDismiss={() => props.onDismiss([pendingJob.clientId])}
      />
    )
  } else if (latestRun) {
    result = (
      <VideoResultTile
        run={latestRun}
        ratio={SCENE_RATIO}
        downloading={downloading}
        onDownload={(src) => {
          setDownloading(true)
          void downloadGeneratedMedia(
            src,
            `scene-${props.index + 1}.mp4`,
            'video'
          ).finally(() => setDownloading(false))
        }}
      />
    )
  }

  return (
    <motion.article
      layout
      initial={{ opacity: 0, scale: 0.97 }}
      animate={{ opacity: 1, scale: 1 }}
      exit={{ opacity: 0, scale: 0.97 }}
      transition={MOTION_SPRING.smooth}
      className={cn(
        'border-border/70 bg-card flex flex-col gap-3 rounded-2xl border p-3 shadow-xs transition-colors',
        scene.selected && 'border-primary/40 ring-primary/15 ring-2'
      )}
      aria-label={t('Scene {{index}}', { index: props.index + 1 })}
    >
      <header className='flex items-center gap-2'>
        <Checkbox
          checked={scene.selected}
          onCheckedChange={(checked) => props.onChange({ selected: checked })}
          aria-label={t('Select scene {{index}}', { index: props.index + 1 })}
        />
        <span className='text-foreground text-xs font-semibold tracking-wide uppercase'>
          {t('Scene {{index}}', { index: props.index + 1 })}
        </span>
        <span className='ml-auto flex items-center gap-0.5'>
          <Button
            size='icon'
            variant='ghost'
            className='text-muted-foreground size-7'
            disabled={props.index === 0}
            aria-label={t('Move up')}
            onClick={() => props.onMove(-1)}
          >
            <ArrowUp className='size-3.5' />
          </Button>
          <Button
            size='icon'
            variant='ghost'
            className='text-muted-foreground size-7'
            disabled={props.index === props.total - 1}
            aria-label={t('Move down')}
            onClick={() => props.onMove(1)}
          >
            <ArrowDown className='size-3.5' />
          </Button>
          <Button
            size='icon'
            variant='ghost'
            className='text-muted-foreground hover:text-destructive size-7'
            aria-label={t('Delete scene')}
            onClick={props.onRemove}
          >
            <Trash2 className='size-3.5' />
          </Button>
        </span>
      </header>

      {result}

      <div className='flex items-start gap-2'>
        <MediaReferenceSlot
          label={t('First frame')}
          value={frameReferences(scene)}
          onChange={(value) => {
            const first = value[0]
            props.onChange({
              frame: first
                ? {
                    id: first.id,
                    name: first.name,
                    assetId: first.assetId,
                    dataUrl: first.dataUrl,
                  }
                : undefined,
            })
          }}
          attachable
          kind='image'
          maxFiles={1}
        />
      </div>

      <Textarea
        value={scene.prompt}
        onChange={(event) => props.onChange({ prompt: event.target.value })}
        placeholder={t('Describe this shot: subject, action, camera…')}
        aria-label={t('Scene {{index}} prompt', { index: props.index + 1 })}
        className='bg-background min-h-24 resize-y text-xs leading-relaxed'
      />

      <Button
        variant={latestRun || pendingJob ? 'outline' : 'default'}
        size='sm'
        className='w-full gap-1.5'
        disabled={busy || !scene.prompt.trim()}
        onClick={props.onGenerate}
      >
        {latestRun || pendingJob?.status === 'error' ? (
          <RotateCcw className='size-3.5' aria-hidden='true' />
        ) : (
          <Clapperboard className='size-3.5' aria-hidden='true' />
        )}
        {latestRun || pendingJob?.status === 'error'
          ? t('Regenerate scene')
          : t('Generate scene')}
      </Button>
    </motion.article>
  )
}
