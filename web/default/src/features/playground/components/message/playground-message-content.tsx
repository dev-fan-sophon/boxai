import { FileText } from 'lucide-react'
import { useState, type ReactNode } from 'react'
import { useTranslation } from 'react-i18next'

import {
  CodeBlock,
  CodeBlockCopyButton,
} from '@/components/ai-elements/code-block'
import { Loader } from '@/components/ai-elements/loader'
import { MessageContent } from '@/components/ai-elements/message'
import {
  Reasoning,
  ReasoningContent,
  ReasoningTrigger,
} from '@/components/ai-elements/reasoning'
import { Response } from '@/components/ai-elements/response'
import { Shimmer } from '@/components/ai-elements/shimmer'
import {
  Source,
  Sources,
  SourcesContent,
  SourcesTrigger,
} from '@/components/ai-elements/sources'
import { cn } from '@/lib/utils'

import { MESSAGE_STATUS } from '../../constants'
import {
  getMessageAlignmentClass,
  getMessageContentState,
  isErrorMessage,
  type MessageAlignment,
} from '../../lib'
import { attachmentPreviewSrc } from '../../lib/attachments/attachment-utils'
import {
  displaySourceTitle,
  hasRenderableMessageParts,
} from '../../lib/message/message-content-utils'
import { getMessageContentStyles } from '../../lib/message/message-styles'
import type { Message } from '../../types'
import { MediaLightbox, type LightboxItem } from '../media/media-lightbox'
import { ManagedToolCardView } from './managed-tool-card'
import { MessageError } from './message-error'
import { MessageMetadata } from './message-metadata'
import { PlaygroundMessageParts } from './playground-message-parts'

type PlaygroundMessageContentProps = {
  actions: ReactNode
  alignment: MessageAlignment
  errorActions?: ReactNode
  isSourceVisible?: boolean
  message: Message
  versionContent: string
}

