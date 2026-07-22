/*
Copyright (C) 2023-2026 QuantumNous

This program is free software: you can redistribute it and/or modify
it under the terms of the GNU Affero General Public License as
published by the Free Software Foundation, either version 3 of the
License, or (at your option) any later version.
*/
import { Loader2, Send } from 'lucide-react'
import { useTranslation } from 'react-i18next'

import type { PricingModel } from '@/features/pricing/types'
import { cn } from '@/lib/utils'

import type { GroupOption, StudioModality, StudioSettings } from '../../types'
import {
  MediaReferenceSlot,
  type MediaReference,
} from './media-reference-slot'
import { ParameterChips } from './parameter-chips'
import { PriceHintBadge } from './price-hint'

type GenerationDockProps = {
  modality: Exclude<StudioModality, 'chat'>
  model: string
  pricingModel?: PricingModel
  group: string
  groups: GroupOption[]
  onGroupChange: (group: string) => void
  settings: StudioSettings
  onSettingsChange: (settings: StudioSettings) => void
  prompt: string
  onPromptChange: (value: string) => void
  onSubmit: () => void
  isPending: boolean
  reference: MediaReference | null
  onReferenceChange: (value: MediaReference | null) => void
  className?: string
}

export function GenerationDock(props: GenerationDockProps) {
  const { t } = useTranslation()
  const showMediaSlot =
    props.modality === 'image' || props.modality === 'video'
  const mediaLabel =
    props.modality === 'video' ? t('First frame') : t('Reference image')

  const groupRatio = props.groups.find((g) => g.value === props.group)?.ratio

  return (
    <div
      className={cn(
        'pointer-events-none absolute inset-x-0 bottom-0 z-10 px-3 pb-3 md:px-5 md:pb-5',
        props.className
      )}
    >
      <form
        className={cn(
          'pointer-events-auto mx-auto flex w-full max-w-4xl flex-col gap-2 rounded-2xl border border-white/[0.1]',
          'bg-[#141418]/92 p-3 shadow-[0_20px_60px_-24px_rgba(0,0,0,0.85)] backdrop-blur-xl',
          'ring-1 ring-white/[0.04]'
        )}
        onSubmit={(event) => {
          event.preventDefault()
          props.onSubmit()
        }}
      >
        <div className='flex gap-3'>
          {showMediaSlot && (
            <MediaReferenceSlot
              label={mediaLabel}
              value={props.reference}
              onChange={props.onReferenceChange}
              attachable
              kind='image'
            />
          )}
          <div className='min-w-0 flex-1'>
            <label htmlFor='workbench-gen-prompt' className='sr-only'>
              {props.modality === 'audio' ? t('Speech text') : t('Prompt')}
            </label>
            <textarea
              id='workbench-gen-prompt'
              value={props.prompt}
              onChange={(event) => props.onPromptChange(event.target.value)}
              rows={3}
              className={cn(
                'w-full resize-none bg-transparent text-sm leading-relaxed text-zinc-100 outline-none',
                'placeholder:text-zinc-500'
              )}
              placeholder={t(
                props.modality === 'audio'
                  ? 'Enter the text to speak…'
                  : 'Describe what you want to create…'
              )}
            />
          </div>
        </div>

        <div className='flex flex-col gap-2 border-t border-white/[0.06] pt-2 sm:flex-row sm:items-center sm:justify-between'>
          <ParameterChips
            modality={props.modality}
            group={props.group}
            groups={props.groups}
            onGroupChange={props.onGroupChange}
            settings={props.settings}
            onSettingsChange={props.onSettingsChange}
          />
          <div className='flex shrink-0 items-center justify-end gap-2'>
            <PriceHintBadge
              model={props.pricingModel}
              group={props.group}
              groupRatio={groupRatio}
              estimateParams={{
                modality: props.modality,
                n: props.settings.imageCount,
                size:
                  props.modality === 'video'
                    ? props.settings.videoSize
                    : props.settings.imageSize,
                duration:
                  props.modality === 'video'
                    ? props.settings.videoDuration
                    : undefined,
                has_reference: Boolean(props.reference),
              }}
            />
            <button
              type='submit'
              disabled={
                !props.prompt.trim() || !props.model || props.isPending
              }
              aria-label={t('Generate')}
              className={cn(
                'inline-flex size-10 items-center justify-center rounded-full bg-[#00CAE0] text-zinc-950 shadow-[0_0_24px_-4px_rgba(0,202,224,0.7)]',
                'transition hover:bg-cyan-300 disabled:cursor-not-allowed disabled:bg-zinc-700 disabled:text-zinc-400 disabled:shadow-none',
                'outline-none focus-visible:ring-2 focus-visible:ring-cyan-300 focus-visible:ring-offset-2 focus-visible:ring-offset-[#141418]'
              )}
            >
              {props.isPending ? (
                <Loader2 className='size-4 animate-spin' />
              ) : (
                <Send className='size-4' />
              )}
            </button>
          </div>
        </div>
      </form>
    </div>
  )
}
