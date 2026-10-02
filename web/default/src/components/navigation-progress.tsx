import { useRouterState } from '@tanstack/react-router'
import { useEffect, useRef } from 'react'
import LoadingBar, { type LoadingBarRef } from 'react-top-loading-bar'

/**
 * Navigations that settle within this window never show the bar. Most
 * route changes are served from cache, and a bar that flashes for a frame on
 * every click reads as jitter rather than as progress.
 */
const SHOW_DELAY_MS = 120

export function NavigationProgress() {
  const ref = useRef<LoadingBarRef>(null)
  const startedRef = useRef(false)
  // Select only the status: subscribing to the whole router state re-rendered
  // this component on every location, match and loader update.
  const isPending = useRouterState({
    select: (state) => state.status === 'pending',
  })

  useEffect(() => {
    if (!isPending) {
      if (startedRef.current) ref.current?.complete()
      startedRef.current = false
      return
    }

    const timeoutId = window.setTimeout(() => {
      startedRef.current = true
      ref.current?.continuousStart()
    }, SHOW_DELAY_MS)
    return () => window.clearTimeout(timeoutId)
  }, [isPending])

  return (
    <LoadingBar color='var(--primary)' ref={ref} shadow={false} height={2} />
  )
}
