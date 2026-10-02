import { AnimatePresence, motion } from 'motion/react'
import { useEffect, useState } from 'react'
import { useTranslation } from 'react-i18next'

import { Check, WalletCards } from '@/components/icons'
import { LobeIcon } from '@/lib/lobe-icon'
import { MOTION_SPRING, MOTION_TRANSITION } from '@/lib/motion'
import { cn } from '@/lib/utils'

import type { HomeStatsModel } from '../types'

type RoutedModel = Pick<HomeStatsModel, 'model_name' | 'vendor' | 'vendor_icon'>

/** Used until the live catalogue answers, and on deployments without usage. */
const FALLBACK_MODELS: RoutedModel[] = [
  { model_name: 'gpt-5', vendor: 'OpenAI', vendor_icon: 'OpenAI' },
  {
    model_name: 'claude-sonnet-4-5',
    vendor: 'Anthropic',
    vendor_icon: 'Claude.Color',
  },
  {
    model_name: 'gemini-2.5-pro',
    vendor: 'Google',
    vendor_icon: 'Gemini.Color',
  },
  {
    model_name: 'deepseek-chat',
    vendor: 'DeepSeek',
    vendor_icon: 'DeepSeek.Color',
  },
]

const SWAP_MS = 2800

/** Illustrative latencies so each row reads as a distinct upstream. */
const LATENCY_MS = [412, 538, 367, 295]

/**
 * The hero's product shot: one request, one key, one Base URL — only the
 * `model` string changes, and the gateway routes it to a different provider.
 * Drawn from tokens rather than captured, so it follows the theme and locale.
 * Decorative: the hero copy carries the message for assistive tech.
 */
