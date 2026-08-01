import {
  AlertTriangle,
  Download,
  Eye,
  FileSpreadsheet,
  FileText,
  ImageIcon,
  Presentation,
} from 'lucide-react'
import type { ComponentType } from 'react'
import { useTranslation } from 'react-i18next'

import { Button } from '@/components/ui/button'

import { useArtifactPreviewStore } from '../../lib/artifact-preview-store'
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

export function ManagedDocumentArtifacts({
  artifacts,
}: {
  artifacts: ManagedDocumentArtifact[]
}) {
  const { t } = useTranslation()
  const openPreview = useArtifactPreviewStore((state) => state.open)

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
              <span
                className='block truncate text-sm font-medium'
                title={artifact.name}
              >
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
              onClick={() => openPreview(artifact)}
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
    </div>
  )
}
