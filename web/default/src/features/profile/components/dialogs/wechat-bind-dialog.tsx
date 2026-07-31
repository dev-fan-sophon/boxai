import { QrCode } from 'lucide-react'
import { useTranslation } from 'react-i18next'

import { Dialog } from '@/components/dialog'
import { EmptyState } from '@/components/empty-state'
import { Alert, AlertDescription } from '@/components/ui/alert'

// ============================================================================
// WeChat Bind Dialog Component
// ============================================================================

interface WeChatBindDialogProps {
  open: boolean
  onOpenChange: (open: boolean) => void
  onSuccess: () => void
}

export function WeChatBindDialog({
  open,
  onOpenChange,
}: WeChatBindDialogProps) {
  const { t } = useTranslation()
  return (
    <Dialog
      open={open}
      onOpenChange={onOpenChange}
      title={t('Bind WeChat Account')}
      description={t('Scan the QR code with WeChat to bind your account')}
      contentClassName='sm:max-w-md'
      contentHeight='auto'
      bodyClassName='space-y-4'
    >
      <div className='space-y-4 py-4'>
        <Alert>
          <QrCode className='h-4 w-4' />
          <AlertDescription>
            {t(
              'Please use WeChat\'s "Scan QR Code" feature to complete the binding process.'
            )}
          </AlertDescription>
        </Alert>

        <EmptyState
          icon={QrCode}
          className='min-h-0 p-8'
          title={t('WeChat QR code will be displayed here')}
          description={t(
            'This feature requires server-side WeChat configuration'
          )}
        />

        <p className='text-muted-foreground text-center text-xs'>
          {t('After scanning, the binding will complete automatically')}
        </p>
      </div>
    </Dialog>
  )
}
