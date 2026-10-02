import { useMemo, useState } from 'react'
import { useTranslation } from 'react-i18next'
import { toast } from 'sonner'

import { ConfirmDialog } from '@/components/confirm-dialog'
import {
  AudioLines,
  ImageIcon,
  MessageSquare,
  Pin,
  PinOff,
  Plus,
  Search,
  Trash2,
  Video,
  type IconComponent,
} from '@/components/icons'
import { Button } from '@/components/ui/button'
import { ScrollArea } from '@/components/ui/scroll-area'
import { cn } from '@/lib/utils'
import {
  selectActiveSession,
  usePlaygroundStore,
} from '@/stores/playground-store'

import {
  deleteConversation,
  deleteProject,
  updateConversation,
} from '../../api'
import {
  hasSessionContent,
  isChatSession,
  listSessionsForModality,
  type PlaygroundSession,
  type SessionModality,
} from '../../lib'
import { defaultSessionTitle } from '../../lib/session/session-utils'

function formatRelativeTime(
  timestamp: number,
  t: (key: string, options?: Record<string, unknown>) => string
): string {
  if (!Number.isFinite(timestamp) || timestamp <= 0) return ''
  const diffMs = Date.now() - timestamp
  if (diffMs < 60_000) return t('Just now')
  if (diffMs < 3_600_000) {
    const mins = Math.max(1, Math.round(diffMs / 60_000))
    return t('{{count}}m ago', { count: mins })
  }
  if (diffMs < 86_400_000) {
    const hours = Math.max(1, Math.round(diffMs / 3_600_000))
    return t('{{count}}h ago', { count: hours })
  }
  return new Intl.DateTimeFormat(undefined, {
    month: 'short',
    day: 'numeric',
    hour: '2-digit',
    minute: '2-digit',
  }).format(new Date(timestamp))
}

const MODALITY_META: Record<
  SessionModality,
  { labelKey: string; Icon: IconComponent }
> = {
  chat: { labelKey: 'Chats', Icon: MessageSquare },
  image: { labelKey: 'Image projects', Icon: ImageIcon },
  video: { labelKey: 'Video projects', Icon: Video },
  audio: { labelKey: 'Audio projects', Icon: AudioLines },
}

type SessionHistoryPanelProps = {
  className?: string
  /** Called after selecting a session (e.g. close mobile sheet). */
  onSelectSession?: () => void
  /** Compact header mode for embedding inside the left rail. */
  embedded?: boolean
}