export function HeroGateway(props: { models: HomeStatsModel[]; host: string }) {
  const { t } = useTranslation()
  const models: RoutedModel[] =
    props.models.length >= 2 ? props.models.slice(0, 4) : FALLBACK_MODELS
  const [active, setActive] = useState(0)

  useEffect(() => {
    if (window.matchMedia('(prefers-reduced-motion: reduce)').matches) return
    const id = setInterval(
      () => setActive((current) => (current + 1) % models.length),
      SWAP_MS
    )
    return () => clearInterval(id)
  }, [models.length])

  const current = models[active % models.length]

  return (
    <div
      aria-hidden='true'
      className='bg-card/90 ring-border/70 shadow-lifted relative overflow-hidden rounded-2xl ring-1 backdrop-blur-xl'
    >
      <div className='border-border/60 bg-surface-subtle/70 flex items-center gap-3 border-b px-4 py-2.5'>
        <span className='flex shrink-0 gap-1.5'>
          <span className='bg-destructive/60 size-2.5 rounded-full' />
          <span className='bg-warning/60 size-2.5 rounded-full' />
          <span className='bg-success/60 size-2.5 rounded-full' />
        </span>
        <span className='text-muted-foreground text-2xs min-w-0 flex-1 truncate text-center font-mono'>
          {props.host}/v1/chat/completions
        </span>
        <span className='w-10 shrink-0' />
      </div>

      <div className='grid md:grid-cols-[minmax(0,1.15fr)_minmax(0,1fr)]'>
        {/* Request */}
        <div className='border-border/60 min-w-0 border-b p-4 sm:p-5 md:border-r md:border-b-0'>
          <p className='text-muted-foreground text-2xs mb-3 font-medium'>
            {t('Request')}
          </p>
          <pre className='text-foreground/85 overflow-x-auto font-mono text-xs leading-6'>
            <code>
              <span className='text-chart-4 font-semibold'>POST</span>{' '}
              <span className='text-muted-foreground'>
                /v1/chat/completions
              </span>
              {'\n'}
              <span className='text-chart-2'>Authorization</span>
              <span className='text-muted-foreground'>
                : Bearer sk-••••4f2a
              </span>
              {'\n\n'}
              {'{\n  '}
              <span className='text-chart-2'>&quot;model&quot;</span>
              {': '}
              <span className='relative inline-flex align-bottom'>
                <AnimatePresence mode='popLayout' initial={false}>
                  <motion.span
                    key={current.model_name}
                    initial={{ opacity: 0, y: 10 }}
                    animate={{ opacity: 1, y: 0 }}
                    exit={{ opacity: 0, y: -10 }}
                    transition={MOTION_TRANSITION.default}
                    className='bg-primary/10 text-primary -mx-1 rounded-md px-1 whitespace-nowrap'
                  >
                    &quot;{current.model_name}&quot;
                  </motion.span>
                </AnimatePresence>
              </span>
              {',\n  '}
              <span className='text-chart-2'>&quot;messages&quot;</span>
              {': [{ '}
              <span className='text-chart-2'>&quot;role&quot;</span>
              {': '}
              <span className='text-chart-5'>&quot;user&quot;</span>
              {', ... }],\n  '}
              <span className='text-chart-2'>&quot;stream&quot;</span>
              {': '}
              <span className='text-chart-3'>true</span>
              {'\n}'}
            </code>
          </pre>

          <div className='border-border/60 mt-4 border-t pt-4'>
            <p className='text-muted-foreground text-2xs mb-3 flex items-center gap-2 font-medium'>
              {t('Response')}
              <span className='text-success inline-flex items-center gap-1'>
                <span className='bg-success surface-pulse size-1.5 rounded-full' />
                {t('Streaming')}
              </span>
            </p>
            <div className='space-y-2'>
              <span className='bg-muted block h-2 w-11/12 rounded-full' />
              <span className='bg-muted block h-2 w-4/5 rounded-full' />
              <span className='flex items-center gap-1'>
                <span className='bg-muted block h-2 w-1/2 rounded-full' />
                <span className='bg-primary surface-caret inline-block h-3 w-0.5' />
              </span>
            </div>
          </div>
        </div>

        {/* Routing */}
        <div className='min-w-0 p-4 sm:p-5'>
          <p className='text-muted-foreground text-2xs mb-3 font-medium'>
            {t('Routed to')}
          </p>
          <ul className='space-y-1.5'>
            {models.map((model, index) => {
              const isActive = index === active % models.length
              return (
                <li
                  key={model.model_name}
                  className='relative flex items-center gap-3 rounded-xl px-3 py-2'
                >
                  {isActive && (
                    <motion.span
                      layoutId='hero-route-active'
                      transition={MOTION_SPRING.smooth}
                      className='bg-background ring-border/70 absolute inset-0 rounded-xl shadow-xs ring-1'
                    />
                  )}
                  <span className='bg-background ring-border/60 relative flex size-7 shrink-0 items-center justify-center rounded-lg ring-1'>
                    <LobeIcon name={model.vendor_icon} size={16} />
                  </span>
                  <span className='relative min-w-0 flex-1'>
                    <span className='block truncate text-sm font-medium'>
                      {model.vendor}
                    </span>
                    <span className='text-muted-foreground text-2xs block truncate font-mono'>
                      {model.model_name}
                    </span>
                  </span>
                  <span
                    className={cn(
                      'transition-ui duration-control relative flex shrink-0 items-center gap-1.5 text-2xs tabular-nums',
                      isActive ? 'text-success' : 'text-muted-foreground/60'
                    )}
                  >
                    <span
                      className={cn(
                        'size-1.5 rounded-full',
                        isActive ? 'bg-success surface-pulse' : 'bg-border'
                      )}
                    />
                    {LATENCY_MS[index % LATENCY_MS.length]} ms
                  </span>
                </li>
              )
            })}
          </ul>

          <div className='border-border/60 mt-4 flex items-center gap-2.5 border-t pt-4'>
            <span className='bg-primary/10 text-primary flex size-7 shrink-0 items-center justify-center rounded-lg'>
              <WalletCards className='size-3.5' />
            </span>
            <span className='text-muted-foreground min-w-0 flex-1 truncate text-xs'>
              {t('Charged to one wallet')}
            </span>
            <span className='text-success flex shrink-0 items-center gap-1 text-xs font-medium'>
              <Check className='size-3.5' />
              200 OK
            </span>
          </div>
        </div>
      </div>
    </div>
  )
}
