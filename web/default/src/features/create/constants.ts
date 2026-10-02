import {
  AudioLines,
  FolderOpen,
  ImageIcon,
  Video,
  type LucideIcon,
} from 'lucide-react'

export type CreateTool = 'image' | 'video' | 'audio'

export const CREATE_TOOLS: CreateTool[] = ['image', 'video', 'audio']

export function isCreateTool(value: unknown): value is CreateTool {
  return value === 'image' || value === 'video' || value === 'audio'
}

/** Navigation entries of the studio; labels are English i18n keys. */
export const CREATE_NAV: Array<{
  id: CreateTool | 'library'
  labelKey: string
  descriptionKey: string
  Icon: LucideIcon
}> = [
  {
    id: 'image',
    labelKey: 'Image',
    descriptionKey: 'Generate and edit images',
    Icon: ImageIcon,
  },
  {
    id: 'video',
    labelKey: 'Video',
    descriptionKey: 'Text, frames and storyboards to video',
    Icon: Video,
  },
  {
    id: 'audio',
    labelKey: 'Audio',
    descriptionKey: 'Speech, sound effects, music, transcripts and voice tools',
    Icon: AudioLines,
  },
  {
    id: 'library',
    labelKey: 'Library',
    descriptionKey: 'Everything you have created',
    Icon: FolderOpen,
  },
]

/** Upper bound of scenes in one storyboard; each scene is one billed video. */
export const MAX_STORYBOARD_SCENES = 12
