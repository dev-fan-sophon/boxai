/*
Copyright (C) 2023-2026 QuantumNous

This program is free software: you can redistribute it and/or modify
it under the terms of the GNU Affero General Public License as
published by the Free Software Foundation, either version 3 of the
License, or (at your option) any later version.
*/
import {
  Check,
  ChevronLeft,
  ChevronRight,
  Download,
  ExternalLink,
  Loader2,
  X,
} from 'lucide-react'
import { useEffect, useState, type ReactNode } from 'react'
import { useTranslation } from 'react-i18next'
import { toast } from 'sonner'

import { Button } from '@/components/ui/button'
import { Dialog, DialogContent, DialogTitle } from '@/components/ui/dialog'
import { cn } from '@/lib/utils'

import { downloadGeneratedMedia } from '../../lib/download-generated-media'

export type LightboxItem = {
  url: string
  alt?: string
  caption?: string
  downloadName?: string
}

function DownloadIcon(props: { downloading: boolean; done: boolean }) {
  if (props.downloading) return <Loader2 className='size-4 animate-spin' />
  if (props.done) return <Check className='size-4' />
  return <Download className='size-4' />
}

type MediaLightboxProps = {
  open: boolean
  onOpenChange: (open: boolean) => void
  items: LightboxItem[]
  index: number
  onIndexChange: (index: number) => void
  /** Extra per-item actions rendered next to download (e.g. use as reference). */
  actions?: (item: LightboxItem, index: number) => ReactNode
}

/**
 * Full-screen media viewer for generated and attached images: constrained
 * natural-size display, keyboard navigation, download and open-original.
 */
export function MediaLightbox(props: MediaLightboxProps) {
  const { t } = useTranslation()
  const [downloading, setDownloading] = useState(false)
  const [downloadDone, setDownloadDone] = useState(false)
  const count = props.items.length
  const index = Math.min(Math.max(props.index, 0), Math.max(count - 1, 0))
  const item = props.items[index]

  useEffect(() => {
    setDownloading(false)
    setDownloadDone(false)
  }, [index, props.open])

  useEffect(() => {
    if (!props.open || count <= 1) return
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key === 'ArrowLeft') {
        event.preventDefault()
        props.onIndexChange((index - 1 + count) % count)
      } else if (event.key === 'ArrowRight') {
        event.preventDefault()
        props.onIndexChange((index + 1) % count)
      }
    }
    window.addEventListener('keydown', onKeyDown)
    return () => window.removeEventListener('keydown', onKeyDown)
  }, [props, index, count])

  if (!item) return null

  const download = async () => {
    setDownloading(true)
    try {
      await downloadGeneratedMedia(
        item.url,
        item.downloadName || `image-${index + 1}`,
        'image'
      )
      setDownloadDone(true)
      toast.success(t('Download started'))
    } catch {
      toast.error(t('Download failed'))
    } finally {
      setDownloading(false)
    }
  }

  const canOpenOriginal =
    !item.url.startsWith('data:') && !item.url.startsWith('blob:')

  return (
    <Dialog open={props.open} onOpenChange={props.onOpenChange}>
      <DialogContent
        showCloseButton={false}
        className={cn(
          'top-0 left-0 h-dvh w-screen max-w-none translate-x-0 translate-y-0 sm:max-w-none',
          'block rounded-none border-0 bg-black/70 p-0 ring-0',
          'supports-backdrop-filter:bg-black/50 supports-backdrop-filter:backdrop-blur-lg'
        )}
      >
        <DialogTitle className='sr-only'>
          {item.alt || t('Image preview')}
        </DialogTitle>

        <div
          className='flex h-full w-full items-center justify-center p-4 pb-24 sm:p-12 sm:pb-28'
          onClick={(event) => {
            if (event.target === event.currentTarget) {
              props.onOpenChange(false)
            }
          }}
        >
          <img
            key={item.url}
            src={item.url}
            alt={item.alt || t('Image preview')}
            className='max-h-full max-w-full rounded-lg object-contain shadow-2xl select-none'
            referrerPolicy='no-referrer'
            draggable={false}
          />
        </div>

        {count > 1 && (
          <span className='absolute top-4 left-4 rounded-full bg-black/50 px-2.5 py-1 text-xs text-white/90 tabular-nums backdrop-blur-sm'>
            {index + 1} / {count}
          </span>
        )}
        <Button
          size='icon'
          variant='ghost'
          className='absolute top-3 right-3 rounded-full bg-black/50 text-white/90 backdrop-blur-sm hover:bg-black/70 hover:text-white'
          aria-label={t('Close')}
          onClick={() => props.onOpenChange(false)}
        >
          <X className='size-5' />
        </Button>

        {count > 1 && (
          <>
            <Button
              size='icon'
              variant='ghost'
              className='absolute top-1/2 left-3 -translate-y-1/2 rounded-full bg-black/50 text-white/90 backdrop-blur-sm hover:bg-black/70 hover:text-white sm:left-5'
              aria-label={t('Previous image')}
              onClick={() => props.onIndexChange((index - 1 + count) % count)}
            >
              <ChevronLeft className='size-6' />
            </Button>
            <Button
              size='icon'
              variant='ghost'
              className='absolute top-1/2 right-3 -translate-y-1/2 rounded-full bg-black/50 text-white/90 backdrop-blur-sm hover:bg-black/70 hover:text-white sm:right-5'
              aria-label={t('Next image')}
              onClick={() => props.onIndexChange((index + 1) % count)}
            >
              <ChevronRight className='size-6' />
            </Button>
          </>
        )}

        <div className='pointer-events-none absolute inset-x-0 bottom-[max(1rem,env(safe-area-inset-bottom,0px))] flex flex-col items-center gap-2 px-4'>
          {item.caption && (
            <p className='pointer-events-auto line-clamp-2 max-w-2xl rounded-lg bg-black/40 px-3 py-1 text-center text-xs text-pretty text-white/80 backdrop-blur-sm'>
              {item.caption}
            </p>
          )}
          <div className='pointer-events-auto flex flex-wrap items-center justify-center gap-1 rounded-full bg-black/60 p-1.5 shadow-lg backdrop-blur-md'>
            <Button
              size='sm'
              variant='ghost'
              className='rounded-full text-white hover:bg-white/15 hover:text-white'
              disabled={downloading}
              onClick={() => void download()}
            >
              <DownloadIcon downloading={downloading} done={downloadDone} />
              {downloadDone ? t('Saved') : t('Download')}
            </Button>
            {canOpenOriginal && (
              <Button
                size='sm'
                variant='ghost'
                className='rounded-full text-white hover:bg-white/15 hover:text-white'
                onClick={() => window.open(item.url, '_blank', 'noopener')}
              >
                <ExternalLink className='size-4' />
                {t('Open original')}
              </Button>
            )}
            {props.actions?.(item, index)}
          </div>
        </div>
      </DialogContent>
    </Dialog>
  )
}
