import {
  getToolName,
  isFileUIPart,
  isReasoningUIPart,
  isTextUIPart,
  isToolUIPart,
  type FileUIPart,
  type UIMessage,
} from 'ai'
import { FileText } from 'lucide-react'
import { useState } from 'react'
import { useTranslation } from 'react-i18next'

import { MessageContent } from '@/components/ai-elements/message'
import {
  Reasoning,
  ReasoningContent,
  ReasoningTrigger,
} from '@/components/ai-elements/reasoning'
import { Response } from '@/components/ai-elements/response'
import {
  Source,
  Sources,
  SourcesContent,
  SourcesTrigger,
} from '@/components/ai-elements/sources'
import { cn } from '@/lib/utils'

import { displaySourceTitle } from '../../lib/message/message-content-utils'
import { getMessageContentStyles } from '../../lib/message/message-styles'
import type {
  ManagedDocumentArtifact,
  ManagedToolCard,
  MessageSource,
} from '../../types'
import { MediaLightbox, type LightboxItem } from '../media/media-lightbox'
import { ManagedToolCardView } from './managed-tool-card'

type MessagePart = UIMessage['parts'][number]

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null
}

function toolAction(name: string): ManagedToolCard['action'] | null {
  if (
    name === 'web_search' ||
    name === 'generate_image' ||
    name === 'generate_video' ||
    name === 'generate_document'
  ) {
    return name
  }
  return null
}

function toolOutput(part: MessagePart): Record<string, unknown> {
  if (!isToolUIPart(part) || part.state !== 'output-available') return {}
  return isRecord(part.output) ? part.output : {}
}

function documentArtifacts(
  output: Record<string, unknown>
): ManagedDocumentArtifact[] {
  const unverified = new Set(
    Array.isArray(output.unverified)
      ? output.unverified.filter(
          (name): name is string => typeof name === 'string'
        )
      : []
  )
  if (!Array.isArray(output.documents)) return []

  const artifacts: ManagedDocumentArtifact[] = []
  for (const value of output.documents) {
    if (!isRecord(value)) continue
    const name = typeof value.name === 'string' ? value.name : ''
    artifacts.push({
      assetId: typeof value.asset_id === 'number' ? value.asset_id : 0,
      name,
      url: typeof value.url === 'string' ? value.url : undefined,
      mime: typeof value.mime === 'string' ? value.mime : '',
      size: typeof value.size === 'number' ? value.size : 0,
      verified: !unverified.has(name),
    })
  }
  return artifacts
}

function managedToolFromPart(
  part: MessagePart,
  isMessageFinal: boolean
): ManagedToolCard | null {
  if (!isToolUIPart(part)) return null
  const action = toolAction(getToolName(part))
  if (!action) return null

  if (part.state === 'output-error') {
    return {
      action,
      toolCallId: part.toolCallId,
      status: 'failed',
      error: part.errorText,
    }
  }
  if (part.state === 'output-denied') {
    return {
      action,
      toolCallId: part.toolCallId,
      status: 'cancelled',
    }
  }

  const output = toolOutput(part)
  if (part.state !== 'output-available' || part.preliminary === true) {
    return {
      action,
      toolCallId: part.toolCallId,
      status: isMessageFinal ? 'cancelled' : 'running',
      stage: typeof output.stage === 'string' ? output.stage : undefined,
      stageDetail:
        typeof output.attempt === 'number' &&
        typeof output.totalAttempts === 'number'
          ? `${output.attempt}/${output.totalAttempts}`
          : undefined,
      documentAttempts:
        typeof output.attempt === 'number' ? output.attempt : undefined,
    }
  }

  const tool: ManagedToolCard = {
    action,
    toolCallId: part.toolCallId,
    status: 'completed',
  }
  if (action === 'generate_image') {
    tool.model = typeof output.model === 'string' ? output.model : undefined
    tool.images = Array.isArray(output.images)
      ? output.images.flatMap((value) => {
          if (!isRecord(value) || typeof value.url !== 'string') return []
          return [value.url]
        })
      : []
  } else if (action === 'generate_video') {
    tool.model = typeof output.model === 'string' ? output.model : undefined
    tool.taskId =
      typeof output.task_id === 'string' ? output.task_id : undefined
    tool.videoUrl =
      typeof output.video_url === 'string' ? output.video_url : undefined
  } else if (action === 'generate_document') {
    tool.documents = documentArtifacts(output)
    tool.documentAttempts =
      typeof output.attempts === 'number' ? output.attempts : undefined
    tool.documentCode =
      typeof output.code === 'string' ? output.code : undefined
    tool.documentLogs =
      typeof output.logs === 'string' ? output.logs : undefined
  }
  return tool
}

function sourcesFromToolPart(part: MessagePart): MessageSource[] {
  if (!isToolUIPart(part) || getToolName(part) !== 'web_search') return []
  const sources = toolOutput(part).sources
  if (!Array.isArray(sources)) return []

  const result: MessageSource[] = []
  for (const value of sources) {
    if (!isRecord(value) || typeof value.href !== 'string' || !value.href) {
      continue
    }
    result.push({
      href: value.href,
      title: typeof value.title === 'string' ? value.title : value.href,
      domain: typeof value.domain === 'string' ? value.domain : undefined,
    })
  }
  return result
}

