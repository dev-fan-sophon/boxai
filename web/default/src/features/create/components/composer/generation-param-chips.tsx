import type { StudioModality } from '@/features/playground/types'

import { AudioParamChips } from './audio-param-chips'
import { ImageParamChips } from './image-param-chips'
import { VideoParamChips } from './video-param-chips'

/**
 * Inline generation parameters for the composer, per modality. Values are
 * shared with the settings panel through the studio settings store.
 */
export function GenerationParamChips(props: {
  modality: Exclude<StudioModality, 'chat'>
  hasImage?: boolean
}) {
  if (props.modality === 'image') return <ImageParamChips />
  if (props.modality === 'video') {
    return <VideoParamChips hasImage={props.hasImage === true} />
  }
  return <AudioParamChips />
}
