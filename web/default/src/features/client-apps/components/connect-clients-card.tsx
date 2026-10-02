import { useTranslation } from 'react-i18next'

import { AnimateInView } from '@/components/animate-in-view'
import { Terminal } from '@/components/icons'
import { Badge } from '@/components/ui/badge'
import { TitledCard } from '@/components/ui/titled-card'
import { LobeIcon } from '@/lib/lobe-icon'

import { CONNECT_CLIENTS } from '../constants'

/**
 * `marketing` drops the titled card chrome for the public /connect page, which
 * supplies its own section heading.
 */
export function ConnectClientsCard(props: { variant?: 'card' | 'marketing' }) {
  const { t } = useTranslation()

  if (props.variant === 'marketing') {
    return (
      <ul className='grid gap-3 sm:grid-cols-2 lg:grid-cols-3'>
        {CONNECT_CLIENTS.map((client, index) => (
          <AnimateInView
            as='li'
            key={client.name}
            delay={40 + index * 50}
            className='border-border/60 bg-card flex min-w-0 flex-col rounded-2xl border p-5 shadow-xs'
          >
            <div className='flex items-center gap-3'>
              <span className='bg-background ring-border/60 flex size-10 shrink-0 items-center justify-center overflow-hidden rounded-xl ring-1'>
                <LobeIcon name={client.icon} size={22} />
              </span>
              <div className='min-w-0 flex-1'>
                <p className='truncate text-base font-semibold tracking-tight'>
                  {client.name}
                </p>
                <Badge variant='success' className='mt-1'>
                  {t('One-click apply')}
                </Badge>
              </div>
            </div>
            <p className='text-muted-foreground mt-4 flex-1 text-sm leading-relaxed text-pretty'>
              {t(client.chooseKey)}
            </p>
            <code
              className='bg-surface-sunken text-muted-foreground mt-4 block truncate rounded-lg px-3 py-2 font-mono text-xs'
              title={client.config}
            >
              {client.config}
            </code>
          </AnimateInView>
        ))}
      </ul>
    )
  }

  return (
    <TitledCard
      title={t('Clients it configures')}
      description={t(
        'BoxAI Connect configures agents to use its local gateway. Your cloud API key stays in private local storage, not in agent configuration.'
      )}
      icon={<Terminal aria-hidden='true' />}
      disableHoverEffect
    >
      <ul className='grid gap-2 sm:grid-cols-2'>
        {CONNECT_CLIENTS.map((client) => (
          <li
            key={client.name}
            className='bg-muted/40 flex items-start gap-2.5 rounded-lg border px-3 py-2.5'
          >
            <span className='mt-0.5 flex size-6 shrink-0 items-center justify-center overflow-hidden rounded-md'>
              <LobeIcon name={client.icon} size={18} />
            </span>
            <div className='min-w-0 flex-1'>
              <div className='flex flex-wrap items-center gap-2'>
                <p className='text-sm font-medium'>{client.name}</p>
                <Badge variant='outline'>{t('One-click apply')}</Badge>
              </div>
              <p className='mt-1 text-xs text-pretty'>{t(client.chooseKey)}</p>
              <p className='text-muted-foreground mt-1 font-mono text-xs break-all'>
                {client.config}
              </p>
            </div>
          </li>
        ))}
      </ul>
    </TitledCard>
  )
}
