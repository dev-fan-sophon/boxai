import { useTranslation } from 'react-i18next'

import { IconZalo } from '@/assets/brand-icons'
import { Card, CardContent } from '@/components/ui/card'
import { IconBadge } from '@/components/ui/icon-badge'
import {
  ZaloCommunityButton,
  ZaloCommunityQr,
} from '@/components/zalo-community'

export function ZaloCommunityCard() {
  const { t } = useTranslation()

  return (
    <Card data-card-hover='false' className='py-0'>
      <CardContent className='grid items-center gap-5 p-4 sm:grid-cols-[minmax(0,1fr)_auto] sm:p-6'>
        <div>
          <div className='flex items-center gap-3'>
            <IconBadge tone='info' size='lg'>
              <IconZalo />
            </IconBadge>
            <div>
              <p className='font-semibold'>{t('Zalo Community')}</p>
              <p className='text-muted-foreground mt-0.5 text-xs'>
                {t('Join the BoxAI community on Zalo')}
              </p>
            </div>
          </div>
          <p className='text-muted-foreground mt-4 max-w-2xl text-sm leading-relaxed'>
            {t(
              'Get product updates, support, and connect with BoxAI users in Vietnam.'
            )}
          </p>
          <ZaloCommunityButton className='mt-4' />
        </div>

        <ZaloCommunityQr className='hidden sm:flex' imageClassName='size-32' />
      </CardContent>
    </Card>
  )
}
