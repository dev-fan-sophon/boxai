/* oxlint-disable react/iframe-missing-sandbox -- Native browser PDF viewers cannot render in sandboxed frames. */
import { useCallback, useEffect, useState } from 'react'
import { useTranslation } from 'react-i18next'

import {
  getPlaygroundAssetParse,
  startPlaygroundAssetParse,
  type PlaygroundDocumentParseState,
} from '../../api'
import type { ManagedDocumentArtifact } from '../../types'

/**
 * PDFs use the browser's native viewer with the authenticated asset URL. Other
 * formats reuse the server-side parser, so no Office renderer ships to the
 * browser and users can still inspect their generated content before download.
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
    // Render the real PDF directly and ask the browser viewer to fit the page
    // without its cramped thumbnail and toolbar chrome. The download action
    // remains in the preview header.
    const inlineUrl = `${artifact.url}${artifact.url.includes('?') ? '&' : '?'}inline=1#view=Fit&toolbar=0&navpanes=0&pagemode=none`
    return (
      <iframe
        src={inlineUrl}
        title={artifact.name}
        className='bg-muted/20 h-full min-h-[70vh] w-full border-0'
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
    <div className='bg-muted/30 border-border rounded-lg border p-4 text-sm leading-6 whitespace-pre-wrap'>
      {parse.text}
    </div>
  )
}