function ToolSources(props: { sources: MessageSource[] }) {
  if (props.sources.length === 0) return null
  return (
    <Sources>
      <SourcesTrigger count={props.sources.length} />
      <SourcesContent>
        {props.sources.map((source) => (
          <Source
            href={source.href}
            key={`${source.href}-${source.title}`}
            title={displaySourceTitle(source)}
          />
        ))}
      </SourcesContent>
    </Sources>
  )
}

export function PlaygroundMessageParts(props: {
  parts: UIMessage['parts']
  isMessageFinal: boolean
}) {
  const { t } = useTranslation()
  const [lightbox, setLightbox] = useState<{
    items: LightboxItem[]
    index: number
  } | null>(null)
  const imageParts = props.parts.filter(
    (part): part is FileUIPart =>
      isFileUIPart(part) && part.mediaType.startsWith('image/')
  )
  let textPartNumber = 0
  let reasoningPartNumber = 0
  let filePartNumber = 0
  let reasoningFilePartNumber = 0

  return (
    <>
      {props.parts.map((part, index) => {
        if (isTextUIPart(part)) {
          textPartNumber += 1
          if (!part.text) return null
          return (
            <MessageContent
              variant='flat'
              className={cn(getMessageContentStyles())}
              key={`text-${textPartNumber}`}
            >
              <Response
                final={part.state !== 'streaming' || props.isMessageFinal}
              >
                {part.text}
              </Response>
            </MessageContent>
          )
        }
        if (isReasoningUIPart(part)) {
          reasoningPartNumber += 1
          if (!part.text) return null
          return (
            <Reasoning
              defaultOpen
              isStreaming={part.state === 'streaming' && !props.isMessageFinal}
              key={`reasoning-${reasoningPartNumber}`}
            >
              <ReasoningTrigger />
              <ReasoningContent>{part.text}</ReasoningContent>
            </Reasoning>
          )
        }
        if (isToolUIPart(part)) {
          const tool = managedToolFromPart(part, props.isMessageFinal)
          if (!tool) return null
          const sources = sourcesFromToolPart(part)
          return (
            <div className='mb-2 grid gap-2' key={`tool-${part.toolCallId}`}>
              <ManagedToolCardView
                isMessageFinal={props.isMessageFinal}
                tool={tool}
              />
              <ToolSources sources={sources} />
            </div>
          )
        }
        if (isFileUIPart(part)) {
          filePartNumber += 1
          const partKey = `file-${filePartNumber}`
          if (part.mediaType.startsWith('image/')) {
            const imageIndex = imageParts.findIndex(
              (image) => image.url === part.url
            )
            return (
              <button
                key={partKey}
                type='button'
                className='focus-visible:ring-ring mb-2 w-fit cursor-zoom-in rounded-lg outline-none focus-visible:ring-2'
                aria-label={
                  part.filename || t('Attachment {{index}}', { index })
                }
                onClick={() => {
                  setLightbox({
                    items: imageParts.map((image) => ({
                      url: image.url,
                      alt: image.filename,
                    })),
                    index: Math.max(0, imageIndex),
                  })
                }}
              >
                <img
                  src={part.url}
                  alt={part.filename || t('Attachment {{index}}', { index })}
                  className='border-border size-24 rounded-lg border object-cover'
                />
              </button>
            )
          }
          return (
            <a
              className='border-border bg-muted mb-2 flex w-fit max-w-64 items-center gap-2 rounded-lg border px-3 py-2'
              href={part.url}
              key={partKey}
              rel='noreferrer'
              target='_blank'
            >
              <FileText className='text-muted-foreground size-5 shrink-0' />
              <span className='truncate text-sm'>
                {part.filename || part.mediaType}
              </span>
            </a>
          )
        }
        if (part.type === 'reasoning-file') {
          reasoningFilePartNumber += 1
          return (
            <a
              className='border-border bg-muted mb-2 flex w-fit max-w-64 items-center gap-2 rounded-lg border px-3 py-2'
              href={part.url}
              key={`reasoning-file-${reasoningFilePartNumber}`}
              rel='noreferrer'
              target='_blank'
            >
              <FileText className='text-muted-foreground size-5 shrink-0' />
              <span className='truncate text-sm'>{part.mediaType}</span>
            </a>
          )
        }
        if (part.type === 'source-url') {
          const source = {
            href: part.url,
            title: part.title || part.url,
          }
          return (
            <ToolSources
              key={`source-url-${part.sourceId}`}
              sources={[source]}
            />
          )
        }
        if (part.type === 'source-document') {
          return (
            <div
              className='text-muted-foreground mb-2 flex items-center gap-2 text-xs'
              key={`source-document-${part.sourceId}`}
            >
              <FileText className='size-4 shrink-0' />
              <span className='truncate'>{part.title}</span>
            </div>
          )
        }
        return null
      })}

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
    </>
  )
}
