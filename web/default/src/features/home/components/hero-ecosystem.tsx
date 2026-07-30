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
  KeyRound,
  Layers3,
  MessageSquare,
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
  className: string
}

interface HeroEcosystemProps {
  className?: string
  vendors: HomeStatsVendor[]
}

/**
 * Floating capability + provider bubble cloud (Apilio-style marketing hero visual).
 */
export function HeroEcosystem(props: HeroEcosystemProps) {
  const { t } = useTranslation()

  const capabilities: BubbleItem[] = [
    {
      label: t('Smart Chat'),
      tone: 'bg-chart-4/10 text-chart-4 ring-chart-4/20',
      icon: <MessageSquare className='size-3.5' />,
      className: 'sm:left-[8%] sm:top-[18%]',
    },
    {
      label: t('Unified API Access'),
      tone: 'bg-chart-1/10 text-chart-1 ring-chart-1/20',
      icon: <Braces className='size-3.5' />,
      className: 'sm:left-[2%] sm:top-[48%]',
    },
    {
      label: t('Model Catalog'),
      tone: 'bg-chart-2/10 text-chart-2 ring-chart-2/20',
      icon: <Layers3 className='size-3.5' />,
      className: 'sm:left-[18%] sm:top-[32%]',
    },
    {
      label: t('API Keys'),
      tone: 'bg-chart-10/10 text-chart-10 ring-chart-10/20',
      icon: <KeyRound className='size-3.5' />,
      className: 'sm:left-[22%] sm:top-[58%]',
    },
    {
      label: t('Usage Analytics'),
      tone: 'bg-chart-3/10 text-chart-3 ring-chart-3/20',
      icon: <BarChart3 className='size-3.5' />,
      className: 'sm:left-[6%] sm:top-[72%]',
    },
  ]

  const providerPositions = [
    'sm:right-[18%] sm:top-[12%]',
    'sm:right-[4%] sm:top-[24%]',
    'sm:right-[22%] sm:top-[34%]',
    'sm:right-[6%] sm:top-[46%]',
    'sm:right-[24%] sm:top-[58%]',
    'sm:right-[4%] sm:top-[70%]',
    'sm:right-[24%] sm:top-[82%]',
    'sm:right-[42%] sm:top-[22%]',
  ]
  const providers: BubbleItem[] = props.vendors
    .slice(0, providerPositions.length)
    .map((vendor, index) => ({
      label: vendor.name,
      tone: 'bg-background text-foreground ring-border/60',
      icon: vendor.icon ? <LobeIcon name={vendor.icon} size={14} /> : null,
      className: providerPositions[index],
    }))

  return (
    <div
      className={cn(
        // Below `sm` the orbit positions collide, so the chips fall back to a
        // centered wrap and the decorative rings drop out entirely.
        'relative mx-auto flex w-full max-w-[560px] flex-wrap items-center justify-center gap-2',
        'sm:block sm:aspect-square lg:aspect-[5/4] lg:max-w-none',
        props.className
      )}
      aria-hidden
    >
      {/* Soft radial field */}
      <div className='pointer-events-none absolute inset-[8%] hidden rounded-full bg-[radial-gradient(circle_at_center,oklch(0.72_0.12_250_/_0.18),transparent_68%)] sm:block dark:bg-[radial-gradient(circle_at_center,oklch(0.55_0.12_250_/_0.22),transparent_70%)]' />
      <div className='border-primary/10 pointer-events-none absolute inset-[18%] hidden rounded-full border sm:block' />
      <div className='border-primary/10 pointer-events-none absolute inset-[32%] hidden rounded-full border sm:block' />

      {/* Center brand badge */}
      <div className='bg-background/90 border-primary/20 z-10 flex w-full items-center justify-center gap-2 rounded-full border px-4 py-2 shadow-lg backdrop-blur-md sm:absolute sm:top-1/2 sm:left-1/2 sm:w-auto sm:-translate-x-1/2 sm:-translate-y-1/2'>
        <span className='from-primary to-chart-2 text-primary-foreground flex size-7 items-center justify-center rounded-full bg-gradient-to-br shadow-sm'>
          <Sparkles className='size-3.5' />
        </span>
        <span className='text-sm font-semibold tracking-tight'>BoxAI</span>
      </div>

      {[...capabilities, ...providers].map((item) => (
        <div
          key={`${item.label}-${item.className}`}
          className={cn(
            'z-[1] inline-flex items-center gap-1.5 rounded-full px-3 py-1.5 text-xs font-medium shadow-sm ring-1 backdrop-blur-sm sm:absolute',
            item.tone,
            item.className
          )}
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
