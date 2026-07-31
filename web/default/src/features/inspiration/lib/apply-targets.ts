import type { StudioModality } from '@/features/playground/types'

import type { InspirationApplyOption } from '../types'

export const AUTORUN_STORAGE_KEY = 'workbench_inspiration_autorun'

export function applyTargetsForModality(
  modality: StudioModality
): InspirationApplyOption[] {
  if (modality === 'image') {
    return [
      { value: 'image', label: 'Image node' },
      { value: 'storyboard-row', label: 'Storyboard row' },
      { value: 'note', label: 'Note' },
    ]
  }
  if (modality === 'video') {
    return [
      { value: 'video', label: 'Video node' },
      { value: 'image-to-video', label: 'Image to video' },
      { value: 'storyboard-row', label: 'Storyboard row' },
      { value: 'note', label: 'Note' },
    ]
  }
  if (modality === 'audio') {
    return [
      { value: 'audio', label: 'Audio node' },
      { value: 'note', label: 'Note' },
    ]
  }
  return [{ value: 'note', label: 'Note' }]
}

export function readAutorunPreference(): boolean {
  try {
    return window.localStorage.getItem(AUTORUN_STORAGE_KEY) === '1'
  } catch {
    return false
  }
}
