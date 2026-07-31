import {
  Clapperboard,
  ImageIcon,
  MessageSquare,
  type LucideIcon,
} from 'lucide-react'
import { useEffect, useState, type ReactNode } from 'react'
import { useTranslation } from 'react-i18next'

import { CLIENT_APP_LOGO } from '@/features/client-apps/logos'
import { cn } from '@/lib/utils'

/**
 * Live panels inside the "what you get" cards. They are the product, drawn at
 * a glance: the formats the gateway answers on, the media the workspace makes,
 * and the apps signed in to the account.
 *
 * Everything here is decorative — screen readers get the card's own prose — so
 * each panel is `aria-hidden` and carries no interactive target.
 */

const ROUTE_CYCLE_MS = 2600

/** The four request shapes the gateway accepts on one host. */
const GATEWAY_ROUTES = [
  { format: 'OpenAI', endpoint: '/v1/chat/completions' },
  { format: 'Responses', endpoint: '/v1/responses' },
  { format: 'Claude', endpoint: '/v1/messages' },
  { format: 'Gemini', endpoint: '/v1beta/…:generateContent' },
] as const

function PreviewFrame(props: { children: ReactNode; className?: string }) {
  return (
    <div
      aria-hidden='true'
      className={cn(
        'border-border/50 bg-muted/30 dark:bg-background/40 relative h-32 overflow-hidden rounded-xl border p-3',
        props.className
      )}
    >
      {props.children}
    </div>
  )
}

/**
 * Index that advances on a timer and freezes for visitors who asked for reduced
 * motion, so the panel shows one steady state instead of a loop they opted out
 * of.
 */
function useAmbientCycle(length: number, intervalMs: number) {
  const [index, setIndex] = useState(0)

  useEffect(() => {
    if (window.matchMedia('(prefers-reduced-motion: reduce)').matches) return
    const id = setInterval(
      () => setIndex((current) => (current + 1) % length),
      intervalMs
    )
    return () => clearInterval(id)
  }, [length, intervalMs])

  return index
}

export function GatewayPreview() {
  const { t } = useTranslation()
  const active = useAmbientCycle(GATEWAY_ROUTES.length, ROUTE_CYCLE_MS)
  const route = GATEWAY_ROUTES[active]

  return (
    <PreviewFrame className='flex flex-col justify-between'>
      <div className='flex flex-wrap gap-1'>
        {GATEWAY_ROUTES.map((item, index) => (
          <span
            key={item.format}
            className={cn(
              'transition-ui duration-page rounded-md px-1.5 py-0.5 font-mono text-[10px] font-medium',
              index === active
                ? 'bg-chart-1/15 text-chart-1'
                : 'text-muted-foreground/60'
            )}
          >
            {item.format}
          </span>
        ))}
      </div>

      <div className='space-y-1.5'>
        <p className='text-muted-foreground/70 font-mono text-[10px] tracking-wider uppercase'>
          {t('Base URL')}
        </p>
        <p className='text-foreground/80 truncate font-mono text-xs'>
          {typeof window === 'undefined' ? 'you-box.com' : window.location.host}
        </p>
        <p className='text-foreground/60 truncate font-mono text-xs'>
          <span className='text-chart-1 font-semibold'>POST</span>{' '}
          {route.endpoint}
        </p>
      </div>

      <div className='flex items-center gap-1.5'>
        <span className='bg-success surface-pulse size-1.5 rounded-full' />
        <span className='text-muted-foreground font-mono text-[10px]'>
          200 OK
        </span>
      </div>
    </PreviewFrame>
  )
}

const WORKSPACE_TILES: { id: string; icon: LucideIcon; tone: string }[] = [
  { id: 'chat', icon: MessageSquare, tone: 'text-chart-4' },
  { id: 'image', icon: ImageIcon, tone: 'text-chart-5' },
  { id: 'video', icon: Clapperboard, tone: 'text-chart-2' },
]

export function WorkspacePreview() {
  const { t } = useTranslation()

  return (
    <PreviewFrame className='flex flex-col justify-between'>
      <div className='border-border/50 bg-background/60 flex items-center gap-1.5 rounded-lg border px-2.5 py-1.5'>
        <span className='text-muted-foreground truncate text-[11px]'>
          {t('a product shot on a marble table')}
        </span>
        <span className='bg-chart-4 surface-caret inline-block h-3 w-px shrink-0' />
      </div>

      <div className='grid grid-cols-3 gap-1.5'>
        {WORKSPACE_TILES.map((tile, index) => (
          <div
            key={tile.id}
            className='border-border/50 bg-background/60 relative flex h-12 items-center justify-center overflow-hidden rounded-lg border'
            style={{ '--loop-delay': `${index * 420}ms` } as React.CSSProperties}
          >
            <tile.icon className={cn('size-4', tile.tone)} strokeWidth={1.5} />
            <span className='surface-sweep via-foreground/10 absolute inset-y-0 -left-1/3 w-1/3 bg-gradient-to-r from-transparent to-transparent' />
          </div>
        ))}
      </div>
    </PreviewFrame>
  )
}

export function DesktopPreview() {
  const { t } = useTranslation()

  const rows = [
    {
      name: 'BoxAI Connect',
      logo: CLIENT_APP_LOGO.connect.src,
      status: t('Signed in'),
      live: true,
    },
    {
      name: 'BoxAI Desktop',
      logo: CLIENT_APP_LOGO.desktop.src,
      status: t('Signed in'),
      live: true,
    },
    { name: 'BoxAI Coding', logo: null, status: t('Coming soon'), live: false },
  ]

  return (
    <PreviewFrame className='flex flex-col justify-center gap-1.5'>
      {rows.map((row, index) => (
        <div
          key={row.name}
          className='border-border/50 bg-background/60 flex items-center gap-2 rounded-lg border px-2.5 py-1.5'
          style={{ '--loop-delay': `${index * 500}ms` } as React.CSSProperties}
        >
          {row.logo ? (
            <img
              src={row.logo}
              alt=''
              draggable={false}
              className='size-4 shrink-0 rounded-[22%] object-contain'
            />
          ) : (
            <span className='border-border size-4 shrink-0 rounded-[22%] border border-dashed' />
          )}
          <span className='text-foreground/80 truncate text-[11px] font-medium'>
            {row.name}
          </span>
          <span className='ml-auto flex shrink-0 items-center gap-1'>
            {row.live && (
              <span className='bg-success surface-pulse size-1.5 rounded-full' />
            )}
            <span className='text-muted-foreground text-[10px]'>
              {row.status}
            </span>
          </span>
        </div>
      ))}
    </PreviewFrame>
  )
}
