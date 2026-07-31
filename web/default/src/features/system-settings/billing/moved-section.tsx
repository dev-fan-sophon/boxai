import { Link } from '@tanstack/react-router'
import { ArrowRight, TriangleAlert } from 'lucide-react'
import { useTranslation } from 'react-i18next'

import { Alert, AlertDescription } from '@/components/ui/alert'
import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import type { PricingCenterTab } from '@/features/pricing-center/tabs'

import { SettingsSection } from '../components/settings-section'

const MOVED_ENTRIES: Array<{
  tab: PricingCenterTab
  titleKey: string
  descriptionKey: string
}> = [
  {
    tab: 'models',
    titleKey: 'Model Pricing',
    descriptionKey: 'Per-model prices, ratios and billing expressions.',
  },
  {
    tab: 'groups',
    titleKey: 'Groups & Tools',
    descriptionKey: 'Group ratios, top-up group ratios and tool prices.',
  },
  {
    tab: 'currency',
    titleKey: 'Currency & Display',
    descriptionKey: 'Display currency, exchange rate and business timezone.',
  },
  {
    tab: 'payments',
    titleKey: 'Payment Gateway',
    descriptionKey: 'Epay, Stripe, Creem, Waffo and Bank QR configuration.',
  },
]

export function MovedToPricingCenterSection() {
  const { t } = useTranslation()

  return (
    <SettingsSection title={t('Moved to Pricing Center')}>
      <div className='space-y-4'>
        <Alert>
          <TriangleAlert data-icon='inline-start' />
          <AlertDescription>
            {t(
              'These settings have moved to the Pricing Center. This legacy entry will be removed soon; old links redirect automatically.'
            )}
          </AlertDescription>
        </Alert>

        <div className='divide-border divide-y rounded-xl border'>
          {MOVED_ENTRIES.map((entry) => (
            <div
              key={entry.tab}
              className='flex flex-wrap items-center justify-between gap-3 p-4'
            >
              <div className='min-w-0 space-y-1'>
                <div className='flex flex-wrap items-center gap-2'>
                  <span className='text-sm font-medium'>
                    {t(entry.titleKey)}
                  </span>
                  <Badge variant='outline'>{t('Moved')}</Badge>
                </div>
                <p className='text-muted-foreground text-xs'>
                  {t(entry.descriptionKey)}
                </p>
              </div>
              <Button
                variant='outline'
                size='sm'
                render={
                  <Link
                    to='/pricing-center/$tab'
                    params={{ tab: entry.tab }}
                  />
                }
              >
                {t('Open in Pricing Center')}
                <ArrowRight data-icon='inline-end' />
              </Button>
            </div>
          ))}
        </div>
      </div>
    </SettingsSection>
  )
}
