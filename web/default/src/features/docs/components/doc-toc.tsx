import { useEffect, useState } from 'react'
import { useTranslation } from 'react-i18next'

import { cn } from '@/lib/utils'

import type { DocsHeading } from '../lib/types'

export function DocToc(props: { headings: DocsHeading[] }) {
  const { t } = useTranslation()
  const [activeId, setActiveId] = useState<string>('')

  useEffect(() => {
    if (props.headings.length === 0) return
    const elements = props.headings
      .map((heading) =>
        document.querySelector<HTMLElement>(`#${CSS.escape(heading.id)}`)
      )
      .filter((node): node is HTMLElement => Boolean(node))
    if (elements.length === 0) return

    const observer = new IntersectionObserver(
      (entries) => {
        const visible = entries
          .filter((entry) => entry.isIntersecting)
          .sort((a, b) => b.intersectionRatio - a.intersectionRatio)
        if (visible[0]?.target?.id) {
          setActiveId(visible[0].target.id)
        }
      },
      { rootMargin: '-20% 0px -60% 0px', threshold: [0, 0.25, 0.5, 1] }
    )
    for (const el of elements) observer.observe(el)
    return () => observer.disconnect()
  }, [props.headings])

  if (props.headings.length === 0) return null

  return (
    <nav aria-label={t('On this page')} className='space-y-2'>
      <p className='text-muted-foreground text-xs font-semibold tracking-wide uppercase'>
        {t('On this page')}
      </p>
      <ul className='space-y-1.5'>
        {props.headings.map((heading) => (
          <li key={heading.id}>
            <a
              href={`#${heading.id}`}
              className={cn(
                'text-muted-foreground hover:text-foreground block text-sm transition-colors',
                heading.level > 2 && 'pl-3',
                activeId === heading.id && 'text-foreground font-medium'
              )}
            >
              {heading.text}
            </a>
          </li>
        ))}
      </ul>
    </nav>
  )
}
