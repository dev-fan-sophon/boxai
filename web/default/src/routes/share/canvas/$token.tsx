import { useQuery } from '@tanstack/react-query'
import { createFileRoute, useParams } from '@tanstack/react-router'
import { useEffect } from 'react'
import { useTranslation } from 'react-i18next'

import { EmptyState } from '@/components/empty-state'
import { Eye, Unlink } from '@/components/icons'
import { Badge } from '@/components/ui/badge'
import { Spinner } from '@/components/ui/spinner'
import { getPublicCanvas } from '@/features/workbench/api'
import { WorkbenchCanvas } from '@/features/workbench/components/workbench-canvas'
import { useCanvasStore } from '@/features/workbench/store/canvas-store'
import type { CanvasDocument } from '@/features/workbench/types'

export const Route = createFileRoute('/share/canvas/$token')({
  component: SharedCanvasPage,
})

function SharedCanvasPage() {
  const { t } = useTranslation()
  const { token } = useParams({ from: '/share/canvas/$token' })
  const loadDocument = useCanvasStore((state) => state.loadDocument)
  const canvas = useQuery({
    queryKey: ['shared-canvas', token],
    queryFn: () => getPublicCanvas(token),
    retry: false,
  })
  useEffect(() => {
    if (!canvas.data) return
    try {
      loadDocument(JSON.parse(canvas.data.doc) as CanvasDocument)
    } catch {
      loadDocument(null)
    }
  }, [canvas.data, loadDocument])
  if (canvas.isLoading) {
    return (
      <div className='flex h-dvh items-center justify-center'>
        <Spinner />
      </div>
    )
  }
  if (!canvas.data || canvas.isError) {
    return (
      <div className='bg-background flex h-dvh items-center justify-center p-4'>
        <EmptyState
          icon={Unlink}
          title={t('This shared canvas is unavailable or has expired.')}
          className='w-full max-w-md'
        />
      </div>
    )
  }
  return (
    <main className='flex h-dvh flex-col'>
      <header className='bg-background/80 flex min-h-14 shrink-0 items-center gap-3 border-b px-4 py-2 pt-[max(0.5rem,env(safe-area-inset-top,0px))] backdrop-blur'>
        <h1
          className='min-w-0 flex-1 truncate text-base font-semibold'
          title={canvas.data.title}
        >
          {canvas.data.title}
        </h1>
        <Badge
          variant='secondary'
          className='shrink-0'
          title={t('Read-only shared canvas')}
        >
          <Eye aria-hidden='true' />
          <span className='max-sm:sr-only'>{t('Read-only shared canvas')}</span>
        </Badge>
      </header>
      <div className='min-h-0 flex-1'>
        <WorkbenchCanvas readOnly />
      </div>
    </main>
  )
}
