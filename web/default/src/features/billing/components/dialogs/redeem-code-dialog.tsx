import { ExternalLink, Loader2 } from 'lucide-react'
import { useTranslation } from 'react-i18next'

import { Dialog } from '@/components/dialog'
import { Alert, AlertDescription } from '@/components/ui/alert'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'

interface RedeemCodeDialogProps {
  open: boolean
  onOpenChange: (open: boolean) => void
  enabled: boolean
  code: string
  onCodeChange: (code: string) => void
  onRedeem: () => void
  redeeming: boolean
  topupLink?: string
}

export function RedeemCodeDialog(props: RedeemCodeDialogProps) {
  const { t } = useTranslation()

  return (
    <Dialog
      open={props.open}
      onOpenChange={props.onOpenChange}
      title={t('Redeem code')}
      description={t('Credit your balance with a redemption code')}
      contentClassName='sm:max-w-md'
      bodyClassName='space-y-3'
      footer={
        <Button
          onClick={props.onRedeem}
          disabled={props.redeeming || !props.enabled || !props.code.trim()}
          className='w-full sm:w-auto'
        >
          {props.redeeming && <Loader2 className='mr-2 size-4 animate-spin' />}
          {t('Redeem')}
        </Button>
      }
    >
      {props.enabled ? (
        <div className='space-y-2'>
          <Label
            htmlFor='redemption-code'
            className='text-muted-foreground text-xs font-medium tracking-wider uppercase'
          >
            {t('Have a Code?')}
          </Label>
          <Input
            id='redemption-code'
            value={props.code}
            onChange={(e) => props.onCodeChange(e.target.value)}
            placeholder={t('Enter your redemption code')}
            className='h-10 font-mono'
          />
          {props.topupLink && (
            <p className='text-muted-foreground text-xs'>
              {t('Need a redemption code?')}{' '}
              <a
                href={props.topupLink}
                target='_blank'
                rel='noopener noreferrer'
                className='inline-flex items-center gap-1 underline-offset-4 hover:underline'
              >
                {t('Get one here')}
                <ExternalLink className='size-3' />
              </a>
            </p>
          )}
        </div>
      ) : (
        <Alert>
          <AlertDescription>
            {t(
              'Redemption codes are disabled until the administrator confirms compliance terms.'
            )}
          </AlertDescription>
        </Alert>
      )}
    </Dialog>
  )
}
