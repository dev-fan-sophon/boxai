/*
Copyright (C) 2023-2026 QuantumNous

This program is free software: you can redistribute it and/or modify
it under the terms of the GNU Affero General Public License as
published by the Free Software Foundation, either version 3 of the
License, or (at your option) any later version.

This program is distributed in the hope that it will be useful,
but WITHOUT ANY WARRANTY; without even the implied warranty of
MERCHANTABILITY or FITNESS FOR A PARTICULAR PURPOSE. See the
GNU Affero General Public License for more details.

You should have received a copy of the GNU Affero General Public License
along with this program. If not, see <https://www.gnu.org/licenses/>.

For commercial licensing, please contact support@quantumnous.com
*/
import {
  BarChart3,
  Bot,
  Braces,
  Clapperboard,
  Layers3,
  MessageSquare,
  MonitorSmartphone,
  Sparkles,
} from 'lucide-react'
import { useTranslation } from 'react-i18next'

import { LobeIcon } from '@/lib/lobe-icon'
import { cn } from '@/lib/utils'

import type { HomeStatsVendor } from '../types'

type BubbleItem = {
  label: string
  tone: string
  icon?: React.ReactNode
  /** Percent of the orbit box, measured from the left or the right edge. */
  x?: number
  rx?: number
  y: number
}

interface HeroEcosystemProps {
  brand: string
  className?: string
  vendors: HomeStatsVendor[]
}

/** Delay before the first chip leaves the badge: the hero's own reveal runs at
 * 280ms, so the burst reads as a consequence of the section landing. */
const BURST_LEAD_MS = 320
/** How long the whole burst takes to finish handing out departures. */
const BURST_SPREAD_MS = 620
/**
 * Fractional part of the golden ratio. Walking it modulo 1 spreads the chips
 * across the window without ever revisiting a slot, so they leave the badge in
 * a scattered order instead of marching down one column and then the other —
 * and it stays a pure function of the index, so the order is the same on every
 * render rather than a fresh random draw.
 */
const GOLDEN_RATIO_FRACTION = 0.618033988749895

function burstDelay(index: number) {
  return Math.round(
    BURST_LEAD_MS + ((index * GOLDEN_RATIO_FRACTION) % 1) * BURST_SPREAD_MS
  )
}

/**
 * Floating surface + provider bubble cloud: the product surfaces BoxAI hands
 * the visitor on the left, the upstream vendors it actually routes to on the
 * right. On first paint the chips burst out of the brand badge at the centre
 * and then settle into a slow ambient drift; `.hero-orbit-chip` in
 * `styles/index.css` owns the placement and both animations.
 */