export function PlaygroundMessageContent({
  actions,
  alignment,
  errorActions,
  isSourceVisible = false,
  message,
  versionContent,
}: PlaygroundMessageContentProps) {
  const { t } = useTranslation()
  const {
    displayContent,
    hasReasoning,
    hasSources,
    reasoningContent,
    showLoader,
    showMessageContent,
    sources,
  } = getMessageContentState(message, versionContent)
  const isError = isErrorMessage(message)
  const isMessageFinal =
    message.status !== MESSAGE_STATUS.LOADING &&
    message.status !== MESSAGE_STATUS.STREAMING
  const hasNativeParts = message.parts !== undefined
  const nativeHasContent = message.parts
    ? hasRenderableMessageParts(message.parts)
    : false
  const managedTools =
    message.managedTools ?? (message.managedTool ? [message.managedTool] : [])
  const hasRunningTool = managedTools.some(
    (tool) =>
      tool.status === 'queued' ||
      tool.status === 'running' ||
      tool.status === 'submitted'
  )
  const [lightbox, setLightbox] = useState<{
    items: LightboxItem[]
    index: number
  } | null>(null)

  return (
    <div
      className={cn(
        'flex w-full min-w-0 flex-col',
        getMessageAlignmentClass(alignment)
      )}
    >
      {!hasNativeParts &&
        message.attachments &&
        message.attachments.length > 0 && (
          <div className='mb-2 flex flex-wrap gap-2'>
            {message.attachments.map((attachment, index) =>
              attachmentPreviewSrc(attachment) ? (
                <button
                  key={attachment.id}
                  type='button'
                  className='focus-visible:ring-ring cursor-zoom-in rounded-lg outline-none focus-visible:ring-2'
                  aria-label={t('Attachment {{index}}', { index: index + 1 })}
                  onClick={() => {
                    const items = (message.attachments ?? [])
                      .map((item) => attachmentPreviewSrc(item))
                      .filter((src): src is string => Boolean(src))
                      .map((src) => ({ url: src }))
                    const src = attachmentPreviewSrc(attachment)
                    setLightbox({
                      items,
                      index: Math.max(
                        0,
                        items.findIndex((item) => item.url === src)
                      ),
                    })
                  }}
                >
                  <img
                    src={attachmentPreviewSrc(attachment)}
                    alt={t('Attachment {{index}}', { index: index + 1 })}
                    className='border-border size-24 rounded-lg border object-cover'
                  />
                </button>
              ) : (
                <div
                  key={attachment.id}
                  className='border-border bg-muted flex max-w-64 items-center gap-2 rounded-lg border px-3 py-2'
                >
                  <FileText className='text-muted-foreground size-5 shrink-0' />
                  <span className='truncate text-sm' title={attachment.name}>
                    {attachment.name}
                  </span>
                </div>
              )
            )}
          </div>
        )}

      {!hasNativeParts && hasSources && (
        <Sources>
          <SourcesTrigger count={sources.length} />
          <SourcesContent>
            {sources.map((source) => (
              <Source
                href={source.href}
                key={`${source.href}-${source.title}`}
                title={displaySourceTitle(source)}
              />
            ))}
          </SourcesContent>
        </Sources>
      )}

      {!hasNativeParts && managedTools.length > 0 && (
        <div className='mb-2 grid gap-2'>
          {managedTools.map((tool, index) => (
            <ManagedToolCardView
              key={tool.toolCallId ?? `${tool.action}-${index}`}
              isMessageFinal={isMessageFinal}
              tool={tool}
            />
          ))}
        </div>
      )}

      {!hasNativeParts && hasReasoning && (
        <Reasoning
          defaultOpen
          duration={message.reasoning?.duration}
          isStreaming={message.isReasoningStreaming}
        >
          <ReasoningTrigger />
          <ReasoningContent>{reasoningContent}</ReasoningContent>
        </Reasoning>
      )}

      {showLoader &&
        !hasRunningTool &&
        (!hasNativeParts || !nativeHasContent) && (
          <div className='flex items-center gap-2 py-2'>
            <Loader />
            <Shimmer className='text-sm' duration={1}>
              {t('Responding...')}
            </Shimmer>
          </div>
        )}

      {isError && (
        <>
          <MessageError message={message} className='mb-2' />
          <MessageMetadata alignment={alignment} message={message} />
          {errorActions}
        </>
      )}

      {!isError && hasNativeParts && isSourceVisible && versionContent && (
        <>
          <CodeBlock
            code={versionContent}
            className='my-0 group-[.is-assistant]:w-full group-[.is-assistant]:max-w-[78ch]'
            collapsedLines={24}
            defaultCollapsed={false}
            language='markdown'
            maxExpandedLines={48}
            showLineNumbers
            showToolbar
            title={t('Raw response')}
          >
            <CodeBlockCopyButton />
          </CodeBlock>
          <MessageMetadata alignment={alignment} message={message} />
          {actions}
        </>
      )}

      {!isError && hasNativeParts && !isSourceVisible && message.parts && (
        <>
          <PlaygroundMessageParts
            parts={message.parts}
            isMessageFinal={isMessageFinal}
          />
          {nativeHasContent && (
            <>
              <MessageMetadata alignment={alignment} message={message} />
              {actions}
            </>
          )}
        </>
      )}

      {!isError && !hasNativeParts && showMessageContent && (
        <>
          {isSourceVisible ? (
            <CodeBlock
              code={versionContent}
              className='my-0 group-[.is-assistant]:w-full group-[.is-assistant]:max-w-[78ch]'
              collapsedLines={24}
              defaultCollapsed={false}
              language='markdown'
              maxExpandedLines={48}
              showLineNumbers
              showToolbar
              title={t('Raw response')}
            >
              <CodeBlockCopyButton />
            </CodeBlock>
          ) : (
            <MessageContent
              variant='flat'
              className={cn(getMessageContentStyles())}
            >
              <Response final={isMessageFinal}>{displayContent}</Response>
            </MessageContent>
          )}
          <MessageMetadata alignment={alignment} message={message} />
          {actions}
        </>
      )}

      {!isError &&
        !hasNativeParts &&
        !showMessageContent &&
        Boolean(message.attachments?.length) && (
          <>
            <MessageMetadata alignment={alignment} message={message} />
            {actions}
          </>
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
    </div>
  )
}
