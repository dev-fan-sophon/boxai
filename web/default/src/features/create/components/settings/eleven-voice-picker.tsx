import { useInfiniteQuery } from '@tanstack/react-query'
import {
  Check,
  ChevronsUpDown,
  Loader2,
  Pause,
  Play,
  Search,
  UserRound,
} from 'lucide-react'
import { useEffect, useRef, useState } from 'react'
import { useTranslation } from 'react-i18next'

import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import {
  Popover,
  PopoverContent,
  PopoverTrigger,
} from '@/components/ui/popover'
import { Skeleton } from '@/components/ui/skeleton'
import { useDebounce } from '@/hooks/use-debounce'
import { cn } from '@/lib/utils'
import { useAuthStore } from '@/stores/auth-store'
import { usePlaygroundStore } from '@/stores/playground-store'

import { listElevenVoices, type ElevenVoice } from '../../lib/audio-api'

/** Label keys ElevenLabs uses for voice traits, in display order. */
const VOICE_TRAIT_KEYS = [
  'accent',
  'gender',
  'age',
  'descriptive',
  'use_case',
  'use case',
]

function voiceTraits(voice: ElevenVoice): string[] {
  const labels = voice.labels ?? {}
  return VOICE_TRAIT_KEYS.flatMap((key) => {
    const value = labels[key]?.trim()
    return value ? [value.replaceAll('_', ' ')] : []
  }).slice(0, 4)
}

/**
 * ElevenLabs voice library: searchable, paged list of the voices the gateway
 * account can use, with a preview player. The pick is remembered in the
 * studio settings (voice id + display name).
 */
