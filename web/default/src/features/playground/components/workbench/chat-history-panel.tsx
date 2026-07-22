/*
Copyright (C) 2023-2026 QuantumNous

This program is free software: you can redistribute it and/or modify
it under the terms of the GNU Affero General Public License as
published by the Free Software Foundation, either version 3 of the
License, or (at your option) any later version.
*/
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { Loader2, MessageSquare, Plus, Trash2 } from 'lucide-react'
import { useTranslation } from 'react-i18next'
import { toast } from 'sonner'

import { Button } from '@/components/ui/button'
import { cn } from '@/lib/utils'

import {
  createConversation,
  deleteConversation,
  getConversation,
  listConversations,
  putConversationMessages,
  type ServerConversation,
} from '../../api'
import type { Message } from '../../types'

type ChatHistoryPanelProps = {
  messages: Message[]
  onClear: () => void
  /** When set, cloud conversations are listed and can load into the workbench */
  isAuthenticated?: boolean
  activeConversationId?: number | null
  onConversationIdChange?: (id: number | null) => void
  onLoadMessages?: (messages: Message[]) => void
  model?: string
  group?: string
}

export function ChatHistoryPanel(props: ChatHistoryPanelProps) {
  const { t } = useTranslation()
  const queryClient = useQueryClient()
  const userTurns = props.messages.filter((message) => message.from === 'user')
  const isAuth = props.isAuthenticated === true

  const listQuery = useQuery({
    queryKey: ['playground', 'conversations'],
    queryFn: () => listConversations({ page_size: 40 }),
    enabled: isAuth,
  })

  const createMutation = useMutation({
    mutationFn: () =>
      createConversation({
        title: t('New chat'),
        model: props.model,
        group: props.group,
      }),
    onSuccess: (conv) => {
      void queryClient.invalidateQueries({
        queryKey: ['playground', 'conversations'],
      })
      props.onConversationIdChange?.(conv.id)
      props.onClear()
      toast.success(t('New conversation created'))
    },
  })

  const loadConversation = async (conv: ServerConversation) => {
    try {
      const detail = await getConversation(conv.id)
      props.onConversationIdChange?.(conv.id)
      const mapped: Message[] = detail.messages.map((m, index) => ({
        key: `server-${m.id || index}`,
        from: m.role as Message['from'],
        versions: [{ id: `v-${m.id || index}`, content: m.content }],
        status: 'complete',
      }))
      props.onLoadMessages?.(mapped)
    } catch (err) {
      toast.error(err instanceof Error ? err.message : t('Failed to load conversation'))
    }
  }

  const syncMessages = async () => {
    if (!props.activeConversationId) {
      // create then sync
      try {
        const conv = await createConversation({
          title: t('New chat'),
          model: props.model,
          group: props.group,
        })
        props.onConversationIdChange?.(conv.id)
        await putConversationMessages(
          conv.id,
          props.messages
            .filter((m) => m.from === 'user' || m.from === 'assistant' || m.from === 'system')
            .map((m) => ({
              role: m.from,
              content: m.versions[0]?.content ?? '',
            }))
        )
        void queryClient.invalidateQueries({
          queryKey: ['playground', 'conversations'],
        })
        toast.success(t('Conversation synced'))
      } catch (err) {
        toast.error(err instanceof Error ? err.message : t('Sync failed'))
      }
      return
    }
    try {
      await putConversationMessages(
        props.activeConversationId,
        props.messages
          .filter((m) => m.from === 'user' || m.from === 'assistant' || m.from === 'system')
          .map((m) => ({
            role: m.from,
            content: m.versions[0]?.content ?? '',
          }))
      )
      void queryClient.invalidateQueries({
        queryKey: ['playground', 'conversations'],
      })
      toast.success(t('Conversation synced'))
    } catch (err) {
      toast.error(err instanceof Error ? err.message : t('Sync failed'))
    }
  }

  return (
    <div className='flex h-full min-h-0 flex-col'>
      <div className='border-b border-border p-3'>
        <h2 className='text-sm font-semibold text-foreground'>
          {t('Chat history')}
        </h2>
        <p className='text-xs text-muted-foreground'>
          {isAuth
            ? t('Cloud conversations and this browser session.')
            : t('Conversation stored in this browser.')}
        </p>
      </div>

      {isAuth && (
        <div className='flex gap-1 border-b border-border p-2'>
          <Button
            size='sm'
            variant='outline'
            className='h-7 flex-1 border-border bg-muted/50 text-foreground'
            disabled={createMutation.isPending}
            onClick={() => createMutation.mutate()}
          >
            <Plus className='size-3.5' />
            {t('New')}
          </Button>
          <Button
            size='sm'
            variant='outline'
            className='h-7 flex-1 border-border bg-muted/50 text-foreground'
            disabled={props.messages.length === 0}
            onClick={() => void syncMessages()}
          >
            {t('Sync')}
          </Button>
        </div>
      )}

      <div className='min-h-0 flex-1 space-y-2 overflow-y-auto p-2'>
        {isAuth && listQuery.isLoading && (
          <p className='flex items-center justify-center gap-2 py-6 text-sm text-muted-foreground'>
            <Loader2 className='size-3.5 animate-spin' />
            {t('Loading…')}
          </p>
        )}

        {isAuth &&
          (listQuery.data?.items ?? []).map((conv) => (
            <button
              key={conv.id}
              type='button'
              onClick={() => void loadConversation(conv)}
              className={cn(
                'w-full rounded-lg border border-border bg-muted/40 p-3 text-left transition-colors hover:border-primary/30',
                props.activeConversationId === conv.id &&
                  'border-primary/40 bg-primary/10'
              )}
            >
              <p className='truncate text-sm font-medium text-foreground'>
                {conv.title || t('Untitled')}
              </p>
              <p className='mt-0.5 truncate text-[11px] text-muted-foreground'>
                {conv.model || '—'}
              </p>
              <div className='mt-1 flex justify-end'>
                <span
                  role='button'
                  tabIndex={0}
                  className='inline-flex size-6 items-center justify-center rounded text-muted-foreground hover:text-destructive'
                  onClick={(e) => {
                    e.stopPropagation()
                    void deleteConversation(conv.id).then(() => {
                      if (props.activeConversationId === conv.id) {
                        props.onConversationIdChange?.(null)
                      }
                      void queryClient.invalidateQueries({
                        queryKey: ['playground', 'conversations'],
                      })
                    })
                  }}
                  onKeyDown={(e) => {
                    if (e.key === 'Enter') e.currentTarget.click()
                  }}
                >
                  <Trash2 className='size-3' />
                </span>
              </div>
            </button>
          ))}

        {userTurns.length === 0 && !isAuth && (
          <p className='px-3 py-10 text-center text-sm text-muted-foreground'>
            {t('No messages yet. Start a conversation from the workbench.')}
          </p>
        )}

        {!isAuth &&
          userTurns.map((message) => {
            const content = message.versions[0]?.content ?? ''
            return (
              <article
                key={message.key}
                className='rounded-lg border border-border bg-muted/40 p-3'
              >
                <div className='mb-1 flex items-center gap-1.5 text-[11px] text-muted-foreground'>
                  <MessageSquare className='size-3' aria-hidden='true' />
                  {t('You')}
                </div>
                <p className='line-clamp-4 text-sm text-foreground'>{content}</p>
              </article>
            )
          })}

        {isAuth && userTurns.length > 0 && (
          <div className='border-t border-border pt-2'>
            <p className='mb-1 px-1 text-[11px] font-medium text-muted-foreground'>
              {t('Current session')}
            </p>
            {userTurns.slice(-5).map((message) => {
              const content = message.versions[0]?.content ?? ''
              return (
                <article
                  key={message.key}
                  className='mb-1.5 rounded-lg border border-border bg-muted/40 p-2'
                >
                  <p className='line-clamp-3 text-xs text-foreground/80'>{content}</p>
                </article>
              )
            })}
          </div>
        )}
      </div>
      <div className='border-t border-border p-2'>
        <Button
          variant='ghost'
          size='sm'
          className='w-full justify-start text-foreground/80 hover:bg-destructive/10 hover:text-destructive'
          disabled={props.messages.length === 0}
          onClick={props.onClear}
        >
          <Trash2 className='size-4' />
          {t('Clear chat history')}
        </Button>
      </div>
    </div>
  )
}
