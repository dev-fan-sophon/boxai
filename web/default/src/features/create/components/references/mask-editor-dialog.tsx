import { useEffect, useRef, useState, type PointerEvent } from 'react'
import { useTranslation } from 'react-i18next'

import { Brush, Eraser, Trash2 } from '@/components/icons'
import { Button } from '@/components/ui/button'
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog'
import { SegmentedControl } from '@/components/ui/segmented-control'
import { Slider } from '@/components/ui/slider'

type BrushMode = 'paint' | 'erase'
type ImageSize = { width: number; height: number }

const MIN_BRUSH = 8
const MAX_BRUSH = 120
const DEFAULT_BRUSH = 40

/**
 * Inpainting mask editor for GPT Image edits. The user paints the area to
 * change over the first reference; saving exports a PNG at the image's
 * natural size that is opaque everywhere except the painted area, which is
 * fully transparent — the OpenAI mask contract (transparent = edit here).
 */
export function MaskEditorDialog(props: {
  open: boolean
  onOpenChange: (open: boolean) => void
  imageUrl: string
  /** Previously saved mask, restored as paint when the dialog opens. */
  mask: string | null
  onSave: (mask: string | null) => void
}) {
  const { t } = useTranslation()
  const canvasRef = useRef<HTMLCanvasElement>(null)
  const lastPoint = useRef<{ x: number; y: number } | null>(null)
  const [size, setSize] = useState<ImageSize | null>(null)
  const [mode, setMode] = useState<BrushMode>('paint')
  const [brush, setBrush] = useState(DEFAULT_BRUSH)
  const [painted, setPainted] = useState(false)
  const [loadError, setLoadError] = useState(false)

  useEffect(() => {
    if (!props.open) return
    let cancelled = false
    setSize(null)
    setLoadError(false)
    const image = new Image()
    image.addEventListener(
      'load',
      () => {
        if (cancelled) return
        setSize({ width: image.naturalWidth, height: image.naturalHeight })
      },
      { once: true }
    )
    image.addEventListener(
      'error',
      () => {
        if (!cancelled) setLoadError(true)
      },
      { once: true }
    )
    image.src = props.imageUrl
    return () => {
      cancelled = true
    }
  }, [props.open, props.imageUrl])

  // Restore the saved mask as paint once the canvas has its natural size.
  useEffect(() => {
    const canvas = canvasRef.current
    const context = canvas?.getContext('2d')
    if (!canvas || !context || !size) return
    context.clearRect(0, 0, canvas.width, canvas.height)
    setPainted(false)
    if (!props.mask) return
    const saved = new Image()
    saved.addEventListener(
      'load',
      () => {
        context.globalCompositeOperation = 'source-over'
        context.fillStyle = getComputedStyle(canvas).color
        context.fillRect(0, 0, canvas.width, canvas.height)
        context.globalCompositeOperation = 'destination-out'
        context.drawImage(saved, 0, 0, canvas.width, canvas.height)
        context.globalCompositeOperation = 'source-over'
        setPainted(true)
      },
      { once: true }
    )
    saved.src = props.mask
  }, [size, props.mask])

  const toCanvasPoint = (event: PointerEvent<HTMLCanvasElement>) => {
    const canvas = event.currentTarget
    const rect = canvas.getBoundingClientRect()
    const scale = canvas.width / rect.width
    return {
      x: (event.clientX - rect.left) * scale,
      y: (event.clientY - rect.top) * scale,
      scale,
    }
  }

  const strokeTo = (event: PointerEvent<HTMLCanvasElement>) => {
    const canvas = event.currentTarget
    const context = canvas.getContext('2d')
    if (!context) return
    const point = toCanvasPoint(event)
    const from = lastPoint.current ?? point
    context.globalCompositeOperation =
      mode === 'paint' ? 'source-over' : 'destination-out'
    context.strokeStyle = getComputedStyle(canvas).color
    context.lineWidth = brush * point.scale
    context.lineCap = 'round'
    context.lineJoin = 'round'
    context.beginPath()
    context.moveTo(from.x, from.y)
    context.lineTo(point.x, point.y)
    context.stroke()
    lastPoint.current = { x: point.x, y: point.y }
    if (mode === 'paint') setPainted(true)
  }

  const clear = () => {
    const canvas = canvasRef.current
    canvas?.getContext('2d')?.clearRect(0, 0, canvas.width, canvas.height)
    setPainted(false)
  }

  const save = () => {
    const paint = canvasRef.current
    if (!paint || !size || !painted) {
      props.onSave(null)
      props.onOpenChange(false)
      return
    }
    const mask = document.createElement('canvas')
    mask.width = size.width
    mask.height = size.height
    const context = mask.getContext('2d')
    if (!context) return
    context.fillStyle = 'rgb(0 0 0)'
    context.fillRect(0, 0, size.width, size.height)
    context.globalCompositeOperation = 'destination-out'
    context.drawImage(paint, 0, 0)
    props.onSave(mask.toDataURL('image/png'))
    props.onOpenChange(false)
  }

  return (
    <Dialog open={props.open} onOpenChange={props.onOpenChange}>
      <DialogContent className='sm:max-w-2xl'>
        <DialogHeader>
          <DialogTitle>{t('Edit mask')}</DialogTitle>
          <DialogDescription>
            {t(
              'Paint over the area to change. Everything else stays as it is.'
            )}
          </DialogDescription>
        </DialogHeader>
        <div className='bg-muted/40 flex max-h-[60dvh] items-center justify-center overflow-hidden rounded-lg'>
          {loadError && (
            <p className='text-destructive p-6 text-sm'>
              {t('Could not load this image as a reference.')}
            </p>
          )}
          {size && (
            <div
              className='relative max-h-[60dvh] max-w-full'
              style={{ aspectRatio: `${size.width} / ${size.height}` }}
            >
              <img
                src={props.imageUrl}
                alt=''
                className='pointer-events-none size-full object-contain select-none'
                draggable={false}
              />
              <canvas
                ref={canvasRef}
                width={size.width}
                height={size.height}
                aria-label={t('Mask canvas')}
                className='text-primary absolute inset-0 size-full cursor-crosshair touch-none opacity-55'
                onPointerDown={(event) => {
                  event.currentTarget.setPointerCapture(event.pointerId)
                  lastPoint.current = null
                  strokeTo(event)
                }}
                onPointerMove={(event) => {
                  if (event.buttons === 0) return
                  strokeTo(event)
                }}
                onPointerUp={() => {
                  lastPoint.current = null
                }}
              />
            </div>
          )}
        </div>
        <div className='flex flex-wrap items-center gap-3'>
          <SegmentedControl<BrushMode>
            size='sm'
            aria-label={t('Brush mode')}
            value={mode}
            onValueChange={setMode}
            options={[
              { value: 'paint', label: t('Brush'), icon: <Brush /> },
              { value: 'erase', label: t('Erase'), icon: <Eraser /> },
            ]}
          />
          <label className='text-muted-foreground flex min-w-40 flex-1 items-center gap-2 text-xs'>
            {t('Brush size')}
            <Slider
              className='py-1'
              min={MIN_BRUSH}
              max={MAX_BRUSH}
              value={[brush]}
              onValueChange={(value) => {
                const next = Array.isArray(value) ? value[0] : value
                if (typeof next === 'number') setBrush(next)
              }}
            />
          </label>
          <Button
            type='button'
            variant='ghost'
            size='sm'
            onClick={clear}
            disabled={!painted}
          >
            <Trash2 aria-hidden='true' />
            {t('Clear')}
          </Button>
        </div>
        <DialogFooter>
          <Button
            type='button'
            variant='outline'
            onClick={() => props.onOpenChange(false)}
          >
            {t('Cancel')}
          </Button>
          <Button type='button' onClick={save} disabled={!size}>
            {painted ? t('Save mask') : t('Remove mask')}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  )
}
