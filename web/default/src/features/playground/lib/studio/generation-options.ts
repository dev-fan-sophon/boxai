// Option lists for the generation settings panel.
// Image options match the OpenAI Images schema (GPT Image / Grok Imagine).

import {
  GPT_IMAGE_COUNTS,
  GPT_IMAGE_QUALITIES,
  GPT_IMAGE_SIZES,
} from './image-request-schema'

export const IMAGE_SIZES = GPT_IMAGE_SIZES
export const IMAGE_QUALITIES = GPT_IMAGE_QUALITIES
export const IMAGE_COUNTS = GPT_IMAGE_COUNTS

export const VOICES = [
  'alloy',
  'echo',
  'fable',
  'onyx',
  'nova',
  'shimmer',
] as const
export const SPEEDS = [0.75, 1, 1.25, 1.5] as const
export const AUDIO_FORMATS = ['mp3', 'opus', 'aac', 'flac', 'wav'] as const

export { imageQualityLabelKey, imageSizeLabel } from './image-request-schema'
