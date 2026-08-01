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
    if (!isImage) void load()
  }, [isImage, load])

  if (isImage) {
    return (
      <img
        src={artifact.url}
        alt={artifact.name}
        className='max-h-full w-full rounded-lg border object-contain'
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
    <pre className='bg-muted/40 rounded-lg p-4 text-sm whitespace-pre-wrap'>
      {parse.text}
    </pre>
  )
}
