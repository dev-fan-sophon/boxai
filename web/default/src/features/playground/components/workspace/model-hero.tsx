/*
Copyright (C) 2023-2026 QuantumNous

This program is free software: you can redistribute it and/or modify
it under the terms of the GNU Affero General Public License as
published by the Free Software Foundation, either version 3 of the
License, or (at your option) any later version.
*/
import {
  ImageIcon,
  Music2,
  Sparkles,
  Video,
  type LucideIcon,
} from 'lucide-react'
import { motion, useReducedMotion } from 'motion/react'
import { useTranslation } from 'react-i18next'

import type { PricingModel } from '@/features/pricing/types'
import { MOTION_TRANSITION, MOTION_VARIANTS } from '@/lib/motion'
import { cn } from '@/lib/utils'

import type { StudioModality } from '../../types'

type ModelHeroProps = {
  model?: PricingModel
  modelName: string
  /** When set to image/video/audio, show a generic tool title instead of the model id. */
  modality?: Exclude<StudioModality, 'chat'>
  className?: string
  compact?: boolean
}

const MEDIA_HERO: Record<
  Exclude<StudioModality, 'chat'>,
  {
    titleKey: string
    descriptionKey: string
    tipKeys: string[]
    Icon: LucideIcon
    accent: string
  }
> = {
  image: {
    titleKey: 'Image generation',
    descriptionKey: 'Describe a scene and generate images.',
    tipKeys: [
      'Tip: mention style, lighting, and camera angle',
      'Tip: add a reference image to guide the look',
    ],
    Icon: ImageIcon,
    accent: 'from-chart-3/25 via-chart-4/15 to-transparent',
  },
  video: {
    titleKey: 'Video generation',
    descriptionKey: 'Describe a scene and generate videos.',
    tipKeys: [
      'Tip: describe motion, duration, and camera path',
      'Tip: use a first frame to lock the composition',
    ],
    Icon: Video,
    accent: 'from-warning/25 via-chart-1/15 to-transparent',
  },
  audio: {
    titleKey: 'Audio generation',
    descriptionKey: 'Enter text to generate speech audio.',
    tipKeys: [
      'Tip: write natural sentences for clearer speech',
      'Tip: adjust voice and speed in settings',
    ],
    Icon: Music2,
    accent: 'from-success/25 via-chart-5/15 to-transparent',
  },
}

export function ModelHero(props: ModelHeroProps) {
  const { t } = useTranslation()
  const shouldReduce = useReducedMotion()
  const media = props.modality ? MEDIA_HERO[props.modality] : null
  const title = media
    ? t(media.titleKey)
    : props.modelName || t('Select a model')
  let description = t('Select a model from the catalog to start creating.')
  if (media) {
    description = t(media.descriptionKey)
  } else if (props.model?.description) {
    description = props.model.description
  } else if (props.model?.vendor_description) {
    description = props.model.vendor_description
  } else if (props.model?.usage_notes) {
    description = props.model.usage_notes
  }
  const Icon = media?.Icon
  const tip = media ? t(media.tipKeys[0]) : null

  const content = (
    <div
      className={cn(
        'mx-auto flex w-full max-w-2xl flex-col items-center px-3 text-center sm:px-4',
        props.compact ? 'gap-3 py-4' : 'gap-4 py-7 sm:gap-5 sm:py-10 md:py-14',
        props.className
      )}
    >
      <div className='relative'>
        {media && !shouldReduce && (
          <div
            className={cn(
              'pointer-events-none absolute -inset-5 rounded-full bg-gradient-to-br blur-2xl sm:-inset-6',
              media.accent,
              'generation-glow-pulse'
            )}
            aria-hidden='true'
          />
        )}
        <div
          className={cn(
            'relative flex items-center justify-center rounded-full',
            'bg-muted/50 ring-border/80 shadow-sm ring-1',
            props.compact ? 'size-16' : 'size-20 sm:size-24 md:size-28'
          )}
        >
          {Icon ? (
            <Icon
              className={cn(
                'text-foreground/80',
                props.compact ? 'size-9' : 'size-10 sm:size-12 md:size-14'
              )}
              aria-hidden='true'
            />
          ) : null}
        </div>
      </div>

      {!props.compact && (
        <div className='space-y-1.5 sm:space-y-2'>
          <p className='text-foreground text-base font-semibold tracking-tight sm:text-lg md:text-xl'>
            {title}
          </p>
          <p className='text-muted-foreground mx-auto max-w-md text-sm leading-relaxed text-pretty'>
            {description}
          </p>
        </div>
      )}

      {media && tip && !props.compact && (
        <div className='border-border/70 bg-muted/40 text-muted-foreground ring-foreground/5 flex max-w-md items-start gap-2 rounded-2xl border px-3.5 py-2.5 text-left text-xs leading-relaxed ring-1 ring-inset'>
          <Sparkles
            className='text-primary mt-0.5 size-3.5 shrink-0'
            aria-hidden='true'
          />
          <span className='text-pretty'>{tip}</span>
        </div>
      )}

      {!media && (
        <div className='border-border bg-muted/60 ring-foreground/5 max-h-40 overflow-y-auto rounded-2xl border px-4 py-3 text-left ring-1 ring-inset'>
          <p className='text-muted-foreground text-sm leading-relaxed text-pretty'>
            {description}
          </p>
        </div>
      )}
    </div>
  )

  if (shouldReduce) return content

  return (
    <motion.div
      initial={MOTION_VARIANTS.slideUp.initial}
      animate={MOTION_VARIANTS.slideUp.animate}
      transition={MOTION_TRANSITION.default}
    >
      {content}
    </motion.div>
  )
}
