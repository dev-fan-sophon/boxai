/*
Copyright (C) 2023-2026 QuantumNous

This program is free software: you can redistribute it and/or modify
it under the terms of the GNU Affero General Public License as
published by the Free Software Foundation, either version 3 of the
License, or (at your option) any later version.
*/
import { ImagePlus, QrCode, Trash2, Library } from 'lucide-react'
import { useRef, useState } from 'react'
import { useTranslation } from 'react-i18next'
import { toast } from 'sonner'

import { Button } from '@/components/ui/button'
import { cn } from '@/lib/utils'

import {
  createUploadSession,
  getUploadSession,
  type PlaygroundAsset,
} from '../../../api'
import { AssetLibraryDialog } from './asset-library-dialog'

export type MediaReference = {
  name: string
  dataUrl: string
  file?: File
  assetId?: number
}

type MediaReferenceSlotProps = {
  label: string
  value: MediaReference | null
  onChange: (value: MediaReference | null) => void
  accept?: string
  className?: string
  /** When false, file is kept in UI only (backend may not accept it yet). */
  attachable?: boolean
  kind?: 'image' | 'video' | 'audio'
}

export function MediaReferenceSlot(props: MediaReferenceSlotProps) {
  const { t } = useTranslation()
  const inputRef = useRef<HTMLInputElement>(null)
  const attachable = props.attachable !== false
  const [libraryOpen, setLibraryOpen] = useState(false)
  const [qrPolling, setQrPolling] = useState(false)

  const handleFile = (file: File | undefined) => {
    if (!file) return
    if (!file.type.startsWith('image/') && props.kind !== 'audio' && props.kind !== 'video') {
      toast.error(t('Please choose an image file.'))
      return
    }
    // Align with backend PlaygroundAssetMaxImageBytes (10MB)
    if (file.size > 10 * 1024 * 1024 && file.type.startsWith('image/')) {
      toast.error(t('Image must be under 10MB.'))
      return
    }
    const reader = new FileReader()
    reader.addEventListener('load', () => {
      const dataUrl = String(reader.result ?? '')
      if (!dataUrl) {
        toast.error(t('Could not read the selected image.'))
        return
      }
      props.onChange({ name: file.name, dataUrl, file })
      if (!attachable) {
        toast.info(t('Reference saved locally'), {
          description: t(
            'This model path may not send reference media yet. The file stays ready in the workbench.'
          ),
        })
      }
    })
    reader.addEventListener('error', () => {
      toast.error(t('Could not read the selected image.'))
    })
    reader.readAsDataURL(file)
  }

  const selectAsset = (asset: PlaygroundAsset) => {
    props.onChange({
      name: asset.name || `asset-${asset.id}`,
      dataUrl: asset.url,
      assetId: asset.id,
    })
  }

  const startQrSession = async () => {
    try {
      setQrPolling(true)
      const session = await createUploadSession(props.kind ?? 'image')
      toast.info(t('Scan to upload'), {
        description: t(
          'Session ready for {{minutes}} min. Upload from another device to: {{url}}',
          {
            minutes: 15,
            url: session.upload_url,
          }
        ),
        duration: 12_000,
      })
      // poll for completed upload
      const deadline = Date.now() + 15 * 60 * 1000
      const poll = async () => {
        if (Date.now() > deadline) {
          setQrPolling(false)
          return
        }
        try {
          const status = await getUploadSession(session.token)
          if (status.asset) {
            selectAsset(status.asset)
            toast.success(t('Asset received from upload session'))
            setQrPolling(false)
            return
          }
        } catch {
          // keep polling
        }
        window.setTimeout(() => void poll(), 2500)
      }
      void poll()
    } catch (err) {
      setQrPolling(false)
      toast.error(
        err instanceof Error ? err.message : t('Could not create upload session')
      )
    }
  }

  return (
    <div className={cn('flex items-center gap-1', props.className)}>
      <button
        type='button'
        onClick={() => inputRef.current?.click()}
        className={cn(
          'inline-flex h-8 items-center gap-1.5 rounded-lg border border-transparent px-2 text-[11px] font-medium transition-colors',
          'outline-none focus-visible:ring-2 focus-visible:ring-ring',
          props.value
            ? 'border-primary/40 bg-primary/10 text-primary'
            : 'text-muted-foreground hover:bg-muted/70 hover:text-foreground'
        )}
        aria-label={props.label}
      >
        {props.value ? (
          <img
            src={props.value.dataUrl}
            alt={props.value.name}
            className='size-5 rounded object-cover'
          />
        ) : (
          <ImagePlus className='size-3.5' aria-hidden='true' />
        )}
        <span className='max-w-24 truncate'>{props.label}</span>
      </button>
      <Button
        type='button'
        variant='ghost'
        size='icon'
        className='size-8 text-muted-foreground hover:bg-muted/70 hover:text-foreground'
        aria-label={t('Asset library')}
        onClick={() => setLibraryOpen(true)}
      >
        <Library className='size-3.5' />
      </Button>
      <Button
        type='button'
        variant='ghost'
        size='icon'
        className='size-8 text-muted-foreground hover:bg-muted/70 hover:text-foreground'
        aria-label={t('Scan to upload')}
        disabled={qrPolling}
        onClick={() => void startQrSession()}
      >
        <QrCode className='size-3.5' />
      </Button>
      {props.value && (
        <Button
          type='button'
          variant='ghost'
          size='icon'
          className='size-8 text-muted-foreground hover:bg-destructive/10 hover:text-destructive'
          aria-label={t('Remove reference')}
          onClick={() => props.onChange(null)}
        >
          <Trash2 className='size-3.5' />
        </Button>
      )}
      <input
        ref={inputRef}
        type='file'
        accept={props.accept ?? 'image/*'}
        className='sr-only'
        onChange={(event) => {
          handleFile(event.target.files?.[0])
          event.target.value = ''
        }}
      />
      <AssetLibraryDialog
        open={libraryOpen}
        onOpenChange={setLibraryOpen}
        kind={props.kind ?? 'image'}
        onSelect={selectAsset}
      />
    </div>
  )
}
