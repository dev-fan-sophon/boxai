import {
  Check,
  CircleSlash2,
  CircleX,
  Download,
  FileText,
  Globe,
  ImageIcon,
  Sparkles,
  Video,
  type LucideIcon,
} from 'lucide-react'
import { useReducedMotion } from 'motion/react'
import { useEffect, useState } from 'react'
import { useTranslation } from 'react-i18next'

import {
  CodeBlock,
  CodeBlockCopyButton,
} from '@/components/ai-elements/code-block'
import { Loader } from '@/components/ai-elements/loader'
import { Button } from '@/components/ui/button'
import { cn } from '@/lib/utils'

import { useVideoTaskResult } from '../../hooks/use-video-task-result'
import { downloadGeneratedMedia } from '../../lib/download-generated-media'
import type { ManagedToolCard } from '../../types'
import { MediaLightbox, type LightboxItem } from '../media/media-lightbox'
import {
  ImagePlaceholder,
  VideoPlaceholder,
} from '../workspace/generation-progress'
import { ManagedDocumentArtifacts } from './managed-document-artifacts'

const MANAGED_TOOL_META: Record<
  string,
  { titleKey: string; Icon: LucideIcon; tile: string }
> = {
  generate_image: {
    titleKey: 'Image generation',
    Icon: ImageIcon,
    tile: 'bg-chart-3/15 text-chart-3',
  },
  generate_video: {
    titleKey: 'Video generation',
    Icon: Video,
    tile: 'bg-warning/15 text-warning',
  },
  web_search: {
    titleKey: 'Web search',
    Icon: Globe,
    tile: 'bg-info/15 text-info',
  },
  generate_document: {
    titleKey: 'Document generation',
    Icon: FileText,
    tile: 'bg-chart-2/15 text-chart-2',
  },
}

const DEFAULT_TOOL_META = {
  titleKey: 'Platform tool',
  Icon: Sparkles,
  tile: 'bg-primary/15 text-primary',
}

type ManagedToolCardViewProps = {
  isMessageFinal: boolean
  tool: ManagedToolCard
}

