import { motion } from 'motion/react'
import { useEffect, useId, useState } from 'react'
import { useTranslation } from 'react-i18next'

import { MOTION_SPRING } from '@/lib/motion'
import { cn } from '@/lib/utils'

export interface BillingNavItem {
  id: string
  label: string
}

interface BillingNavProps {
  items: BillingNavItem[]
}

export function BillingNav(props: BillingNavProps) {
  const { t } = useTranslation()
  const indicatorId = useId()
  const [activeId, setActiveId] = useState(props.items[0]?.id ?? '')
  const ids = props.items.map((item) => item.id).join(',')

  useEffect(() => {
    const sections = ids
      .split(',')
      .map((id) => document.querySelector<HTMLElement>(`#${id}`))
      .filter((el): el is HTMLElement => el !== null)
    if (sections.length === 0) return

    const observer = new IntersectionObserver(
      (entries) => {
        const visible = entries
          .filter((entry) => entry.isIntersecting)
          .sort(
            (a, b) => a.boundingClientRect.top - b.boundingClientRect.top
          )[0]
        if (visible) setActiveId(visible.target.id)
      },
      { rootMargin: '-20% 0px -65% 0px', threshold: 0 }
    )
    sections.forEach((section) => observer.observe(section))
    return () => observer.disconnect()
  }, [ids])

  const handleClick = (id: string) => {
    document.querySelector(`#${id}`)?.scrollIntoView({
      behavior: 'smooth',
      block: 'start',
    })
    setActiveId(id)
  }

  return (
    <nav
      aria-label={t('Billing sections')}
      className='bg-background/85 sticky top-0 z-20 -mx-1 flex gap-1 overflow-x-auto px-1 py-2 backdrop-blur'
    >
      {props.items.map((item) => (
        <button
          key={item.id}
          type='button'
          onClick={() => handleClick(item.id)}
          aria-current={activeId === item.id ? 'true' : undefined}
          className={cn(
            'relative isolate h-8 rounded-lg px-3 text-sm font-medium whitespace-nowrap transition-colors',
            'ring-ring focus-visible:ring-2 focus-visible:outline-none',
            activeId === item.id
              ? 'text-foreground'
              : 'text-muted-foreground hover:text-foreground'
          )}
        >
          {activeId === item.id && (
            <motion.span
              layoutId={indicatorId}
              aria-hidden='true'
              className='bg-muted absolute inset-0 -z-10 rounded-lg'
              transition={MOTION_SPRING.snappy}
            />
          )}
          {item.label}
        </button>
      ))}
    </nav>
  )
}
