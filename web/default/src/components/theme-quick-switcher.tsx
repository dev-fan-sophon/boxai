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
import { Monitor, Sun, MoonStar } from 'lucide-react'
import { motion } from 'motion/react'
import { useTranslation } from 'react-i18next'

import { Button } from '@/components/ui/button'
import { useTheme } from '@/context/theme-provider'
import { cn } from '@/lib/utils'

export function ThemeQuickSwitcher() {
  const { t } = useTranslation()
  const { theme, setTheme } = useTheme()

  const options = [
    {
      id: 'system' as const,
      label: t('System'),
      icon: Monitor,
    },
    {
      id: 'light' as const,
      label: t('Light'),
      icon: Sun,
    },
    {
      id: 'dark' as const,
      label: t('Dark'),
      icon: MoonStar,
    },
  ]

  return (
    <div className='px-2 pt-1.5 pb-1'>
      <div className='flex w-full items-center justify-between gap-3'>
        <span
          id='theme-switcher-label'
          className='text-muted-foreground text-sm select-none'
        >
          {t('Theme')}
        </span>
        <div
          role='radiogroup'
          aria-labelledby='theme-switcher-label'
          className='border-muted/50 bg-muted/40 inline-flex w-auto items-center gap-1.5 rounded-lg border px-1.5 py-1'
        >
          {options.map((opt) => {
            const Icon = opt.icon
            const active = theme === opt.id
            return (
              <Button
                key={opt.id}
                variant='ghost'
                size='icon'
                role='radio'
                aria-label={opt.label}
                aria-checked={active}
                onClick={() => setTheme(opt.id)}
                className={cn(
                  'relative size-7',
                  active && 'text-accent-foreground'
                )}
              >
                {active && (
                  <motion.span
                    layoutId='theme-switcher-active'
                    className='bg-accent ring-border absolute inset-0 rounded-md ring-1'
                    transition={{
                      type: 'spring',
                      stiffness: 500,
                      damping: 30,
                      mass: 0.2,
                    }}
                    animate={{ rotate: 360 }}
                  />
                )}
                <Icon className='relative z-10 size-[0.95rem]' />
              </Button>
            )
          })}
        </div>
      </div>
    </div>
  )
}
