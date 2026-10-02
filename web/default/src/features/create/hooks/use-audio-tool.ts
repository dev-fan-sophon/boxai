import { useContext } from 'react'
import { useTranslation } from 'react-i18next'

import { FILE_AUDIO_TOOLS } from '@/features/playground/lib/studio/audio-settings'
import {
  getAudioKind,
  isElevenLabsAudioModel,
  type AudioKind,
} from '@/features/playground/lib/studio/model-modality'
import { usePlaygroundStore } from '@/stores/playground-store'

import { CreateWorkspaceContext } from '../context/workspace-context'

/** i18n keys of the audio sub-tools, in switcher order. */
export const AUDIO_TOOL_LABEL_KEYS: Record<AudioKind, string> = {
  speech: 'Speech',
  sfx: 'Sound effects',
  music: 'Music',
  transcribe: 'Transcribe',
  'voice-changer': 'Voice changer',
  isolate: 'Isolate voice',
  align: 'Align text',
}

/**
 * The active audio sub-tool and how the selected model runs it: `native`
 * models go through the ElevenLabs passthrough with the full parameter set,
 * other speech models through the OpenAI-compatible speech route.
 */
export function useAudioTool() {
  const { t } = useTranslation()
  // Optional: outside the create layout (tests, embeds) the model id alone
  // still identifies the ElevenLabs models.
  const workspace = useContext(CreateWorkspaceContext)
  const model = usePlaygroundStore((state) => state.config.model)
  const tool = usePlaygroundStore((state) => state.studioSettings.audioTool)
  const metadata = workspace?.findCatalogModel(model) ?? { model_name: model }
  const modelKind = model ? getAudioKind(metadata) : null
  return {
    tool,
    model,
    modelKind,
    native: Boolean(model) && isElevenLabsAudioModel(metadata),
    usesFile: FILE_AUDIO_TOOLS.has(tool),
    label: t(AUDIO_TOOL_LABEL_KEYS[tool]),
  }
}

export type AudioToolState = ReturnType<typeof useAudioTool>
