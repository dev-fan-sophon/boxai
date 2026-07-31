import { useQuery } from '@tanstack/react-query'
import { createFileRoute, useParams } from '@tanstack/react-router'
import { useEffect } from 'react'
import { useTranslation } from 'react-i18next'

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
      <div className='flex h-dvh items-center justify-center text-sm'>
        {t('This shared canvas is unavailable or has expired.')}
      </div>
    )
  }
  return (
    <main className='flex h-dvh flex-col'>
      <header className='border-b px-4 py-3'>
        <h1 className='font-semibold'>{canvas.data.title}</h1>
        <p className='text-muted-foreground text-xs'>
          {t('Read-only shared canvas')}
        </p>
      </header>
      <div className='min-h-0 flex-1'>
        <WorkbenchCanvas readOnly />
      </div>
    </main>
  )
}