export function SessionHistoryPanel(props: SessionHistoryPanelProps) {
  const { t } = useTranslation()
  const activeModality = usePlaygroundStore((state) => state.activeModality)
  const sessions = usePlaygroundStore((state) => state.sessions)
  const activeSession = usePlaygroundStore(selectActiveSession)
  const openSession = usePlaygroundStore((state) => state.openSession)
  const startNewSession = usePlaygroundStore((state) => state.startNewSession)
  const deleteSession = usePlaygroundStore((state) => state.deleteSession)
  const renameSession = usePlaygroundStore((state) => state.renameSession)
  const togglePinSession = usePlaygroundStore((state) => state.togglePinSession)
  const [deleteId, setDeleteId] = useState<string | null>(null)
  const [isDeleting, setIsDeleting] = useState(false)
  const [renamingId, setRenamingId] = useState<string | null>(null)
  const [renameValue, setRenameValue] = useState('')
  const [query, setQuery] = useState('')

  const items = useMemo(() => {
    const list = listSessionsForModality(sessions, activeModality)
    const needle = query.trim().toLowerCase()
    if (!needle) return list
    return list.filter((session) => {
      if (session.title.toLowerCase().includes(needle)) return true
      if (session.model.toLowerCase().includes(needle)) return true
      return false
    })
  }, [sessions, activeModality, query])

  const meta = MODALITY_META[activeModality]
  const Icon = meta.Icon
  const newLabel = activeModality === 'chat' ? t('New chat') : t('New project')

  const handleRenameSubmit = (session: PlaygroundSession) => {
    const next = renameValue.trim()
    if (next && next !== session.title) {
      renameSession(session.id, next)
      if (isChatSession(session) && session.serverId) {
        void updateConversation(session.serverId, { title: next }).catch(() =>
          toast.error(t('Update failed'))
        )
      }
    }
    setRenamingId(null)
    setRenameValue('')
  }

  return (
    <div
      className={cn('flex h-full min-h-0 flex-col', props.className)}
      data-session-history=''
    >
      <div className='flex shrink-0 items-center gap-2 px-3 pt-3 pb-2'>
        <div className='min-w-0 flex-1'>
          <p className='text-foreground truncate text-sm font-semibold'>
            {t('History')}
          </p>
          <p className='text-muted-foreground text-2xs truncate'>
            {t(meta.labelKey)}
          </p>
        </div>
        <Button
          size='sm'
          variant='outline'
          className='shrink-0'
          onClick={() => {
            startNewSession(activeModality)
            props.onSelectSession?.()
          }}
        >
          <Plus aria-hidden='true' />
          <span className='max-w-[9rem] truncate'>{newLabel}</span>
        </Button>
      </div>

      <div className='border-border/60 shrink-0 border-b px-3 pb-3'>
        <div className='relative'>
          <Search
            className='text-muted-foreground pointer-events-none absolute top-1/2 left-2.5 size-3.5 -translate-y-1/2'
            aria-hidden='true'
          />
          <input
            value={query}
            onChange={(event) => setQuery(event.target.value)}
            placeholder={t('Search history')}
            aria-label={t('Search history')}
            className='border-input bg-card placeholder:text-muted-foreground focus-visible:border-ring focus-visible:ring-ring/15 text-ui h-8 w-full rounded-lg border pr-2 pl-8 shadow-xs outline-none focus-visible:ring-3'
          />
        </div>
      </div>

      <ScrollArea className='min-h-0 flex-1'>
        <div className='flex flex-col gap-0.5 p-2'>
          {items.length === 0 && query.trim() !== '' && (
            <div className='text-muted-foreground px-3 py-8 text-center text-xs'>
              {t('No sessions match your search.')}
            </div>
          )}
          {items.length === 0 && query.trim() === '' && (
            <div className='text-muted-foreground flex flex-col items-center gap-2 px-3 py-10 text-center text-xs'>
              <span className='bg-muted text-muted-foreground flex size-10 items-center justify-center rounded-xl'>
                <Icon weight='duotone' className='size-5' aria-hidden='true' />
              </span>
              <p className='text-foreground text-sm font-medium'>
                {t('No saved sessions yet')}
              </p>
              <p className='text-2xs text-pretty'>
                {t('Start chatting or generating to build history here.')}
              </p>
            </div>
          )}

          {items.map((session) => {
            const active = activeSession?.id === session.id
            const subtitle = session.model || t('No model')
            const isRenaming = renamingId === session.id
            const showActions = hasSessionContent(session) && !isRenaming
            const title =
              session.title === defaultSessionTitle(session.modality)
                ? t(session.title)
                : session.title

            return (
              <div
                key={session.id}
                className={cn(
                  'group relative flex flex-col gap-0.5 rounded-xl px-2.5 py-2 transition-colors',
                  active
                    ? 'bg-card ring-primary/30 shadow-xs ring-1'
                    : 'hover:bg-accent/70'
                )}
              >
                {isRenaming ? (
                  <form
                    onSubmit={(event) => {
                      event.preventDefault()
                      handleRenameSubmit(session)
                    }}
                    className='flex flex-col gap-1.5'
                  >
                    <input
                      autoFocus
                      value={renameValue}
                      onChange={(event) => setRenameValue(event.target.value)}
                      onBlur={() => handleRenameSubmit(session)}
                      className='border-border bg-background focus-visible:ring-ring h-8 rounded-md border px-2 text-sm outline-none focus-visible:ring-2'
                      aria-label={t('Session title')}
                    />
                  </form>
                ) : (
                  <button
                    type='button'
                    onClick={() => {
                      openSession(session.id)
                      props.onSelectSession?.()
                    }}
                    onDoubleClick={() => {
                      setRenamingId(session.id)
                      setRenameValue(session.title)
                    }}
                    title={title}
                    className={cn(
                      'min-w-0 text-left outline-none',
                      showActions &&
                        'group-focus-within:pr-14 group-hover:pr-14 pointer-coarse:pr-14',
                      showActions && active && 'pr-14'
                    )}
                  >
                    <span
                      className={cn(
                        'text-ui flex min-w-0 items-center gap-1 font-medium',
                        active ? 'text-foreground' : 'text-foreground/90'
                      )}
                    >
                      {session.pinned && (
                        <Pin
                          className='text-primary size-3 shrink-0'
                          aria-label={t('Pinned')}
                        />
                      )}
                      <span className='truncate'>{title}</span>
                    </span>
                    <span className='text-muted-foreground text-2xs mt-0.5 flex min-w-0 items-center gap-1.5'>
                      <span className='truncate font-mono'>{subtitle}</span>
                      <span aria-hidden='true'>·</span>
                      <span className='shrink-0'>
                        {formatRelativeTime(session.updatedAt, t)}
                      </span>
                    </span>
                    {session.modality === 'image' &&
                      (session.previewUrls?.length ?? 0) > 0 && (
                        <span className='mt-1.5 flex items-center gap-1'>
                          {(session.previewUrls ?? []).slice(-3).map((url) => (
                            <img
                              key={url}
                              src={url}
                              alt=''
                              aria-hidden='true'
                              loading='lazy'
                              referrerPolicy='no-referrer'
                              className='border-border/60 size-9 rounded-md border object-cover'
                            />
                          ))}
                        </span>
                      )}
                  </button>
                )}

                {showActions && (
                  <div
                    className={cn(
                      'absolute top-1.5 right-1.5 flex items-center gap-0.5 opacity-0 transition-opacity duration-control group-focus-within:opacity-100 group-hover:opacity-100 pointer-coarse:opacity-70',
                      active && 'opacity-70'
                    )}
                  >
                    <button
                      type='button'
                      aria-label={session.pinned ? t('Unpin') : t('Pin')}
                      onClick={(event) => {
                        event.stopPropagation()
                        togglePinSession(session.id)
                        if (isChatSession(session) && session.serverId) {
                          void updateConversation(session.serverId, {
                            pinned: !session.pinned,
                          }).catch(() => toast.error(t('Update failed')))
                        }
                      }}
                      className='text-muted-foreground hover:text-primary hover:bg-primary/10 focus-visible:ring-ring flex size-7 items-center justify-center rounded-md outline-none focus-visible:ring-2'
                    >
                      {session.pinned ? (
                        <PinOff className='size-3.5' aria-hidden='true' />
                      ) : (
                        <Pin className='size-3.5' aria-hidden='true' />
                      )}
                    </button>
                    <button
                      type='button'
                      aria-label={t('Delete session')}
                      onClick={(event) => {
                        event.stopPropagation()
                        setDeleteId(session.id)
                      }}
                      className='text-muted-foreground hover:text-destructive hover:bg-destructive/10 focus-visible:ring-ring flex size-7 items-center justify-center rounded-md outline-none focus-visible:ring-2'
                    >
                      <Trash2 className='size-3.5' aria-hidden='true' />
                    </button>
                  </div>
                )}
              </div>
            )
          })}
        </div>
      </ScrollArea>

      <ConfirmDialog
        destructive
        open={deleteId != null}
        isLoading={isDeleting}
        onOpenChange={(open) => {
          if (!open && !isDeleting) setDeleteId(null)
        }}
        title={t('Delete this session?')}
        desc={t(
          'This removes the session from this browser. Cloud copies are deleted when synced.'
        )}
        confirmText={t('Delete')}
        handleConfirm={() => {
          if (!deleteId || isDeleting) return
          const session = sessions.find((item) => item.id === deleteId)
          setIsDeleting(true)
          void (async () => {
            try {
              if (session?.serverId) {
                if (isChatSession(session)) {
                  await deleteConversation(session.serverId)
                } else {
                  await deleteProject(session.serverId)
                }
              }
              deleteSession(deleteId)
              setDeleteId(null)
            } catch {
              toast.error(t('Delete failed'))
            } finally {
              setIsDeleting(false)
            }
          })()
        }}
      />
    </div>
  )
}
