/*
Copyright (C) 2023-2026 QuantumNous

This program is free software: you can redistribute it and/or modify
it under the terms of the GNU Affero General Public License as
published by the Free Software Foundation, either version 3 of the
License, or (at your option) any later version.
*/
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