export function ManagedToolCardView(props: ManagedToolCardViewProps) {
  const { t } = useTranslation()
  const shouldReduce = useReducedMotion()
  const [startedAt] = useState(() => props.tool.startedAt ?? Date.now())
  const [lightbox, setLightbox] = useState<{
    items: LightboxItem[]
    index: number
  } | null>(null)
  const videoResult = useVideoTaskResult(
    props.tool.taskId,
    props.tool.action === 'generate_video'
  )
  const toolVideoUrl = props.tool.videoUrl || videoResult.resultUrl
  let toolStatus: string = props.tool.status
  if (props.tool.action === 'generate_video' && videoResult.status) {
    if (videoResult.ready) {
      toolStatus = 'completed'
    } else if (videoResult.failed) {
      toolStatus = 'failed'
    } else {
      toolStatus = 'running'
    }
  }
  const toolError =
    props.tool.action === 'generate_video' && videoResult.failed
      ? videoResult.failReason
      : props.tool.error
  const toolMeta = MANAGED_TOOL_META[props.tool.action] ?? DEFAULT_TOOL_META
  const ToolIcon = toolMeta.Icon
  const isToolFailed =
    Boolean(toolError) ||
    toolStatus === 'failed' ||
    toolStatus === 'unavailable'
  const isToolCancelled = toolStatus === 'cancelled'
  const isToolDone =
    !isToolFailed &&
    !isToolCancelled &&
    (toolStatus === 'completed' ||
      toolStatus === 'success' ||
      Boolean(props.tool.images?.length) ||
      Boolean(props.tool.documents?.length) ||
      Boolean(toolVideoUrl))
  const isToolRunning = !isToolFailed && !isToolCancelled && !isToolDone
  let StatusIcon = Check
  if (isToolFailed) StatusIcon = CircleX
  if (isToolCancelled) StatusIcon = CircleSlash2

  return (
    <section className='group/tool max-w-2xl py-0.5'>
      <div
        className={cn(
          'flex min-h-9 items-center gap-2 rounded-lg px-1.5 py-1 text-sm transition-colors',
          'hover:bg-muted/35',
          isToolFailed && 'bg-destructive/5'
        )}
      >
        <span className='flex min-w-0 flex-1 items-center gap-2'>
          <span
            className={cn(
              'relative flex size-6 shrink-0 items-center justify-center rounded-md',
              toolMeta.tile
            )}
          >
            <ToolIcon className='relative size-3.5' aria-hidden='true' />
          </span>
          <span className='min-w-0 truncate font-medium'>
            {t(toolMeta.titleKey)}
          </span>
          {isToolRunning && props.tool.stage && (
            <span className='text-muted-foreground hidden min-w-0 truncate text-xs sm:inline'>
              · {t(props.tool.stage)}
              {props.tool.stageDetail ? ` · ${props.tool.stageDetail}` : ''}
            </span>
          )}
        </span>
        <span
          aria-live='polite'
          className={cn(
            'flex shrink-0 items-center gap-1.5 text-xs',
            isToolFailed && 'text-destructive',
            isToolDone && 'text-success',
            isToolCancelled && 'text-muted-foreground',
            isToolRunning && 'text-muted-foreground'
          )}
        >
          {isToolRunning ? (
            <Loader className='text-primary' size={12} aria-hidden='true' />
          ) : (
            <StatusIcon className='size-3.5' aria-hidden='true' />
          )}
          {t(toolStatus)}
          {isToolRunning && <ToolElapsedTime startedAt={startedAt} />}
        </span>
      </div>

      {isToolRunning && (
        <div
          className='bg-border/60 relative mr-1 ml-9 h-px overflow-hidden rounded-full'
          aria-hidden='true'
        >
          <span
            className={cn(
              'from-primary/5 via-primary/70 to-primary/5 absolute inset-y-0 w-1/3 rounded-full bg-gradient-to-r',
              !shouldReduce && 'generation-indeterminate'
            )}
          />
        </div>
      )}
      {isToolRunning && props.tool.stage && (
        <p className='text-muted-foreground mt-1 ml-9 truncate text-xs sm:hidden'>
          {t(props.tool.stage)}
          {props.tool.stageDetail ? ` · ${props.tool.stageDetail}` : ''}
        </p>
      )}
      {toolError && (
        <p className='text-destructive mt-1.5 ml-9 text-sm'>{toolError}</p>
      )}
      {isToolRunning && props.tool.action === 'generate_image' && (
        <div className='mt-2 ml-9'>
          <ImagePlaceholder
            delayMs={0}
            reduceMotion={Boolean(shouldReduce)}
            ratio={4 / 3}
            sizeLabel={null}
            className='max-w-40 rounded-xl'
          />
        </div>
      )}
      {isToolRunning && props.tool.action === 'generate_video' && (
        <div className='mt-2 ml-9'>
          <VideoPlaceholder reduceMotion={Boolean(shouldReduce)} />
        </div>
      )}
      {props.tool.documents && (
        <div className='ml-9'>
          <ManagedDocumentArtifacts artifacts={props.tool.documents} />
        </div>
      )}
      {props.tool.documentCode && props.isMessageFinal && (
        <details className='mt-2 ml-9'>
          <summary className='text-muted-foreground hover:text-foreground cursor-pointer text-xs'>
            {t('Show the script that produced this')}
          </summary>
          <div className='mt-2'>
            <CodeBlock code={props.tool.documentCode} language='python'>
              <CodeBlockCopyButton />
            </CodeBlock>
          </div>
          {props.tool.documentLogs && (
            <pre className='bg-muted/40 mt-2 max-h-40 overflow-auto rounded-lg p-3 text-xs whitespace-pre-wrap'>
              {props.tool.documentLogs}
            </pre>
          )}
        </details>
      )}
      {props.tool.images && (
        <div className='mt-2 ml-9 flex flex-wrap gap-2'>
          {props.tool.images.map((url, index) => (
            <ManagedToolImage
              key={url}
              url={url}
              index={index}
              alt={t('Generated image')}
              onOpen={() => {
                const items = (props.tool.images ?? []).map(
                  (imageUrl, imageIndex) => ({
                    url: imageUrl,
                    alt: t('Generated image'),
                    downloadName: `image-${imageIndex + 1}`,
                  })
                )
                setLightbox({ items, index })
              }}
            />
          ))}
        </div>
      )}
      {toolVideoUrl && (
        <div className='generation-result-enter border-border/70 bg-muted/30 group relative mt-2 ml-9 overflow-hidden rounded-xl border'>
          <video src={toolVideoUrl} controls className='w-full' />
          <Button
            size='icon-sm'
            variant='secondary'
            className='bg-background/85 absolute top-2 right-2 shadow-sm backdrop-blur-sm'
            aria-label={t('Download')}
            onClick={() =>
              void downloadGeneratedMedia(toolVideoUrl, 'video', 'video')
            }
          >
            <Download aria-hidden='true' />
          </Button>
        </div>
      )}

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
      />
    </section>
  )
}

function ToolElapsedTime(props: { startedAt: number }) {
  const [now, setNow] = useState(() => Date.now())
  useEffect(() => {
    const timer = window.setInterval(() => setNow(Date.now()), 1000)
    return () => window.clearInterval(timer)
  }, [])
  const seconds = Math.max(0, Math.floor((now - props.startedAt) / 1000))
  const label =
    seconds >= 60
      ? `${Math.floor(seconds / 60)}m ${String(seconds % 60).padStart(2, '0')}s`
      : `${seconds}s`
  return (
    <span className='tabular-nums opacity-70' aria-hidden='true'>
      {label}
    </span>
  )
}

function ManagedToolImage(props: {
  url: string
  index: number
  alt: string
  onOpen: () => void
}) {
  return (
    <button
      type='button'
      className='generation-result-enter border-border/70 bg-muted/30 focus-visible:ring-ring cursor-zoom-in overflow-hidden rounded-xl border outline-none focus-visible:ring-2'
      style={{ animationDelay: `${props.index * 70}ms` }}
      aria-label={props.alt}
      onClick={props.onOpen}
    >
      <img
        src={props.url}
        alt={props.alt}
        className='generation-image-reveal duration-control size-32 object-cover transition-transform hover:scale-105 sm:size-40'
        referrerPolicy='no-referrer'
        loading='lazy'
        decoding='async'
      />
    </button>
  )
}