export function ElevenVoicePicker(props: { id?: string; compact?: boolean }) {
  const { t } = useTranslation()
  const [open, setOpen] = useState(false)
  const [search, setSearch] = useState('')
  const debouncedSearch = useDebounce(search, 300)
  const [playingId, setPlayingId] = useState<string | null>(null)
  const previewRef = useRef<HTMLAudioElement | null>(null)
  const signedIn = useAuthStore((state) => Boolean(state.auth.user))
  const group = usePlaygroundStore((state) => state.config.group)
  const voiceId = usePlaygroundStore(
    (state) => state.studioSettings.elevenVoiceId
  )
  const voiceName = usePlaygroundStore(
    (state) => state.studioSettings.elevenVoiceName
  )
  const setStudioSettings = usePlaygroundStore(
    (state) => state.setStudioSettings
  )

  const voices = useInfiniteQuery({
    queryKey: ['create', 'eleven-voices', group, debouncedSearch.trim()],
    queryFn: ({ pageParam }) =>
      listElevenVoices({
        group,
        search: debouncedSearch,
        pageToken: pageParam,
      }),
    initialPageParam: undefined as string | undefined,
    getNextPageParam: (page) => (page.hasMore ? page.nextPageToken : undefined),
    enabled: open && signedIn,
    staleTime: 5 * 60 * 1000,
  })
  const items = voices.data?.pages.flatMap((page) => page.voices) ?? []

  useEffect(() => {
    if (open) return
    previewRef.current?.pause()
    setPlayingId(null)
  }, [open])

  useEffect(
    () => () => {
      previewRef.current?.pause()
    },
    []
  )

  const togglePreview = (voice: ElevenVoice) => {
    if (!voice.preview_url) return
    if (!previewRef.current) {
      previewRef.current = new Audio()
      previewRef.current.addEventListener('ended', () => setPlayingId(null))
    }
    const player = previewRef.current
    if (playingId === voice.voice_id) {
      player.pause()
      setPlayingId(null)
      return
    }
    player.src = voice.preview_url
    void player.play().catch(() => setPlayingId(null))
    setPlayingId(voice.voice_id)
  }

  const selectVoice = (voice: ElevenVoice) => {
    setStudioSettings((prev) => ({
      ...prev,
      elevenVoiceId: voice.voice_id,
      elevenVoiceName: voice.name,
    }))
    setOpen(false)
  }

  let body: React.ReactNode
  if (!signedIn) {
    body = (
      <p className='text-muted-foreground px-3 py-6 text-center text-xs'>
        {t('Sign in to browse the voice library.')}
      </p>
    )
  } else if (voices.isLoading) {
    body = (
      <div className='space-y-2 p-2'>
        {Array.from({ length: 5 }, (_, index) => (
          <Skeleton key={index} className='h-11 w-full rounded-lg' />
        ))}
      </div>
    )
  } else if (voices.isError) {
    body = (
      <div className='space-y-2 px-3 py-6 text-center'>
        <p className='text-destructive text-xs'>
          {voices.error instanceof Error
            ? voices.error.message
            : t('Could not load voices.')}
        </p>
        <Button size='xs' variant='outline' onClick={() => voices.refetch()}>
          {t('Retry')}
        </Button>
      </div>
    )
  } else if (items.length === 0) {
    body = (
      <p className='text-muted-foreground px-3 py-6 text-center text-xs'>
        {t('No voices match your search.')}
      </p>
    )
  } else {
    body = (
      <ul className='space-y-0.5 p-1' aria-label={t('Voices')}>
        {items.map((voice) => {
          const selected = voice.voice_id === voiceId
          const traits = voiceTraits(voice)
          return (
            <li
              key={voice.voice_id}
              className={cn(
                'group/voice flex items-center gap-2 rounded-lg px-1.5 py-1.5',
                selected ? 'bg-primary/10' : 'hover:bg-muted/60'
              )}
            >
              <Button
                type='button'
                size='icon-sm'
                variant='ghost'
                className='shrink-0 rounded-full'
                disabled={!voice.preview_url}
                aria-label={
                  playingId === voice.voice_id
                    ? t('Stop preview')
                    : t('Play preview of {{name}}', { name: voice.name })
                }
                onClick={() => togglePreview(voice)}
              >
                {playingId === voice.voice_id ? (
                  <Pause className='size-3.5' />
                ) : (
                  <Play className='size-3.5' />
                )}
              </Button>
              <button
                type='button'
                className='focus-visible:ring-ring min-w-0 flex-1 rounded-md text-left outline-none focus-visible:ring-2'
                onClick={() => selectVoice(voice)}
                aria-pressed={selected}
              >
                <span className='flex items-center gap-1.5'>
                  <span className='text-foreground truncate text-sm font-medium'>
                    {voice.name}
                  </span>
                  {voice.category && (
                    <span className='bg-muted text-muted-foreground text-3xs shrink-0 rounded-full px-1.5 py-px capitalize'>
                      {voice.category.replaceAll('_', ' ')}
                    </span>
                  )}
                </span>
                {traits.length > 0 && (
                  <span className='text-muted-foreground text-2xs block truncate capitalize'>
                    {traits.join(' · ')}
                  </span>
                )}
              </button>
              {selected && (
                <Check
                  className='text-primary size-4 shrink-0'
                  aria-hidden='true'
                />
              )}
            </li>
          )
        })}
        {voices.hasNextPage && (
          <li className='p-1'>
            <Button
              size='xs'
              variant='ghost'
              className='w-full'
              loading={voices.isFetchingNextPage}
              onClick={() => void voices.fetchNextPage()}
            >
              {t('Load more voices')}
            </Button>
          </li>
        )}
      </ul>
    )
  }

  return (
    <Popover open={open} onOpenChange={setOpen}>
      <PopoverTrigger
        render={
          <button
            id={props.id}
            type='button'
            className={cn(
              'border-border/70 bg-background hover:bg-muted/40 focus-visible:ring-ring transition-ui flex items-center gap-2 border px-2 text-left outline-none focus-visible:ring-2',
              props.compact
                ? 'h-8 max-w-44 shrink-0 rounded-full'
                : 'h-10 w-full rounded-lg'
            )}
            aria-label={t('Voice: {{name}}', { name: voiceName })}
          />
        }
      >
        <span className='bg-primary/10 text-primary flex size-6 shrink-0 items-center justify-center rounded-full'>
          <UserRound className='size-3.5' aria-hidden='true' />
        </span>
        <span className='text-foreground min-w-0 flex-1 truncate text-sm font-medium'>
          {voiceName}
        </span>
        <ChevronsUpDown
          className='text-muted-foreground size-3.5 shrink-0'
          aria-hidden='true'
        />
      </PopoverTrigger>
      <PopoverContent align='start' className='w-80 p-0'>
        <div className='border-border/60 relative border-b p-2'>
          <Search
            className='text-muted-foreground pointer-events-none absolute top-1/2 left-4 size-3.5 -translate-y-1/2'
            aria-hidden='true'
          />
          <Input
            value={search}
            onChange={(event) => setSearch(event.target.value)}
            placeholder={t('Search voices by name, accent, style…')}
            aria-label={t('Search voices')}
            className='h-8 pl-7 text-sm'
          />
          {voices.isFetching && !voices.isLoading && (
            <Loader2
              className='text-muted-foreground absolute top-1/2 right-4 size-3.5 -translate-y-1/2 animate-spin'
              aria-hidden='true'
            />
          )}
        </div>
        <div className='max-h-80 overflow-y-auto overscroll-contain'>
          {body}
        </div>
      </PopoverContent>
    </Popover>
  )
}
