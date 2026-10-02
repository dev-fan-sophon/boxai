import { useInfiniteQuery } from '@tanstack/react-query'
import { useNavigate } from '@tanstack/react-router'
import { FolderOpen, LogIn } from 'lucide-react'
import { useEffect, useMemo, useRef, useState } from 'react'
import { useTranslation } from 'react-i18next'

import { EmptyState } from '@/components/empty-state'
import { Button } from '@/components/ui/button'
import { Skeleton } from '@/components/ui/skeleton'
import { listPlaygroundTasks, type PlaygroundRun } from '@/features/playground/api'
import { MediaLightbox } from '@/features/playground/components/media/media-lightbox'
import type { StudioRunSummary } from '@/features/playground/lib/session/session-types'
import { persistedStudioResultUrl } from '@/features/playground/lib/studio/studio-selection'
import { usePlaygroundStore } from '@/stores/playground-store'

import { isCreateTool, type CreateTool } from '../../constants'
import { useCreateWorkspace } from '../../context/workspace-context'
import { ModeSwitch } from '../panel/mode-switch'
import { LibraryTile } from './library-tile'

type LibraryFilter = 'all' | CreateTool

const PAGE_SIZE = 30

export function runToSummary(run: PlaygroundRun): StudioRunSummary {
  return {
    id: run.id,
    model: run.model,
    prompt: run.prompt,
    resultUrl: run.result_url || undefined,
    assetId: run.asset_id || undefined,
    taskId: run.task_id || undefined,
    batchId: run.batch_id || undefined,
    createdAt: run.created_at ? run.created_at * 1000 : undefined,
  }
}

/**
 * Every result the user generated in the studio, newest first, across
 * projects. Reusing a prompt opens its tool with the prompt filled in.
 */
export function CreateLibrary() {
  const { t } = useTranslation()
  const navigate = useNavigate()
  const workspace = useCreateWorkspace()
  const setPrefill = usePlaygroundStore((state) => state.setPrefill)
  const [filter, setFilter] = useState<LibraryFilter>('all')
  const [lightboxIndex, setLightboxIndex] = useState<number | null>(null)
  const sentinelRef = useRef<HTMLDivElement>(null)

  const query = useInfiniteQuery({
    queryKey: ['playground', 'runs', 'library', filter],
    queryFn: ({ pageParam }) =>
      listPlaygroundTasks({
        modality: filter === 'all' ? undefined : filter,
        p: pageParam,
        page_size: PAGE_SIZE,
      }),
    initialPageParam: 1,
    getNextPageParam: (lastPage, pages) =>
      pages.length * PAGE_SIZE < lastPage.runTotal ? pages.length + 1 : undefined,
    enabled: workspace.isAuthenticated,
  })

  const runs = useMemo(
    () =>
      (query.data?.pages.flatMap((page) => page.runs) ?? []).filter((run) =>
        isCreateTool(run.modality)
      ),
    [query.data]
  )
  const images = useMemo(
    () =>
      runs.flatMap((run) => {
        if (run.modality !== 'image') return []
        const url = persistedStudioResultUrl(runToSummary(run))
        return url
          ? [{ run, item: { url, alt: run.prompt, caption: run.prompt, assetId: run.asset_id } }]
          : []
      }),
    [runs]
  )
  const total = query.data?.pages[0]?.runTotal ?? 0

  const { hasNextPage, isFetchingNextPage, fetchNextPage } = query
  useEffect(() => {
    const node = sentinelRef.current
    if (!node || !hasNextPage) return
    const observer = new IntersectionObserver(
      (entries) => {
        if (entries.some((entry) => entry.isIntersecting) && !isFetchingNextPage) {
          void fetchNextPage()
        }
      },
      { rootMargin: '600px' }
    )
    observer.observe(node)
    return () => observer.disconnect()
  }, [fetchNextPage, hasNextPage, isFetchingNextPage])

  const reuse = (run: PlaygroundRun) => {
    if (!isCreateTool(run.modality)) return
    setPrefill(run.prompt)
    void navigate({ to: '/create/$tool', params: { tool: run.modality } })
  }

  let body: React.ReactNode
  if (!workspace.isAuthenticated) {
    body = (
      <EmptyState
        icon={LogIn}
        title={t('Sign in to see your library')}
        description={t('Everything you generate is saved here.')}
        action={
          <Button onClick={() => workspace.requireAuthentication()}>
            {t('Sign in now')}
          </Button>
        }
      />
    )
  } else if (query.isLoading) {
    body = (
      <div className='grid grid-cols-[repeat(auto-fill,minmax(14rem,1fr))] gap-3'>
        {Array.from({ length: 8 }, (_, index) => (
          <Skeleton key={index} className='aspect-square rounded-2xl' />
        ))}
      </div>
    )
  } else if (runs.length === 0) {
    body = (
      <EmptyState
        icon={FolderOpen}
        title={t('Nothing here yet')}
        description={t('Results you generate in Image, Video and Audio appear here.')}
        action={
          <Button
            onClick={() =>
              navigate({ to: '/create/$tool', params: { tool: 'image' } })
            }
          >
            {t('Start creating')}
          </Button>
        }
      />
    )
  } else {
    body = (
      <>
        <div className='grid grid-cols-[repeat(auto-fill,minmax(14rem,1fr))] gap-3'>
          {runs.map((run) => (
            <LibraryTile
              key={run.id}
              run={run}
              summary={runToSummary(run)}
              onOpen={() =>
                setLightboxIndex(images.findIndex((image) => image.run.id === run.id))
              }
              onReuse={() => reuse(run)}
            />
          ))}
        </div>
        <div ref={sentinelRef} className='h-px' aria-hidden='true' />
        {isFetchingNextPage && (
          <p className='text-muted-foreground py-4 text-center text-sm'>
            {t('Loading more…')}
          </p>
        )}
      </>
    )
  }

  return (
    <div className='min-h-0 flex-1 overflow-y-auto overscroll-contain'>
      <div className='mx-auto w-full max-w-7xl space-y-5 px-3 pt-5 pb-12 sm:px-6'>
        <div className='flex flex-wrap items-end justify-between gap-3'>
          <div className='space-y-1'>
            <h1 className='text-foreground text-xl font-semibold tracking-tight'>
              {t('Library')}
            </h1>
            <p className='text-muted-foreground text-sm'>
              {workspace.isAuthenticated && total > 0
                ? t('{{count}} results', { count: total })
                : t('Everything you have created')}
            </p>
          </div>
          <ModeSwitch<LibraryFilter>
            ariaLabel={t('Filter by type')}
            value={filter}
            onChange={setFilter}
            options={[
              { value: 'all', label: t('All') },
              { value: 'image', label: t('Image') },
              { value: 'video', label: t('Video') },
              { value: 'audio', label: t('Audio') },
            ]}
            className='w-full sm:w-auto sm:min-w-80'
          />
        </div>
        {body}
      </div>
      <MediaLightbox
        open={lightboxIndex !== null && lightboxIndex >= 0}
        onOpenChange={(open) => {
          if (!open) setLightboxIndex(null)
        }}
        items={images.map((image) => image.item)}
        index={lightboxIndex ?? 0}
        onIndexChange={setLightboxIndex}
      />
    </div>
  )
}
