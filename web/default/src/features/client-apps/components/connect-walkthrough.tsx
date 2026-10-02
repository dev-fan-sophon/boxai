import { useTranslation } from 'react-i18next'

import { AnimateInView } from '@/components/animate-in-view'
import {
  Blocks,
  Terminal,
  Route,
  Network,
  UserRound,
  Zap,
} from '@/components/icons'
import { IconBadge } from '@/components/ui/icon-badge'
import { TitledCard } from '@/components/ui/titled-card'

/**
 * `marketing` renders the same six capabilities as a bare card grid for the
 * public /connect page, which supplies its own section heading.
 */
export function ConnectWalkthrough(props: { variant?: 'card' | 'marketing' }) {
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

  if (props.variant === 'marketing') {
    return (
      <ul className='grid gap-3 sm:grid-cols-2 lg:grid-cols-3'>
        {features.map((feature, index) => {
          const Icon = feature.icon
          return (
            <AnimateInView
              as='li'
              key={feature.title}
              delay={40 + index * 50}
              className='border-border/60 bg-card hover:border-border hover:shadow-raised transition-ui duration-control min-w-0 rounded-2xl border p-6 shadow-xs'
            >
              <IconBadge tone='primary' size='lg'>
                <Icon weight='duotone' />
              </IconBadge>
              <p className='mt-5 text-base font-semibold tracking-tight'>
                {feature.title}
              </p>
              <p className='text-muted-foreground mt-1.5 text-sm leading-relaxed text-pretty'>
                {feature.description}
              </p>
            </AnimateInView>
          )
        })}
      </ul>
    )
  }

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
