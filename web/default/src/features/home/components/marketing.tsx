import type { ReactNode } from 'react'

import { AnimateInView } from '@/components/animate-in-view'
import { cn } from '@/lib/utils'

/**
 * The public site's section kit. Every marketing page (home, about, Desktop,
 * Connect) opens its sections with the same eyebrow → title → lede block and
 * the same vertical rhythm, so the pages read as one site rather than a set of
 * one-offs. Eyebrows are sentence case on purpose: Vietnamese capitals with
 * stacked diacritics are hard to read when tracked out.
 */

export function Eyebrow(props: { children: ReactNode; className?: string }) {
  return (
    <p
      className={cn(
        'text-primary inline-flex items-center gap-2 text-xs font-medium',
        props.className
      )}
    >
      <span
        aria-hidden='true'
        className='bg-primary size-1.5 shrink-0 rounded-full'
      />
      {props.children}
    </p>
  )
}

export function SectionIntro(props: {
  id?: string
  eyebrow?: ReactNode
  title: ReactNode
  description?: ReactNode
  align?: 'start' | 'center'
  aside?: ReactNode
  className?: string
}) {
  const centered = props.align === 'center'

  return (
    <div
      className={cn(
        'mb-10 grid gap-8 md:mb-14',
        props.aside && 'lg:grid-cols-12 lg:items-end',
        props.className
      )}
    >
      <AnimateInView
        className={cn(
          'min-w-0',
          centered ? 'mx-auto max-w-2xl text-center' : 'max-w-2xl',
          props.aside && 'lg:col-span-7'
        )}
      >
        {props.eyebrow && <Eyebrow className='mb-4'>{props.eyebrow}</Eyebrow>}
        <h2
          id={props.id}
          className='text-foreground text-2xl leading-tight font-semibold tracking-tight text-balance sm:text-3xl md:text-4xl'
        >
          {props.title}
        </h2>
        {props.description && (
          <p className='text-muted-foreground md:text-md mt-4 text-sm leading-relaxed text-pretty sm:text-base'>
            {props.description}
          </p>
        )}
      </AnimateInView>
      {props.aside && (
        <AnimateInView delay={80} className='min-w-0 lg:col-span-5'>
          {props.aside}
        </AnimateInView>
      )}
    </div>
  )
}

export function MarketingSection(props: {
  children: ReactNode
  id?: string
  label?: string
  labelledBy?: string
  tone?: 'plain' | 'muted'
  className?: string
  innerClassName?: string
}) {
  return (
    <section
      id={props.id}
      aria-label={props.label}
      aria-labelledby={props.labelledBy}
      className={cn(
        'relative z-10 px-4 py-16 sm:px-6 sm:py-24',
        props.tone === 'muted' &&
          'bg-surface-sunken/60 border-border/50 border-y',
        props.className
      )}
    >
      <div className={cn('mx-auto max-w-6xl', props.innerClassName)}>
        {props.children}
      </div>
    </section>
  )
}

/**
 * The brand halo behind heroes and the closing call to action. Coral only —
 * the token is the runtime brand colour, so a re-branded deployment follows.
 */
export function BrandGlow(props: { className?: string }) {
  return (
    <div
      aria-hidden='true'
      className={cn(
        'pointer-events-none absolute inset-0 -z-10',
        props.className
      )}
    >
      <div
        className='absolute inset-0'
        style={{
          background: [
            'radial-gradient(60% 55% at 50% 0%, var(--brand-glow) 0%, transparent 70%)',
            'radial-gradient(35% 35% at 85% 10%, color-mix(in oklab, var(--chart-6) 10%, transparent) 0%, transparent 70%)',
            'radial-gradient(30% 30% at 12% 18%, color-mix(in oklab, var(--chart-9) 10%, transparent) 0%, transparent 70%)',
          ].join(', '),
        }}
      />
      <div
        className='absolute inset-0 opacity-60 dark:opacity-40'
        style={{
          backgroundImage:
            'linear-gradient(to right, color-mix(in oklab, var(--foreground) 6%, transparent) 1px, transparent 1px), linear-gradient(to bottom, color-mix(in oklab, var(--foreground) 6%, transparent) 1px, transparent 1px)',
          backgroundSize: '56px 56px',
          maskImage:
            'radial-gradient(ellipse 70% 60% at 50% 0%, black 0%, transparent 75%)',
          WebkitMaskImage:
            'radial-gradient(ellipse 70% 60% at 50% 0%, black 0%, transparent 75%)',
        }}
      />
    </div>
  )
}
