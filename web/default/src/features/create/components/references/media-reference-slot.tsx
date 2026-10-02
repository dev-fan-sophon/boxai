import { Film, ImagePlus, Library, Music2, QrCode, X } from 'lucide-react'
import { useLayoutEffect, useRef, useState } from 'react'
import { useTranslation } from 'react-i18next'
import { toast } from 'sonner'

import { Button } from '@/components/ui/button'
import {
  createUploadSession,
  getUploadSession,
  uploadPlaygroundAsset,
  type PlaygroundAsset,
} from '@/features/playground/api'
import { cn } from '@/lib/utils'

import { AssetLibraryDialog } from './asset-library-dialog'

export type MediaReference = {
  id: string
  name: string
  dataUrl: string
  file?: File
  assetId?: number
}

type MediaReferenceSlotProps = {
  label: string
  value: MediaReference[]
  onChange: (value: MediaReference[]) => void
  onUploadingChange?: (uploading: boolean) => void
  accept?: string
  className?: string
  /** Disable local uploads when the model cannot accept references. */
  attachable?: boolean
  kind?: 'image' | 'video' | 'audio'
  maxFiles?: number
  /** Optional role badge (First / Last / 1, 2, …) drawn on each thumbnail. */
  roleForIndex?: (index: number) => string
}

