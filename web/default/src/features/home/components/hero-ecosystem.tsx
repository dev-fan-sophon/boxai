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

import { getLobeIcon } from '@/lib/lobe-icon'
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
      tone: 'bg-sky-500/10 text-sky-700 ring-sky-500/15 dark:text-sky-300',
      icon: <MessageSquare className='size-3.5' />,
      className: 'left-[8%] top-[18%]',
    },
    {
      label: t('Unified API Access'),
      tone: 'bg-blue-500/10 text-blue-700 ring-blue-500/15 dark:text-blue-300',
      icon: <Braces className='size-3.5' />,
      className: 'left-[2%] top-[48%]',
    },
    {
      label: t('Model Catalog'),
      tone: 'bg-violet-500/10 text-violet-700 ring-violet-500/15 dark:text-violet-300',
      icon: <Layers3 className='size-3.5' />,
      className: 'left-[18%] top-[32%]',
    },
    {
      label: t('API Keys'),
      tone: 'bg-indigo-500/10 text-indigo-700 ring-indigo-500/15 dark:text-indigo-300',
      icon: <KeyRound className='size-3.5' />,
      className: 'left-[22%] top-[58%]',
    },
    {
      label: t('Usage Analytics'),
      tone: 'bg-cyan-500/10 text-cyan-700 ring-cyan-500/15 dark:text-cyan-300',
      icon: <BarChart3 className='size-3.5' />,
      className: 'left-[6%] top-[72%]',
    },
  ]

  const providerPositions = [
    'right-[18%] top-[12%]',
    'right-[4%] top-[24%]',
    'right-[22%] top-[34%]',
    'right-[6%] top-[46%]',
    'right-[24%] top-[58%]',
    'right-[4%] top-[70%]',
    'right-[24%] top-[82%]',
    'right-[42%] top-[22%]',
  ]
  const providers: BubbleItem[] = props.vendors
    .slice(0, providerPositions.length)
    .map((vendor, index) => ({
      label: vendor.name,
      tone: 'bg-background text-foreground ring-border/60',
      icon: vendor.icon ? getLobeIcon(vendor.icon, 14) : null,
      className: providerPositions[index],
    }))

  return (
    <div
      className={cn(
        'relative mx-auto aspect-square w-full max-w-[560px] lg:aspect-[5/4] lg:max-w-none',
        props.className
      )}
      aria-hidden
    >
      {/* Soft radial field */}
      <div className='pointer-events-none absolute inset-[8%] rounded-full bg-[radial-gradient(circle_at_center,oklch(0.72_0.12_250_/_0.18),transparent_68%)] dark:bg-[radial-gradient(circle_at_center,oklch(0.55_0.12_250_/_0.22),transparent_70%)]' />
      <div className='pointer-events-none absolute inset-[18%] rounded-full border border-blue-500/10 dark:border-blue-400/10' />
      <div className='pointer-events-none absolute inset-[32%] rounded-full border border-blue-500/10 dark:border-blue-400/10' />

      {/* Center brand badge */}
      <div className='bg-background/90 absolute top-1/2 left-1/2 z-10 flex -translate-x-1/2 -translate-y-1/2 items-center gap-2 rounded-full border border-blue-500/20 px-4 py-2 shadow-[0_8px_30px_-12px_rgba(37,99,235,0.45)] backdrop-blur-md dark:border-blue-400/20'>
        <span className='flex size-7 items-center justify-center rounded-full bg-gradient-to-br from-blue-500 to-violet-500 text-white shadow-sm'>
          <Sparkles className='size-3.5' />
        </span>
        <span className='text-sm font-semibold tracking-tight'>BoxAI</span>
      </div>

      {[...capabilities, ...providers].map((item) => (
        <div
          key={`${item.label}-${item.className}`}
          className={cn(
            'absolute z-[1] inline-flex items-center gap-1.5 rounded-full px-3 py-1.5 text-xs font-medium shadow-[0_4px_16px_-8px_rgba(15,23,42,0.25)] ring-1 backdrop-blur-sm',
            item.tone,
            item.className
          )}
        >
          {item.icon}
          <span className='whitespace-nowrap'>{item.label}</span>
        </div>
      ))}

      {/* Decorative orbit dots */}
      <div className='absolute top-[10%] left-[52%] size-2 rounded-full bg-blue-400/40' />
      <div className='absolute top-[55%] left-[62%] size-1.5 rounded-full bg-violet-400/40' />
      <div className='absolute top-[40%] left-[5%] size-1.5 rounded-full bg-sky-400/40' />
      <Bot className='text-muted-foreground/20 absolute right-[48%] bottom-[8%] size-5' />
    </div>
  )
}
