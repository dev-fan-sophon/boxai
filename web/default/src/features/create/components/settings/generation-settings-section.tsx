import type { StudioModality } from '@/features/playground/types'

import { AudioSettings } from './audio-settings'
import { ImageSettings } from './image-settings'
import { VideoSettings } from './video-settings'

/** Generation parameters of the active creation tool. */
export function GenerationSettingsSection(props: {
  modality: Exclude<StudioModality, 'chat'>
  videoMode?: 'text' | 'frames' | 'references'
  videoReferenceCount?: number
}) {
  if (props.modality === 'image') return <ImageSettings />
  if (props.modality === 'video') {
    return (
      <VideoSettings
        videoMode={props.videoMode}
        videoReferenceCount={props.videoReferenceCount}
      />
    )
  }
  return <AudioSettings />
}
