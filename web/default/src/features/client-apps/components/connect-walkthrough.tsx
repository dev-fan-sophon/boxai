import {
  Blocks,
  RefreshCw,
  Route,
  Search,
  ShieldCheck,
  UserRound,
  Zap,
} from 'lucide-react'
import { useTranslation } from 'react-i18next'

import { TitledCard } from '@/components/ui/titled-card'

const FEATURES = [
  {
    title: 'Model Plaza',
    description: 'Discover models that work with each supported coding agent.',
    icon: Search,
  },
  {
    title: 'MCP and official Skills',
    description:
      'Install MCP servers and BoxAI official Skills from one place.',
    icon: Blocks,
  },
  {
    title: 'Reversible by design',
    description:
      'Apply BoxAI in one click, then disconnect to restore your previous configuration.',
    icon: RefreshCw,
  },
  {
    title: 'Browser sign-in',
    description:
      'Sign in with your BoxAI account without copying API keys into the app.',
    icon: ShieldCheck,
  },
  {
    title: 'Account and usage',
    description: 'See your BoxAI account and usage without leaving Connect.',
    icon: UserRound,
  },
  {
    title: 'Signed in-app updates',
    description: 'Receive verified Connect updates directly inside the app.',
    icon: Zap,
  },
] as const

export function ConnectWalkthrough() {
  const { t } = useTranslation()

  return (
    <TitledCard
      title={t('Everything your agents need')}
      description={t(
        'A fast native Rust and GPUI experience, designed Vietnamese-first for the BoxAI workflow.'
      )}
      icon={<Route aria-hidden='true' />}
      disableHoverEffect
    >
      <ul className='grid gap-3 sm:grid-cols-2'>
        {FEATURES.map((feature) => {
          const Icon = feature.icon
          return (
            <li
              key={feature.title}
              className='bg-muted/40 rounded-lg border p-3'
            >
              <Icon className='text-primary size-5' aria-hidden='true' />
              <p className='mt-2 text-sm font-medium'>{t(feature.title)}</p>
              <p className='text-muted-foreground mt-1 text-xs text-pretty'>
                {t(feature.description)}
              </p>
            </li>
          )
        })}
      </ul>
    </TitledCard>
  )
}