export function HeroEcosystem(props: HeroEcosystemProps) {
  const { t } = useTranslation()

  const surfaces: BubbleItem[] = [
    {
      label: t('Unified API Access'),
      tone: 'bg-chart-1/10 ring-chart-1/20 text-chart-1',
      icon: <Braces className='size-3.5' />,
      x: 4,
      y: 16,
    },
    {
      label: t('Workspace'),
      tone: 'bg-chart-4/10 ring-chart-4/20 text-chart-4',
      icon: <MessageSquare className='size-3.5' />,
      x: 20,
      y: 30,
    },
    {
      label: t('Image & Video'),
      tone: 'bg-chart-5/10 ring-chart-5/20 text-chart-5',
      icon: <Clapperboard className='size-3.5' />,
      x: 2,
      y: 44,
    },
    {
      label: t('Model Hub'),
      tone: 'bg-chart-2/10 ring-chart-2/20 text-chart-2',
      icon: <Layers3 className='size-3.5' />,
      x: 18,
      y: 58,
    },
    {
      label: t('Desktop apps'),
      tone: 'bg-chart-10/10 ring-chart-10/20 text-chart-10',
      icon: <MonitorSmartphone className='size-3.5' />,
      x: 2,
      y: 72,
    },
    {
      label: t('Usage Analytics'),
      tone: 'bg-chart-3/10 ring-chart-3/20 text-chart-3',
      icon: <BarChart3 className='size-3.5' />,
      x: 20,
      y: 86,
    },
  ]

  const providerPositions = [
    { rx: 18, y: 12 },
    { rx: 4, y: 24 },
    { rx: 22, y: 34 },
    { rx: 6, y: 46 },
    { rx: 24, y: 58 },
    { rx: 4, y: 70 },
    { rx: 24, y: 82 },
    { rx: 42, y: 22 },
  ]
  const providers: BubbleItem[] = props.vendors
    .slice(0, providerPositions.length)
    .map((vendor, index) => ({
      label: vendor.name,
      tone: 'bg-background text-foreground ring-border/60',
      icon: vendor.icon ? <LobeIcon name={vendor.icon} size={14} /> : null,
      ...providerPositions[index],
    }))

  const bubbles = [...surfaces, ...providers]

  return (
    <div
      className={cn(
        // Below `sm` the orbit positions collide, so the chips fall back to a
        // centered wrap and the decorative rings drop out entirely.
        'hero-orbit relative mx-auto flex w-full max-w-[560px] flex-wrap items-center justify-center gap-2',
        'sm:block sm:aspect-square lg:aspect-[5/4] lg:max-w-none',
        props.className
      )}
      aria-hidden
    >
      {/* Soft radial field */}
      <div className='pointer-events-none absolute inset-[8%] hidden rounded-full bg-[radial-gradient(circle_at_center,oklch(0.72_0.12_250_/_0.18),transparent_68%)] sm:block dark:bg-[radial-gradient(circle_at_center,oklch(0.55_0.12_250_/_0.22),transparent_70%)]' />
      <div className='border-primary/10 hero-orbit-ring pointer-events-none absolute inset-[18%] hidden rounded-full border sm:block' />
      <div className='border-primary/10 hero-orbit-ring pointer-events-none absolute inset-[32%] hidden rounded-full border sm:block' />

      {/* Center brand badge — the origin of the burst */}
      <div className='bg-background/90 border-primary/20 hero-orbit-core z-10 flex w-full items-center justify-center gap-2 rounded-full border px-4 py-2 shadow-lg backdrop-blur-md sm:absolute sm:top-1/2 sm:left-1/2 sm:w-auto sm:-translate-x-1/2 sm:-translate-y-1/2'>
        <span className='from-primary to-chart-2 text-primary-foreground flex size-7 items-center justify-center rounded-full bg-gradient-to-br shadow-sm'>
          <Sparkles className='size-3.5' />
        </span>
        <span className='text-sm font-semibold tracking-tight'>
          {props.brand}
        </span>
      </div>

      {bubbles.map((item, index) => (
        <div
          key={`${item.label}-${item.y}`}
          className={cn(
            'hero-orbit-chip z-[1] inline-flex items-center gap-1.5 rounded-full px-3 py-1.5 text-xs font-medium shadow-sm ring-1 backdrop-blur-sm',
            item.tone
          )}
          style={
            {
              '--x': item.x === undefined ? 'auto' : `${item.x}%`,
              '--rx': item.rx === undefined ? 'auto' : `${item.rx}%`,
              '--y': `${item.y}%`,
              // Vector back to the centre of the orbit box, which is where the
              // chip starts from. Right-anchored chips travel the other way.
              '--burst-x':
                item.rx === undefined
                  ? `${50 - (item.x ?? 50)}cqw`
                  : `${item.rx - 50}cqw`,
              '--burst-y': `${50 - item.y}cqh`,
              '--burst-delay': `${burstDelay(index)}ms`,
            } as React.CSSProperties
          }
        >
          {item.icon}
          {/* 色相只承载在图标/底色/描边上（图形元素 3:1 即可）；
              标签固定用 text-foreground，避免图表填充色当小字用时低于 4.5:1 */}
          <span className='text-foreground whitespace-nowrap'>
            {item.label}
          </span>
        </div>
      ))}

      {/* Decorative orbit dots */}
      <div className='bg-chart-1/40 hidden size-2 rounded-full sm:absolute sm:top-[10%] sm:left-[52%] sm:block' />
      <div className='bg-chart-2/40 hidden size-1.5 rounded-full sm:absolute sm:top-[55%] sm:left-[62%] sm:block' />
      <div className='bg-chart-3/40 hidden size-1.5 rounded-full sm:absolute sm:top-[40%] sm:left-[5%] sm:block' />
      <Bot className='text-muted-foreground hidden size-5 sm:absolute sm:right-[48%] sm:bottom-[8%] sm:block' />
    </div>
  )
}
