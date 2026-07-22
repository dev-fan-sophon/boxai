/*
Copyright (C) 2023-2026 QuantumNous

This program is free software: you can redistribute it and/or modify
it under the terms of the GNU Affero General Public License as
published by the Free Software Foundation, either version 3 of the
License, or (at your option) any later version.
*/
import { useTranslation } from 'react-i18next'

import type { PricingModel } from '@/features/pricing/types'
import { usePlaygroundStore } from '@/stores/playground-store'

import type { StudioModality } from '../../types'
import {
  MediaReferenceSlot,
  type MediaReference,
} from './attachments/media-reference-slot'
import { ComposerShell } from './composer'
import { PriceHintBadge } from './price-hint'
import { useComposerText } from './use-composer'

type GenerationComposerProps = {
  modality: Exclude<StudioModality, 'chat'>
  pricingModel?: PricingModel
  isPending: boolean
  reference: MediaReference | null
  onReferenceChange: (value: MediaReference | null) => void
  onSubmit: (prompt: string) => void
}

/**
 * Composer for image/video/audio generation: shared skeleton plus the
 * media reference slot (image reference / video first frame) and the
 * price hint. Generation parameters live in the settings panel.
 */
export function GenerationComposer(props: GenerationComposerProps) {
  const { t } = useTranslation()
  const { text, setText } = useComposerText()
  const model = usePlaygroundStore((state) => state.config.model)
  const group = usePlaygroundStore((state) => state.config.group)
  const groups = usePlaygroundStore((state) => state.groups)
  const settings = usePlaygroundStore((state) => state.studioSettings)

  const showMediaSlot = props.modality === 'image' || props.modality === 'video'
  const mediaLabel =
    props.modality === 'video' ? t('First frame') : t('Reference image')
  const groupRatio = groups.find((item) => item.value === group)?.ratio

  const submit = () => {
    if (!text.trim() || !model || props.isPending) return
    props.onSubmit(text.trim())
  }

  return (
    <div className='mx-auto w-full max-w-4xl shrink-0 px-2 pb-3 md:px-3 md:pb-4'>
      <ComposerShell
        text={text}
        onTextChange={setText}
        onSubmit={submit}
        placeholder={t(
          props.modality === 'audio'
            ? 'Enter the text to speak…'
            : 'Describe what you want to create…'
        )}
        disabled={props.isPending}
        canSubmit={Boolean(text.trim() && model && !props.isPending)}
        attachments={
          showMediaSlot ? (
            <div className='px-5 pb-2'>
              <MediaReferenceSlot
                label={mediaLabel}
                value={props.reference}
                onChange={props.onReferenceChange}
                attachable
                kind='image'
              />
            </div>
          ) : undefined
        }
        trailing={
          <PriceHintBadge
            model={props.pricingModel}
            group={group}
            groupRatio={groupRatio}
            estimateParams={{
              modality: props.modality,
              n: settings.imageCount,
              size:
                props.modality === 'video'
                  ? settings.videoSize
                  : settings.imageSize,
              duration:
                props.modality === 'video' ? settings.videoDuration : undefined,
              has_reference: Boolean(props.reference),
            }}
          />
        }
        className='px-0'
      />
    </div>
  )
}
