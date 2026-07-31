import { animate, useReducedMotion } from 'motion/react'
import { useEffect, useRef, useState } from 'react'

interface CountUpOptions {
  duration?: number
  delay?: number
}

/**
 * Animate a numeric value from its previous state to the next target.
 * Respects prefers-reduced-motion and treats non-finite targets as 0.
 */
export function useCountUp(target: number, options?: CountUpOptions): number {
  const reduceMotion = useReducedMotion()
  const [display, setDisplay] = useState(0)
  const previousRef = useRef(0)
  const duration = options?.duration ?? 0.8
  const delay = options?.delay ?? 0

  useEffect(() => {
    const next = Number.isFinite(target) ? target : 0
    if (reduceMotion) {
      previousRef.current = next
      setDisplay(next)
      return
    }

    const controls = animate(previousRef.current, next, {
      duration,
      delay,
      ease: [0.22, 1, 0.36, 1],
      onUpdate: (latest) => setDisplay(latest),
    })
    previousRef.current = next

    return () => controls.stop()
  }, [target, duration, delay, reduceMotion])

  return display
}
