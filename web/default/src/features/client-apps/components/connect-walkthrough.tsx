import { Blocks, Terminal, Route, Network, UserRound, Zap } from 'lucide-react'
import { useTranslation } from 'react-i18next'

import { TitledCard } from '@/components/ui/titled-card'

export function ConnectWalkthrough() {
  const { t } = useTranslation()
  const features = [
    {
      title: t('Agents'),
      description: t(
        'Configure supported coding agents to use the local gateway.'
      ),
      icon: Terminal,
    },
    {
      title: t('Gateway'),
      description: t(
        'Keep Connect running to route agent requests through BoxAI, the only provider.'
      ),
      icon: Network,
    },
    {
      title: t('Routing'),
      description: t(
        'Choose BoxAI conversational models and manage routing rules.'
      ),
      icon: Route,
    },
    {
      title: t('Usage'),
      description: t(
        'View account-wide balance, lifetime consumption, and subscription counters reported by BoxAI.'
      ),
      icon: Zap,
    },
    {
      title: t('Library'),
      description: t('Manage MCP servers and Skills in the original library.'),
      icon: Blocks,
    },
    {
      title: t('Account'),
      description: t(
        'Authorize in your browser. Sign out locally, or revoke the API key on the Keys page.'
      ),
      icon: UserRound,
    },
  ] as const

  return (
    <TitledCard
      title={t('Everything your agents need')}
      description={t(
        'Sign in with BoxAI, then keep Connect running while your agents use its local gateway.'
      )}
      icon={<Route aria-hidden='true' />}
      disableHoverEffect
    >
      <ul className='grid gap-3 sm:grid-cols-2'>
        {features.map((feature) => {
          const Icon = feature.icon
          return (
            <li
              key={feature.title}
              className='bg-muted/40 rounded-lg border p-3'
            >
              <Icon className='text-primary size-5' aria-hidden='true' />
              <p className='mt-2 text-sm font-medium'>{feature.title}</p>
              <p className='text-muted-foreground mt-1 text-xs text-pretty'>
                {feature.description}
              </p>
            </li>
          )
        })}
      </ul>
    </TitledCard>
  )
}
