import { useTranslation } from 'react-i18next'

import {
  Activity,
  ArrowDownRight,
  ArrowUpRight,
  TrendingDown,
  TrendingUp,
} from '@/components/icons'
import { LobeIcon } from '@/lib/lobe-icon'
import { cn } from '@/lib/utils'

import type { RankingMover } from '../types'
import { ModelLink, VendorLink } from './entity-links'

type PulseSectionProps = {
  movers: RankingMover[]
  droppers: RankingMover[]
}

/**
 * Rank movement panel: gainers and losers calculated from the previous period.
 */
export function PulseSection(props: PulseSectionProps) {
  const { t } = useTranslation()

  return (
    <section className='grid grid-cols-1 gap-4 lg:grid-cols-2'>
      <PulseCard
        title={t('Trending up')}
        description={t('Models climbing the leaderboard')}
        icon={<TrendingUp className='text-success size-4' />}
      >
        {props.movers.length === 0 ? (
          <PulseEmpty label={t('No notable climbers right now')} />
        ) : (
          <ul>
            {props.movers.map((row) => (
              <MoverRow key={row.model_name} row={row} intent='up' />
            ))}
          </ul>
        )}
      </PulseCard>

      <PulseCard
        title={t('Trending down')}
        description={t('Models losing positions')}
        icon={<TrendingDown className='text-destructive size-4' />}
      >
        {props.droppers.length === 0 ? (
          <PulseEmpty label={t('No notable drops right now')} />
        ) : (
          <ul>
            {props.droppers.map((row) => (
              <MoverRow key={row.model_name} row={row} intent='down' />
            ))}
          </ul>
        )}
      </PulseCard>
    </section>
  )
}

function PulseCard(props: {
  title: string
  description: string
  icon: React.ReactNode
  children: React.ReactNode
}) {
  return (
    <div className='bg-card border-border/60 overflow-hidden rounded-2xl border shadow-xs'>
      <header className='border-border/60 border-b px-5 py-4'>
        <h3 className='text-foreground inline-flex items-center gap-2 text-sm font-semibold'>
          {props.icon}
          {props.title}
        </h3>
        <p className='text-muted-foreground mt-0.5 text-xs'>
          {props.description}
        </p>
      </header>
      <div className='py-1'>{props.children}</div>
    </div>
  )
}

function PulseEmpty(props: { label: string }) {
  return (
    <div className='text-muted-foreground flex flex-col items-center gap-2 px-4 py-8 text-center text-sm'>
      <span className='bg-muted flex size-9 items-center justify-center rounded-xl'>
        <Activity className='size-4' aria-hidden='true' />
      </span>
      {props.label}
    </div>
  )
}

function MoverRow(props: { row: RankingMover; intent: 'up' | 'down' }) {
  return (
    <li className='flex items-center gap-3 px-4 py-2'>
      <span className='bg-background ring-border/60 flex size-8 shrink-0 items-center justify-center rounded-lg ring-1'>
        <LobeIcon name={props.row.vendor_icon} size={16} />
      </span>
      <div className='min-w-0 flex-1'>
        <ModelLink
          modelName={props.row.model_name}
          className='text-foreground block truncate font-mono text-xs font-medium'
        >
          {props.row.model_name}
        </ModelLink>
        <p className='text-muted-foreground text-2xs truncate'>
          #{props.row.current_rank} ·{' '}
          <VendorLink vendor={props.row.vendor}>{props.row.vendor}</VendorLink>
        </p>
      </div>
      <span
        className={cn(
          'inline-flex shrink-0 items-center gap-0.5 text-xs font-semibold tabular-nums',
          props.intent === 'up' ? 'text-success' : 'text-destructive'
        )}
      >
        {props.intent === 'up' ? (
          <ArrowUpRight className='size-3' />
        ) : (
          <ArrowDownRight className='size-3' />
        )}
        {Math.abs(props.row.rank_delta)}
      </span>
    </li>
  )
}