export function MediaReferenceSlot(props: MediaReferenceSlotProps) {
  const { t } = useTranslation()
  const inputRef = useRef<HTMLInputElement>(null)
  const attachable = props.attachable !== false
  const maxFiles = props.maxFiles ?? 1
  const [libraryOpen, setLibraryOpen] = useState(false)
  const [qrPolling, setQrPolling] = useState(false)
  const [uploading, setUploading] = useState(false)
  const uploadingRef = useRef(false)
  const currentProps = useRef(props)
  const generation = useRef(0)
  const qrTimer = useRef<ReturnType<typeof setTimeout> | undefined>(undefined)
  const qrActive = useRef(false)

  useLayoutEffect(() => {
    currentProps.current = props
  })
  useLayoutEffect(() => {
    setQrPolling(false)
    setUploading(false)
    return () => {
      generation.current += 1
      clearTimeout(qrTimer.current)
      qrActive.current = false
      if (uploadingRef.current) currentProps.current.onUploadingChange?.(false)
      uploadingRef.current = false
    }
  }, [props.kind, attachable])

  const kind = props.kind ?? 'image'
  const limitMessage = (count: number) => {
    if (kind === 'video') {
      return t('You can attach up to {{count}} reference videos.', { count })
    }
    if (kind === 'audio') {
      return t('You can attach up to {{count}} reference audios.', { count })
    }
    return t('You can attach up to {{count}} images.', { count })
  }
  let SlotIcon = ImagePlus
  if (kind === 'video') SlotIcon = Film
  else if (kind === 'audio') SlotIcon = Music2

  const handleFiles = async (files: File[]) => {
    if (uploadingRef.current || !attachable) return
    const startedGeneration = generation.current
    const remaining = maxFiles - props.value.length
    if (remaining <= 0) {
      toast.error(limitMessage(maxFiles))
      return
    }

    const validFiles = files.filter((file) => {
      // Some browsers leave the MIME type of audio/video files empty.
      const typeMatches =
        file.type.startsWith(`${kind}/`) || (kind !== 'image' && !file.type)
      if (!typeMatches) {
        let message = t('Please choose an image file.')
        if (kind === 'video') message = t('Please choose a video file.')
        else if (kind === 'audio') message = t('Please choose an audio file.')
        toast.error(message)
        return false
      }
      // Align with backend PlaygroundAssetMaxImageBytes (10MB)
      if (file.size > 10 * 1024 * 1024 && file.type.startsWith('image/')) {
        toast.error(t('Image must be under 10MB.'))
        return false
      }
      return true
    })
    const acceptedFiles = validFiles.slice(0, remaining)
    if (validFiles.length > remaining) {
      toast.error(limitMessage(maxFiles))
    }

    if (acceptedFiles.length === 0) return
    uploadingRef.current = true
    setUploading(true)
    props.onUploadingChange?.(true)
    const references: MediaReference[] = []
    try {
      for (const file of acceptedFiles) {
        const asset = await uploadPlaygroundAsset(
          file,
          props.kind ?? 'image',
          'attachment'
        )
        if (startedGeneration !== generation.current) return
        references.push({
          id: `asset-${asset.id}`,
          name: file.name,
          dataUrl: asset.url,
          assetId: asset.id,
        })
      }
    } catch (error) {
      if (startedGeneration === generation.current) {
        toast.error(error instanceof Error ? error.message : t('Upload failed'))
      }
    } finally {
      if (startedGeneration === generation.current) {
        const current = currentProps.current
        const available = Math.max(
          0,
          (current.maxFiles ?? 1) - current.value.length
        )
        const additions = references.slice(0, available)
        if (additions.length > 0) {
          current.onChange([...current.value, ...additions])
        }
        uploadingRef.current = false
        setUploading(false)
        current.onUploadingChange?.(false)
      }
    }
  }

  const selectAsset = (asset: PlaygroundAsset) => {
    const current = currentProps.current
    if (current.attachable === false) return false
    if (current.value.length >= (current.maxFiles ?? 1)) {
      toast.error(limitMessage(current.maxFiles ?? 1))
      return false
    }
    current.onChange([
      ...current.value,
      {
        id: `asset-${asset.id}`,
        name: asset.name || `asset-${asset.id}`,
        dataUrl: asset.url,
        assetId: asset.id,
      },
    ])
    return true
  }

  const startQrSession = async () => {
    if (qrActive.current || !attachable) return
    qrActive.current = true
    const startedGeneration = generation.current
    try {
      setQrPolling(true)
      const session = await createUploadSession(props.kind ?? 'image')
      if (startedGeneration !== generation.current) return
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
        if (startedGeneration !== generation.current) return
        if (Date.now() > deadline) {
          qrActive.current = false
          setQrPolling(false)
          return
        }
        try {
          const status = await getUploadSession(session.token)
          if (startedGeneration !== generation.current) return
          if (status.asset) {
            if (selectAsset(status.asset)) {
              toast.success(t('Asset received from upload session'))
            }
            qrActive.current = false
            setQrPolling(false)
            return
          }
        } catch {
          // keep polling
        }
        if (startedGeneration === generation.current) {
          qrTimer.current = setTimeout(() => void poll(), 2500)
        }
      }
      void poll()
    } catch (err) {
      if (startedGeneration !== generation.current) return
      qrActive.current = false
      setQrPolling(false)
      toast.error(
        err instanceof Error
          ? err.message
          : t('Could not create upload session')
      )
    }
  }

  return (
    <div className={cn('flex flex-wrap items-center gap-1', props.className)}>
      <button
        type='button'
        disabled={uploading || !attachable}
        onClick={() => inputRef.current?.click()}
        className={cn(
          'inline-flex h-8 items-center gap-1.5 rounded-lg border border-transparent px-2 text-2xs font-medium transition-colors',
          'outline-none focus-visible:ring-2 focus-visible:ring-ring',
          props.value.length > 0
            ? 'border-primary/40 bg-primary/10 text-primary'
            : 'text-muted-foreground hover:bg-muted/70 hover:text-foreground'
        )}
        aria-label={props.label}
      >
        <SlotIcon className='size-3.5' aria-hidden='true' />
        <span className='max-w-24 truncate'>{props.label}</span>
        {props.value.length > 0 && (
          <span className='tabular-nums'>({props.value.length})</span>
        )}
      </button>
      {props.value.map((reference, index) => (
        <span
          key={reference.id}
          className='group/reference relative size-8 shrink-0'
        >
          <ReferenceThumbnail kind={kind} reference={reference} />
          {props.roleForIndex ? (
            <span className='bg-background/85 text-foreground/90 text-4xs pointer-events-none absolute bottom-0 left-0 rounded px-0.5 font-semibold'>
              {props.roleForIndex(index)}
            </span>
          ) : null}
          <button
            type='button'
            disabled={uploading}
            className='bg-background/90 text-foreground focus-visible:ring-ring absolute -top-1 -right-1 flex size-4 items-center justify-center rounded-full shadow-sm outline-none focus-visible:ring-2'
            aria-label={`${t('Remove reference')}: ${reference.name}`}
            onClick={() =>
              props.onChange(
                props.value.filter((_, itemIndex) => itemIndex !== index)
              )
            }
          >
            <X className='size-2.5' aria-hidden='true' />
          </button>
        </span>
      ))}
      <Button
        type='button'
        variant='ghost'
        size='icon'
        className='text-muted-foreground hover:bg-muted/70 hover:text-foreground size-8'
        aria-label={t('Asset library')}
        disabled={uploading || !attachable}
        onClick={() => setLibraryOpen(true)}
      >
        <Library className='size-3.5' />
      </Button>
      <Button
        type='button'
        variant='ghost'
        size='icon'
        className='text-muted-foreground hover:bg-muted/70 hover:text-foreground size-8'
        aria-label={t('Scan to upload')}
        disabled={qrPolling || uploading || !attachable}
        onClick={() => void startQrSession()}
      >
        <QrCode className='size-3.5' />
      </Button>
      <input
        ref={inputRef}
        type='file'
        disabled={uploading || !attachable}
        accept={props.accept ?? 'image/*'}
        multiple={maxFiles > 1}
        className='sr-only'
        onChange={(event) => {
          void handleFiles([...(event.target.files ?? [])])
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

/** Image preview, first video frame, or an audio badge for one reference. */
function ReferenceThumbnail(props: {
  kind: 'image' | 'video' | 'audio'
  reference: MediaReference
}) {
  if (props.kind === 'video') {
    return (
      <video
        src={props.reference.dataUrl}
        muted
        playsInline
        preload='metadata'
        aria-label={props.reference.name}
        className='border-border size-8 rounded-md border bg-black object-cover'
      />
    )
  }
  if (props.kind === 'audio') {
    return (
      <span
        role='img'
        aria-label={props.reference.name}
        title={props.reference.name}
        className='border-border bg-muted text-muted-foreground flex size-8 items-center justify-center rounded-md border'
      >
        <Music2 className='size-3.5' aria-hidden='true' />
      </span>
    )
  }
  return (
    <img
      src={props.reference.dataUrl}
      alt={props.reference.name}
      className='border-border size-8 rounded-md border object-cover'
    />
  )
}
