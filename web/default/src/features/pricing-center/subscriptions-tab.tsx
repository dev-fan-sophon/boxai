import { Info } from 'lucide-react'
import { useTranslation } from 'react-i18next'

import { Alert, AlertDescription } from '@/components/ui/alert'
import { SubscriptionsDialogs } from '@/features/subscriptions/components/subscriptions-dialogs'
import { SubscriptionsPrimaryButtons } from '@/features/subscriptions/components/subscriptions-primary-buttons'
import {
  SubscriptionsProvider,
  useSubscriptions,
} from '@/features/subscriptions/components/subscriptions-provider'
import { SubscriptionsTable } from '@/features/subscriptions/components/subscriptions-table'

function SubscriptionsTabContent() {
  const { t } = useTranslation()
  const { complianceConfirmed } = useSubscriptions()

  return (
    <div className='flex h-full min-h-0 flex-col gap-3'>
      <div className='flex shrink-0 flex-wrap items-center justify-between gap-2'>
        <Alert variant='default' className='hidden w-fit px-3 py-2 sm:flex'>
          <Info className='h-4 w-4' />
          <AlertDescription className='text-xs'>
            {t(
              'Stripe/Creem requires creating products on the third-party platform and entering the ID'
            )}
          </AlertDescription>
        </Alert>
        <SubscriptionsPrimaryButtons />
      </div>
      {!complianceConfirmed ? (
        <Alert variant='destructive' className='shrink-0'>
          <AlertDescription>
            {t(
              'Subscription plan creation and changes are locked until the administrator confirms compliance terms in Payment Gateway settings.'
            )}
          </AlertDescription>
        </Alert>
      ) : null}
      <div className='min-h-0 flex-1'>
        <SubscriptionsTable />
      </div>
      <SubscriptionsDialogs />
    </div>
  )
}

export function SubscriptionsTab() {
  return (
    <SubscriptionsProvider>
      <SubscriptionsTabContent />
    </SubscriptionsProvider>
  )
}
