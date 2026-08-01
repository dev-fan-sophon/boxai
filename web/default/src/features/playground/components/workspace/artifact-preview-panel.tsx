import { Download, X } from 'lucide-react'
import { useEffect } from 'react'
import { useTranslation } from 'react-i18next'

import { Button } from '@/components/ui/button'

import { useArtifactPreviewStore } from '../../lib/artifact-preview-store'
import { DocumentPreview } from '../message/document-preview'

/**
 * Claude-style artifact preview: a side panel next to the chat on desktop and
 * a full-screen overlay on small screens, instead of a modal dialog.
 */
export function ArtifactPreviewPanel() {
  const { t } = useTranslation()
  const artifact = useArtifactPreviewStore((state) => state.artifact)
  const close = useArtifactPreviewStore((state) => state.close)

  useEffect(() => {
    if (!artifact) return
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key === 'Escape') close()
    }
    window.addEventListener('keydown', onKeyDown)
    return () => window.removeEventListener('keydown', onKeyDown)
  }, [artifact, close])

  if (!artifact) return null

  return (
    <aside
      role='complementary'
      aria-label={t('Artifact preview')}
      className='bg-background lg:border-border fixed inset-0 z-50 flex flex-col lg:static lg:z-auto lg:w-[clamp(320px,38vw,540px)] lg:shrink-0 lg:border-l'
    >
      <header className='border-border flex items-center gap-2 border-b px-4 py-3'>
        <span className='min-w-0 flex-1'>
          <span
            className='block truncate text-sm font-medium'
            title={artifact.name}
          >
            {artifact.name}
          </span>
        </span>
        {artifact.url && (
          <a
            href={artifact.url}
            download={artifact.name}
            aria-label={t('Download')}
            className='text-muted-foreground hover:bg-muted hover:text-foreground flex size-8 items-center justify-center rounded-md'
          >
            <Download className='size-4' />
          </a>
        )}
        <Button
          variant='ghost'
          size='icon'
          className='size-8'
          aria-label={t('Close preview')}
          onClick={close}
        >
          <X className='size-4' />
        </Button>
      </header>
      <div className='min-h-0 flex-1 overflow-y-auto p-4'>
        <DocumentPreview key={artifact.assetId} artifact={artifact} />
      </div>
    </aside>
  )
}
