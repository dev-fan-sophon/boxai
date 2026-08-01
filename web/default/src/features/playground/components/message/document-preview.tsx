import { useCallback, useEffect, useState } from 'react'
import { useTranslation } from 'react-i18next'

import {
  getPlaygroundAssetParse,
  startPlaygroundAssetParse,
  type PlaygroundDocumentParseState,
} from '../../api'
import type { ManagedDocumentArtifact } from '../../types'

/**
 * Preview reuses the server-side document parser that already backs uploads, so no OOXML reader,
 * PDF engine or font bundle ships to the browser.
 *
 * Documents are shown as extracted text rather than rendered in a frame. The asset endpoint
 * deliberately serves every document as an attachment so a generated file can never execute on
 * our own origin, and a text preview is what remains truthful under that rule. Downloading gives
 * the real file.
 */
export function DocumentPreview({
  artifact,
}: {
  artifact: ManagedDocumentArtifact
}) {
  const { t } = useTranslation()
  const [parse, setParse] = useState<PlaygroundDocumentParseState | null>(null)
  const [error, setError] = useState('')
  const isImage = /\.(png|jpe?g|gif|webp|svg)$/i.test(artifact.name)
  const isPdf =
    artifact.mime === 'application/pdf' || /\.pdf$/i.test(artifact.name)
  const renderPdfInline = isPdf && Boolean(artifact.url)

  const load = useCallback(async () => {
    setParse(null)
    setError('')
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
    if (!isImage && !renderPdfInline) void load()
  }, [isImage, renderPdfInline, load])

  if (isImage) {
    return (
      <img
        src={artifact.url}
        alt={artifact.name}
        className='max-h-full w-full rounded-lg border object-contain'
      />
    )
  }
  if (renderPdfInline && artifact.url) {
    // The real file with its real layout, rendered by the browser's built-in
    // PDF viewer; the text-extraction fallback below only covers other
    // formats. An <object> degrades to the download link on browsers that
    // cannot render PDFs inline.
    const inlineUrl = `${artifact.url}${artifact.url.includes('?') ? '&' : '?'}inline=1`
    return (
      <object
        data={inlineUrl}
        type='application/pdf'
        aria-label={artifact.name}
        className='border-border h-full min-h-[60vh] w-full rounded-lg border'
      >
        <div className='p-4 text-sm'>
          <a
            href={artifact.url}
            download={artifact.name}
            className='text-primary underline underline-offset-4'
          >
            {t('Download')} {artifact.name}
          </a>
        </div>
      </object>
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
    <div className='bg-muted/30 border-border rounded-lg border p-4 text-sm leading-6 whitespace-pre-wrap'>
      {parse.text}
    </div>
  )
}
