import { useEffect, useRef, useState, type ReactNode } from 'react'

import { cn } from '@/lib/utils'

type Animation = 'fade-up' | 'fade-in' | 'scale-in' | 'fade-left' | 'fade-right'

interface AnimateInViewProps {
  children: ReactNode
  className?: string
  delay?: number
  threshold?: number
  animation?: Animation
  once?: boolean
  as?: 'div' | 'section' | 'li' | 'span'
}

type Subscriber = (isIntersecting: boolean) => void

/* One observer per threshold instead of one per element. A landing page mounts
 * a dozen of these at once, and every extra IntersectionObserver is its own
 * callback queue for the compositor to service on scroll. */
const observers = new Map<number, IntersectionObserver>()
const subscribers = new WeakMap<Element, Subscriber>()

function observe(element: Element, threshold: number, onChange: Subscriber) {
  let observer = observers.get(threshold)

  if (!observer) {
    observer = new IntersectionObserver(
      (entries) => {
        for (const entry of entries) {
          subscribers.get(entry.target)?.(entry.isIntersecting)
        }
      },
      { threshold, rootMargin: '0px 0px -40px 0px' }
    )
    observers.set(threshold, observer)
  }

  subscribers.set(element, onChange)
  observer.observe(element)

  return () => {
    subscribers.delete(element)
    observer.unobserve(element)
  }
}

/**
 * Reveals its children when they scroll into view, using the same
 * `landing-animate-*` vocabulary that on-mount reveals apply directly.
 *
 * The visible state lives in React rather than in a class the effect toggles by
 * hand. An imperative `classList` write is invisible to the reconciler, so the
 * next render that touches `className` silently reinstates `opacity-0` and the
 * section never comes back — the observer has already stopped watching it.
 *
 * Reduced motion is handled in CSS, which keeps the reveal but drops the travel.
 */
export function AnimateInView(props: AnimateInViewProps) {
  const {
    as: Tag = 'div',
    delay = 0,
    threshold = 0.15,
    animation = 'fade-up',
    once = true,
  } = props

  const ref = useRef<HTMLElement>(null)
  const [revealed, setRevealed] = useState(false)
  const [settled, setSettled] = useState(false)

  useEffect(() => {
    const element = ref.current
    if (!element) return

    return observe(element, threshold, (isIntersecting) => {
      if (isIntersecting) {
        setRevealed(true)
        return
      }
      if (!once) {
        setRevealed(false)
        setSettled(false)
      }
    })
  }, [threshold, once])

  return (
    <Tag
      ref={ref as never}
      // `will-change` buys a compositor layer for the duration of the reveal
      // and costs memory for the lifetime of the element, so it is dropped as
      // soon as the animation ends.
      className={cn(
        revealed ? `landing-animate-${animation}` : 'opacity-0',
        !settled && 'will-change-[transform,opacity]',
        props.className
      )}
      style={{ animationDelay: delay ? `${delay}ms` : undefined }}
      onAnimationEnd={(event) => {
        // animationend bubbles, and a revealed section can contain spinners or
        // shimmers of its own; only this element's reveal settles it.
        if (event.target === event.currentTarget) setSettled(true)
      }}
    >
      {props.children}
    </Tag>
  )
}
