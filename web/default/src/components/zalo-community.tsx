import { ExternalLink } from 'lucide-react'
import { useTranslation } from 'react-i18next'

import { IconZalo } from '@/assets/brand-icons'
import { Button } from '@/components/ui/button'
import {
  Popover,
  PopoverContent,
  PopoverTrigger,
} from '@/components/ui/popover'
import { cn } from '@/lib/utils'

export const ZALO_COMMUNITY_URL =
  'https://zaloapp.com/qr/g/mr17jslynogmrxqjivr7?src=qr'

export function ZaloCommunityQr(props: {
  className?: string
  imageClassName?: string
}) {
  const { t } = useTranslation()

  return (
    <figure className={cn('flex flex-col items-center gap-2', props.className)}>
      <a
        href={ZALO_COMMUNITY_URL}
        target='_blank'
        rel='noopener noreferrer'
        aria-label={t('Join Zalo group')}
        className='ring-border/70 block overflow-hidden rounded-xl bg-white ring-1'
      >
        <img
          src='/zalo-community-qr.webp'
          alt={t('BoxAI Zalo group QR code')}
          width={720}
          height={720}
          loading='lazy'
          className={cn('size-56 object-contain', props.imageClassName)}
        />
      </a>
      <figcaption className='text-muted-foreground max-w-64 text-center text-xs leading-relaxed'>
        {t('Scan this QR code with Zalo to join the group.')}
      </figcaption>
    </figure>
  )
}

export function ZaloCommunityButton(props: { className?: string }) {
  const { t } = useTranslation()

  return (
    <Button
      variant='cta'
      className={cn('gap-2', props.className)}
      render={
        <a
          href={ZALO_COMMUNITY_URL}
          target='_blank'
          rel='noopener noreferrer'
        />
      }
    >
      <IconZalo className='size-4' aria-hidden='true' />
      {t('Join Zalo group')}
      <ExternalLink className='size-3.5' aria-hidden='true' />
    </Button>
  )
}

export function ZaloCommunityPopover(props: { className?: string }) {
  const { t } = useTranslation()

  return (
    <Popover>
      <PopoverTrigger
        render={
          <Button
            type='button'
            variant='ghost'
            size='icon'
            className={cn(
              'text-muted-foreground hover:text-foreground rounded-full',
              props.className
            )}
            aria-label={t('Zalo Community')}
          />
        }
      >
        <IconZalo className='size-4' aria-hidden='true' />
      </PopoverTrigger>
      <PopoverContent
        align='end'
        sideOffset={8}
        className='w-[min(20rem,calc(100vw-1rem))] gap-4 p-4'
      >
        <div className='text-center'>
          <p className='font-semibold'>{t('Zalo Community')}</p>
          <p className='text-muted-foreground mt-1 text-xs leading-relaxed'>
            {t('Join the BoxAI community on Zalo')}
          </p>
        </div>
        <ZaloCommunityQr imageClassName='size-48' />
        <ZaloCommunityButton className='w-full' />
      </PopoverContent>
    </Popover>
  )
}
