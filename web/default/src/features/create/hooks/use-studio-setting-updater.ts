import type { StudioSettings } from '@/features/playground/types'
import { usePlaygroundStore } from '@/stores/playground-store'

/** Writes one studio setting; shared by the audio settings panels and chips. */
export function useStudioSettingUpdater() {
  const setStudioSettings = usePlaygroundStore(
    (state) => state.setStudioSettings
  )
  return <K extends keyof StudioSettings>(key: K, value: StudioSettings[K]) =>
    setStudioSettings((prev) => ({ ...prev, [key]: value }))
}
