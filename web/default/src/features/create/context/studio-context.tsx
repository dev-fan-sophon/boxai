import { createContext, useContext } from 'react'

import { useStudio, type UseStudioResult } from '../hooks/use-studio'

const StudioContext = createContext<UseStudioResult | null>(null)

/**
 * Owns the generation queue for the whole studio. Mounted on the `/create`
 * layout so switching between Image, Video, Audio and Library keeps queued
 * and running jobs; leaving the studio drops jobs still waiting for a slot.
 */
export function StudioProvider(props: { children: React.ReactNode }) {
  const studio = useStudio()
  return (
    <StudioContext.Provider value={studio}>
      {props.children}
    </StudioContext.Provider>
  )
}

// eslint-disable-next-line react-refresh/only-export-components
export function useStudioContext(): UseStudioResult {
  const studio = useContext(StudioContext)
  if (!studio) {
    throw new Error('useStudioContext must be used in StudioProvider')
  }
  return studio
}
