import { useTranslation } from 'react-i18next'

import { Dialog } from '@/components/dialog'
import { Copy, Check } from '@/components/icons'
import { Button } from '@/components/ui/button'
import { Label } from '@/components/ui/label'
import { ScrollArea } from '@/components/ui/scroll-area'
import { useCopyToClipboard } from '@/hooks/use-copy-to-clipboard'

interface FailReasonDialogProps {
  failReason: string
  open: boolean
  onOpenChange: (open: boolean) => void
}

export function FailReasonDialog({
  failReason,
  open,
  onOpenChange,
}: FailReasonDialogProps) {
  const { t } = useTranslation()
  const { copiedText, copyToClipboard } = useCopyToClipboard({ notify: false })

  return (
    <Dialog
      open={open}
      onOpenChange={onOpenChange}
      title={t('Fail Reason Details')}
      description={t('View the complete error message and details')}
      contentClassName='sm:max-w-lg'
      contentHeight='auto'
      bodyClassName='space-y-4'
    >
      <ScrollArea className='max-h-[500px] pr-4'>
        <div className='space-y-4 py-4'>
          <div className='space-y-2'>
            <Label className='text-sm font-semibold'>
              {t('Error Message')}
            </Label>
            <div className='bg-muted/50 border-destructive/30 relative rounded-md border p-3'>
              <Button
                variant='ghost'
                size='sm'
                className='absolute top-2 right-2 h-8 w-8 p-0'
                onClick={() => copyToClipboard(failReason)}
                title={t('Copy to clipboard')}
              >
                {copiedText === failReason ? (
                  <Check className='text-success size-4' />
                ) : (
                  <Copy className='size-4' />
                )}
              </Button>
              <p className='overflow-wrap-anywhere text-destructive pr-10 text-sm leading-relaxed break-all whitespace-pre-wrap'>
                {failReason || '-'}
              </p>
            </div>
          </div>
        </div>
      </ScrollArea>
    </Dialog>
  )
}
