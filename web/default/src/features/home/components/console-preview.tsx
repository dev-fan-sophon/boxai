import { Check, Copy, Plus, Search } from 'lucide-react'
import { useState, type ReactNode } from 'react'
import { useTranslation } from 'react-i18next'

import { LobeIcon } from '@/lib/lobe-icon'
import { tone } from '@/lib/tone'
import { cn } from '@/lib/utils'

import type { HomeStatsModel } from '../types'

export type ConsoleStep = 'wallet' | 'keys' | 'models' | 'integrate'

/**
 * A drawn-to-scale impression of the console, one screen per quick-start step.
 *
 * Deliberately not a screenshot: real captures would need a light and a dark
 * variant per locale and would go stale on the next console change, while this
 * follows the app's own tokens for free. Everything inside the frame is a
 * static illustration, which the title bar says out loud.
 */

/** Paths shown in the address pill, matching the real console routes. */
const STEP_PATHS: Record<ConsoleStep, string> = {
  wallet: '/wallet',
  keys: '/keys',
  models: '/pricing',
  integrate: '/v1/chat/completions',
}

const TOP_UP_AMOUNTS = [10, 20, 50, 100]

const API_KEY_ROWS = [
  { name: 'production', suffix: '4f2a' },
  { name: 'staging', suffix: '91c7' },
]

const INTEGRATE_FORMATS = [
  {
    id: 'openai',
    label: 'OpenAI',
    path: '/v1/chat/completions',
    header: 'Authorization: Bearer sk-••••',
  },
  {
    id: 'claude',
    label: 'Claude',
    path: '/v1/messages',
    header: 'x-api-key: sk-••••',
  },
  {
    id: 'gemini',
    label: 'Gemini',
    path: '/v1beta/models/{model}:generateContent',
    header: 'x-goog-api-key: sk-••••',
  },
] as const

function PaneHeading(props: { title: string; hint?: string }) {
  return (
    <div className='mb-4 flex flex-wrap items-baseline justify-between gap-x-4 gap-y-1'>
      <p className='text-sm font-semibold'>{props.title}</p>
      {props.hint && (
        <p className='text-muted-foreground text-xs'>{props.hint}</p>
      )}
    </div>
  )
}

function MockRow(props: { children: ReactNode; className?: string }) {
  return (
    <div
      className={cn(
        'border-border/50 bg-background/60 flex items-center gap-3 rounded-lg border px-3 py-2.5',
        props.className
      )}
    >
      {props.children}
    </div>
  )
}

function WalletPane(props: { host: string }) {
  const { t } = useTranslation()

  return (
    <div>
      <PaneHeading title={t('Wallet')} hint={props.host} />

      <div className='border-border/50 from-chart-1/10 rounded-xl border bg-gradient-to-br to-transparent p-4'>
        <p className='text-muted-foreground text-xs'>{t('Balance')}</p>
        <p className='mt-1 text-2xl font-semibold tracking-tight tabular-nums'>
          $128.40
        </p>
      </div>

      <p className='text-muted-foreground mt-4 mb-2 text-xs'>
        {t('Choose an amount')}
      </p>
      <div className='grid grid-cols-4 gap-2'>
        {TOP_UP_AMOUNTS.map((amount, index) => (
          <div
            key={amount}
            className={cn(
              'rounded-lg border py-2 text-center text-sm font-medium tabular-nums',
              index === 1
                ? 'border-chart-1/40 bg-chart-1/10 text-chart-1'
                : 'border-border/50 bg-background/60 text-muted-foreground'
            )}
          >
            ${amount}
          </div>
        ))}
      </div>

      <div className='bg-primary text-primary-foreground mt-4 rounded-lg py-2.5 text-center text-sm font-medium'>
        {t('Top Up')}
      </div>
      <p className='text-muted-foreground mt-3 text-xs'>
        {t('Payment methods depend on your region.')}
      </p>
    </div>
  )
}

function KeysPane() {
  const { t } = useTranslation()

  return (
    <div>
      <PaneHeading title={t('API Tokens')} hint={t('One key per project')} />

      <div className='border-primary/30 bg-primary/5 text-primary mb-3 flex items-center gap-2 rounded-lg border border-dashed px-3 py-2.5 text-sm font-medium'>
        <Plus className='size-4' aria-hidden='true' />
        {t('Create API Key')}
      </div>

      <div className='space-y-2'>
        {API_KEY_ROWS.map((key) => (
          <MockRow key={key.name}>
            <div className='min-w-0 flex-1'>
              <p className='truncate text-sm font-medium'>{key.name}</p>
              <p className='text-muted-foreground mt-0.5 font-mono text-xs'>
                sk-••••••••••••{key.suffix}
              </p>
            </div>
            <Copy
              className='text-muted-foreground size-3.5 shrink-0'
              aria-hidden='true'
            />
            <span
              className={cn(
                'shrink-0 rounded-full px-2 py-0.5 text-[11px] font-medium',
                tone('success')
              )}
            >
              {t('Enabled')}
            </span>
          </MockRow>
        ))}
      </div>

      <p className='text-muted-foreground mt-4 text-xs'>
        {t('Revoking a key cuts off every surface using it, immediately.')}
      </p>
    </div>
  )
}

