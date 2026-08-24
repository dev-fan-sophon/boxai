import { Terminal } from 'lucide-react'
import { useTranslation } from 'react-i18next'

import { Badge } from '@/components/ui/badge'
import { TitledCard } from '@/components/ui/titled-card'
import { LobeIcon } from '@/lib/lobe-icon'

import { CONNECT_CLIENTS } from '../constants'

export function ConnectClientsCard() {
  const { t } = useTranslation()

  return (
    <TitledCard
      title={t('Clients it configures')}
      description={t(
        'Connect writes only the provider entry it owns and keeps a restorable backup of the rest.'
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
