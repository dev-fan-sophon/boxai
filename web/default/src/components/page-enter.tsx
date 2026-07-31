import type { ReactNode } from 'react'

import { cn } from '@/lib/utils'

/*
 * Entrances for surfaces that only ever animate in.
 *
 * These live apart from `page-transition.tsx` and use CSS keyframes rather than
 * `motion/react` because the pricing, rankings, auth and error pages reach them
 * — and a static import of the animation runtime from any of those puts ~126 KB
 * of JavaScript on the critical path of pages whose motion is entirely CSS.
 * Anything that needs an *exit* still belongs in `page-transition.tsx`, since
 * that genuinely requires `AnimatePresence`.
 */

interface PageTransitionProps {
  children: ReactNode
  className?: string
}

export function PageTransition(props: PageTransitionProps) {
  return (
    <div className={cn('page-enter', props.className)}>{props.children}</div>
  )
}

interface FadeInProps {
  children: ReactNode
  className?: string
  /** Seconds, matching the `motion/react` prop it replaces. */
  delay?: number
}

export function FadeIn(props: FadeInProps) {
  return (
    <div
      className={cn('fade-enter', props.className)}
      style={{
        animationDelay: props.delay ? `${props.delay}s` : undefined,
      }}
    >
      {props.children}
    </div>
  )
}
