import { useEffect, useState } from 'react'

import { usePlaygroundStore } from '@/stores/playground-store'

/**
 * Composer text state with store-driven prefill consumption. Exactly one
 * composer is mounted at a time, so consuming the prefill here is safe.
 */
export function useComposerText() {
  const [text, setText] = useState('')
  const prefill = usePlaygroundStore((state) => state.prefill)
  const consumePrefill = usePlaygroundStore((state) => state.consumePrefill)

  useEffect(() => {
    if (!prefill) return
    setText(prefill.prompt)
    consumePrefill()
  }, [prefill, consumePrefill])

  return { text, setText }
}