function ModelsPane(props: {
  models: HomeStatsModel[]
  modelCount?: number
  vendorCount?: number
}) {
  const { t } = useTranslation()
  const hint =
    props.modelCount && props.vendorCount
      ? t('{{models}} models · {{vendors}} providers', {
          models: props.modelCount,
          vendors: props.vendorCount,
        })
      : undefined

  return (
    <div>
      <PaneHeading title={t('Model Hub')} hint={hint} />

      <div className='border-border/50 bg-background/60 text-muted-foreground mb-3 flex items-center gap-2 rounded-lg border px-3 py-2 text-xs'>
        <Search className='size-3.5' aria-hidden='true' />
        {t('Search models')}
      </div>

      <div className='space-y-2'>
        {props.models.map((item) => (
          <MockRow key={item.model_name}>
            <span className='flex size-6 shrink-0 items-center justify-center overflow-hidden rounded-md'>
              <LobeIcon name={item.vendor_icon} size={18} />
            </span>
            <div className='min-w-0 flex-1'>
              <p className='truncate text-sm font-medium'>{item.model_name}</p>
              <p className='text-muted-foreground mt-0.5 truncate text-xs'>
                {item.vendor}
              </p>
            </div>
            <span className='bg-muted h-1.5 w-16 shrink-0 overflow-hidden rounded-full'>
              <span
                className='bg-chart-3 block h-full rounded-full'
                style={{
                  width: `${Math.max(8, Math.round(item.share * 100))}%`,
                }}
              />
            </span>
          </MockRow>
        ))}
      </div>

      <p className='text-muted-foreground mt-4 text-xs'>
        {props.models.length > 0
          ? t('Ranked by usage over the last 30 days.')
          : t('Capabilities, context length, and price sit next to each model.')}
      </p>
    </div>
  )
}

function IntegratePane(props: { host: string }) {
  const { t } = useTranslation()
  const [active, setActive] = useState(0)
  const format = INTEGRATE_FORMATS[active]

  return (
    <div>
      <PaneHeading
        title={t('Unified API Example')}
        hint={t('Same host, same key')}
      />

      <div className='mb-3 flex gap-1'>
        {INTEGRATE_FORMATS.map((item, index) => (
          <button
            key={item.id}
            type='button'
            onClick={() => setActive(index)}
            className={cn(
              'transition-ui duration-control rounded-md px-2.5 py-1 text-xs font-medium',
              index === active
                ? 'bg-chart-1/15 text-chart-1'
                : 'text-muted-foreground hover:text-foreground'
            )}
          >
            {item.label}
          </button>
        ))}
      </div>

      <pre className='border-border/50 bg-background/70 overflow-x-auto rounded-xl border p-4 font-mono text-[12px] leading-relaxed'>
        <code>
          <span className='text-emerald-600 dark:text-emerald-400'>curl</span>{' '}
          <span className='text-amber-700 dark:text-amber-300'>
            &quot;https://{props.host}
            {format.path}&quot;
          </span>{' '}
          <span className='text-foreground/50'>\</span>
          {'\n  '}
          <span className='text-blue-600 dark:text-blue-400'>-H</span>{' '}
          <span className='text-amber-700 dark:text-amber-300'>
            &quot;{format.header}&quot;
          </span>{' '}
          <span className='text-foreground/50'>\</span>
          {'\n  '}
          <span className='text-blue-600 dark:text-blue-400'>-d</span>{' '}
          <span className='text-amber-700 dark:text-amber-300'>
            &apos;{'{'} &quot;model&quot;: &quot;your-model&quot;, ... {'}'}
            &apos;
          </span>
        </code>
      </pre>

      <div className='text-muted-foreground mt-4 flex items-center gap-2 text-xs'>
        <Check className='text-success size-3.5 shrink-0' aria-hidden='true' />
        {t('Only the Base URL and the key change in your existing SDK.')}
      </div>
    </div>
  )
}

export function ConsolePreview(props: {
  step: ConsoleStep
  host: string
  models: HomeStatsModel[]
  modelCount?: number
  vendorCount?: number
}) {
  const { t } = useTranslation()

  return (
    <div className='border-border/60 bg-card shadow-panel overflow-hidden rounded-2xl border'>
      <div className='border-border/50 bg-muted/40 flex items-center gap-3 border-b px-4 py-2.5'>
        <span className='flex gap-1.5' aria-hidden='true'>
          <span className='size-2.5 rounded-full bg-red-400/70' />
          <span className='size-2.5 rounded-full bg-amber-400/70' />
          <span className='size-2.5 rounded-full bg-emerald-400/70' />
        </span>
        <span className='border-border/50 bg-background/70 text-muted-foreground min-w-0 flex-1 truncate rounded-md border px-2.5 py-1 text-center font-mono text-[11px]'>
          {props.host}
          {STEP_PATHS[props.step]}
        </span>
        <span className='text-muted-foreground shrink-0 text-[10px] tracking-wider uppercase'>
          {t('Illustration')}
        </span>
      </div>

      <div className='p-5 md:min-h-[26rem]'>
        {props.step === 'wallet' && <WalletPane host={props.host} />}
        {props.step === 'keys' && <KeysPane />}
        {props.step === 'models' && (
          <ModelsPane
            models={props.models}
            modelCount={props.modelCount}
            vendorCount={props.vendorCount}
          />
        )}
        {props.step === 'integrate' && <IntegratePane host={props.host} />}
      </div>
    </div>
  )
}
