import {
  AlertTriangle,
  Download,
  Eye,
  FileSpreadsheet,
  FileText,
  ImageIcon,
  Presentation,
} from 'lucide-react'
import { useCallback, useEffect, useState, type ComponentType } from 'react'
import { useTranslation } from 'react-i18next'

import { Button } from '@/components/ui/button'
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog'
import { cn } from '@/lib/utils'

import {
  getPlaygroundAssetParse,
  startPlaygroundAssetParse,
  type PlaygroundDocumentParseState,
} from '../../api'
import type { ManagedDocumentArtifact } from '../../types'

const ICONS: Array<[RegExp, ComponentType<{ className?: string }>]> = [
  [/\.(xlsx|xls|csv)$/i, FileSpreadsheet],
  [/\.(pptx|ppt)$/i, Presentation],
  [/\.(png|jpe?g|gif|webp|svg)$/i, ImageIcon],
]

function iconFor(name: string): ComponentType<{ className?: string }> {
  return ICONS.find(([pattern]) => pattern.test(name))?.[1] ?? FileText
}

function formatBytes(bytes: number): string {
  if (bytes < 1024) return `${bytes} B`
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(0)} KB`
  return `${(bytes / (1024 * 1024)).toFixed(1)} MB`
}

/**
 * Preview reuses the server-side document parser that already backs uploads, so no OOXML reader,
 * PDF engine or font bundle ships to the browser.
 *
 * Documents are shown as extracted text rather than rendered in a frame. The asset endpoint
 * deliberately serves every document as an attachment so a generated file can never execute on
 * our own origin, and a text preview is what remains truthful under that rule. Downloading gives
 * the real file.
 */
function DocumentPreview({ artifact }: { artifact: ManagedDocumentArtifact }) {
  const { t } = useTranslation()
  const [parse, setParse] = useState<PlaygroundDocumentParseState | null>(null)
  const [error, setError] = useState('')
  const isImage = /\.(png|jpe?g|gif|webp|svg)$/i.test(artifact.name)

  const load = useCallback(async () => {
    try {
      let state = await startPlaygroundAssetParse(artifact.assetId)
      // The parse runs server-side and is cached, so a re-preview is instant and only a first
      // look ever waits.
      for (
        let attempt = 0;
        attempt < 20 && state.status === 'processing';
        attempt += 1
      ) {
        await new Promise((resolve) => setTimeout(resolve, 1000))
        state = await getPlaygroundAssetParse(artifact.assetId)
      }
      setParse(state)
    } catch (err) {
      setError(err instanceof Error ? err.message : t('Preview is unavailable'))
    }
  }, [artifact.assetId, t])

  useEffect(() => {
    if (!isImage) void load()
  }, [isImage, load])

  if (isImage) {
    return (
      <img
        src={artifact.url}
        alt={artifact.name}
        className='max-h-[70vh] w-full rounded-lg border object-contain'
      />
    )
  }
  if (error) {
    return <p className='text-destructive text-sm'>{error}</p>
  }
  if (!parse || parse.status === 'processing') {
    return (
      <div className='space-y-2' aria-hidden='true'>
        <div className='skeleton-shimmer h-3 w-4/5 rounded-full' />
        <div className='skeleton-shimmer h-3 w-3/5 rounded-full' />
        <div className='skeleton-shimmer h-3 w-2/3 rounded-full' />
      </div>
    )
  }
  if (parse.status !== 'done' || !parse.text) {
    return (
      <p className='text-muted-foreground text-sm'>
        {t('This file can only be viewed after downloading it.')}
      </p>
    )
  }
  return (
    <pre className='bg-muted/40 max-h-[70vh] overflow-auto rounded-lg p-4 text-sm whitespace-pre-wrap'>
      {parse.text}
    </pre>
  )
}

export function ManagedDocumentArtifacts({
  artifacts,
}: {
  artifacts: ManagedDocumentArtifact[]
}) {
  const { t } = useTranslation()
  const [preview, setPreview] = useState<ManagedDocumentArtifact | null>(null)

  if (artifacts.length === 0) return null

  return (
    <div className='mt-3 space-y-2'>
      {artifacts.map((artifact) => {
        const Icon = iconFor(artifact.name)
        return (
          <div
            key={artifact.assetId}
            className='border-border bg-background/60 flex items-center gap-3 rounded-lg border px-3 py-2'
          >
            <Icon className='text-muted-foreground size-5 shrink-0' />
            <span className='min-w-0 flex-1'>
              <span className='block truncate text-sm font-medium' title={artifact.name}>
                {artifact.name}
              </span>
              <span className='text-muted-foreground flex items-center gap-1.5 text-xs'>
                {formatBytes(artifact.size)}
                {!artifact.verified && (
                  <span
                    className='text-warning flex items-center gap-1'
                    title={t(
                      'This file could not be reopened after it was written, so it may not open correctly.'
                    )}
                  >
                    <AlertTriangle className='size-3' />
                    {t('May be damaged')}
                  </span>
                )}
              </span>
            </span>
            <Button
              variant='ghost'
              size='icon'
              aria-label={t('Preview')}
              onClick={() => setPreview(artifact)}
            >
              <Eye className='size-4' />
            </Button>
            <a
              href={artifact.url}
              download={artifact.name}
              aria-label={t('Download')}
              className='text-muted-foreground hover:bg-muted hover:text-foreground flex size-9 items-center justify-center rounded-md'
            >
              <Download className='size-4' />
            </a>
          </div>
        )
      })}

      <Dialog open={Boolean(preview)} onOpenChange={(open) => !open && setPreview(null)}>
        <DialogContent className={cn('max-w-4xl')}>
          <DialogHeader>
            <DialogTitle className='truncate'>{preview?.name}</DialogTitle>
          </DialogHeader>
          {preview && <DocumentPreview artifact={preview} />}
        </DialogContent>
      </Dialog>
    </div>
  )
}
