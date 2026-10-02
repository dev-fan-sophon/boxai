import { Brush } from 'lucide-react'
import { useState } from 'react'
import { useTranslation } from 'react-i18next'

import { cn } from '@/lib/utils'

import type { GenerationController } from '../../hooks/use-generation-controller'
import { MaskEditorDialog } from './mask-editor-dialog'

/**
 * Opens the inpainting mask editor on the first reference. Rendered only for
 * models whose capabilities support a mask (GPT Image).
 */
export function ImageMaskButton(props: { controller: GenerationController }) {
  const { t } = useTranslation()
  const [open, setOpen] = useState(false)
  const reference = props.controller.references[0]
  if (
    props.controller.modality !== 'image' ||
    !props.controller.draft.imageCapabilities?.supportsMask ||
    !reference
  ) {
    return null
  }
  const hasMask = Boolean(props.controller.mask)
  return (
    <>
      <button
        type='button'
        onClick={() => setOpen(true)}
        aria-pressed={hasMask}
        className={cn(
          'inline-flex h-8 items-center gap-1.5 rounded-lg border px-2 text-2xs font-medium',
          'focus-visible:ring-ring transition-colors outline-none focus-visible:ring-2',
          hasMask
            ? 'border-primary/40 bg-primary/10 text-primary'
            : 'text-muted-foreground hover:bg-muted/70 hover:text-foreground border-transparent'
        )}
      >
        <Brush className='size-3.5' aria-hidden='true' />
        {hasMask ? t('Mask on') : t('Paint mask')}
      </button>
      <MaskEditorDialog
        open={open}
        onOpenChange={setOpen}
        imageUrl={reference.dataUrl}
        mask={props.controller.mask}
        onSave={(mask) =>
          props.controller.setMask(
            mask ? { referenceId: reference.id, dataUrl: mask } : null
          )
        }
      />
    </>
  )
}
