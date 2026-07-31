import { useMdDown } from './use-breakpoint'

/**
 * Matches viewports below the md (768px) boundary.
 * Implemented with useSyncExternalStore, so the first render already
 * reflects the real viewport instead of flashing an undefined state.
 */
export function useIsMobile(): boolean {
  return useMdDown()
}
