/*
Copyright (C) 2023-2026 QuantumNous

This program is free software: you can redistribute it and/or modify
it under the terms of the GNU Affero General Public License as
published by the Free Software Foundation, either version 3 of the
License, or (at your option) any later version.
*/
import type { UseMutationResult } from '@tanstack/react-query'
import { Download, Loader2 } from 'lucide-react'
import { useEffect, useState } from 'react'
import { useTranslation } from 'react-i18next'

import { Button } from '@/components/ui/button'
import type { PricingModel } from '@/features/pricing/types'

import type {
  GeneratedImage,
  GroupOption,
  StudioModality,
  StudioSettings,
  VideoSubmission,
} from '../../types'
import { GenerationDock } from '../workbench/generation-dock'
import type { MediaReference } from '../workbench/media-reference-slot'
import { ModelHero } from '../workbench/model-hero'

type GenerationWorkspaceProps = {
  modality: Exclude<StudioModality, 'chat'>
  model: string
  pricingModel?: PricingModel
  group: string
  groups: GroupOption[]
  onGroupChange: (group: string) => void
  settings: StudioSettings
  onSettingsChange: (settings: StudioSettings) => void
  canSubmit: () => boolean
  images: GeneratedImage[]
  video: VideoSubmission | null
  audioUrl: string
  imageMutation: UseMutationResult<
    GeneratedImage[],
    Error,
    {
      model: string
      group: string
      prompt: string
      settings: StudioSettings
      referenceImage?: string | null
      editMode?: boolean
    }
  >
  videoMutation: UseMutationResult<
    VideoSubmission,
    Error,
    {
      model: string
      group: string
      prompt: string
      settings: StudioSettings
      firstFrame?: string | null
      lastFrame?: string | null
      inputReference?: string | null
    }
  >
  audioMutation: UseMutationResult<
    Blob,
    Error,
    {
      model: string
      group: string
      text: string
      settings: StudioSettings
      voiceId?: string
    }
  >
  /** External prompt prefill (inspiration / agents) */
  prefillPrompt?: string
  onPrefillConsumed?: () => void
  onPromptUsed?: (prompt: string) => void
  onSaveWork?: (input: {
    title: string
    prompt: string
    modality: StudioModality
    model: string
    previewUrl?: string
  }) => void
}

export function GenerationWorkspace(props: GenerationWorkspaceProps) {
  const { t } = useTranslation()
  const [prompt, setPrompt] = useState('')
  const [reference, setReference] = useState<MediaReference | null>(null)

  const prefillPrompt = props.prefillPrompt
  const onPrefillConsumed = props.onPrefillConsumed
  useEffect(() => {
    if (prefillPrompt == null) return
    setPrompt(prefillPrompt)
    onPrefillConsumed?.()
  }, [prefillPrompt, onPrefillConsumed])

  useEffect(() => {
    setReference(null)
  }, [props.modality, props.model])

  let isPending = props.audioMutation.isPending
  let error = props.audioMutation.error
  if (props.modality === 'image') {
    isPending = props.imageMutation.isPending
    error = props.imageMutation.error
  } else if (props.modality === 'video') {
    isPending = props.videoMutation.isPending
    error = props.videoMutation.error
  }

  const hasOutput =
    (props.modality === 'image' && props.images.length > 0) ||
    (props.modality === 'video' && Boolean(props.video)) ||
    (props.modality === 'audio' && Boolean(props.audioUrl))

  const submit = () => {
    if (!prompt.trim() || !props.model) return
    if (!props.canSubmit()) return
    const settings = normalizeSettings(props.settings)
    props.onSettingsChange(settings)
    const trimmed = prompt.trim()
    props.onPromptUsed?.(trimmed)
    const refUrl = reference?.dataUrl || null
    const common = {
      model: props.model,
      group: props.group,
      settings,
    }
    if (props.modality === 'image') {
      props.imageMutation.mutate(
        {
          ...common,
          prompt: trimmed,
          referenceImage: refUrl,
          editMode: Boolean(refUrl),
        },
        {
          onSuccess: (images) => {
            props.onSaveWork?.({
              title: trimmed.slice(0, 48) || t('Untitled work'),
              prompt: trimmed,
              modality: 'image',
              model: props.model,
              previewUrl: images[0]?.url,
            })
          },
        }
      )
    } else if (props.modality === 'video') {
      props.videoMutation.mutate(
        {
          ...common,
          prompt: trimmed,
          firstFrame: refUrl,
          inputReference: refUrl,
        },
        {
          onSuccess: () => {
            props.onSaveWork?.({
              title: trimmed.slice(0, 48) || t('Untitled work'),
              prompt: trimmed,
              modality: 'video',
              model: props.model,
            })
          },
        }
      )
    } else {
      props.audioMutation.mutate(
        { ...common, text: trimmed },
        {
          onSuccess: () => {
            props.onSaveWork?.({
              title: trimmed.slice(0, 48) || t('Untitled work'),
              prompt: trimmed,
              modality: 'audio',
              model: props.model,
            })
          },
        }
      )
    }
  }

  return (
    <div className='relative flex min-h-0 flex-1 flex-col overflow-hidden'>
      <div className='min-h-0 flex-1 overflow-y-auto pb-40'>
        {!hasOutput && !isPending && !error && (
          <ModelHero
            model={props.pricingModel}
            modelName={props.model}
          />
        )}

        <div className='mx-auto w-full max-w-5xl px-4 pb-6 md:px-6'>
          <section
            className='flex min-h-[12rem] flex-col'
            aria-busy={isPending}
            aria-live='polite'
          >
            {props.modality === 'image' && props.images.length > 0 && (
              <div className='grid w-full grid-cols-1 gap-3 sm:grid-cols-2'>
                {props.images.map((image) => (
                  <figure
                    key={image.url}
                    className='overflow-hidden rounded-xl border border-white/10 bg-black/30'
                  >
                    <img
                      src={image.url}
                      alt={image.revisedPrompt || t('Generated image')}
                      className='aspect-square w-full object-cover'
                    />
                    {image.revisedPrompt && (
                      <figcaption className='p-2 text-xs text-pretty text-zinc-500'>
                        {image.revisedPrompt}
                      </figcaption>
                    )}
                  </figure>
                ))}
              </div>
            )}
            {props.modality === 'video' && props.video && (
              <div className='rounded-2xl border border-white/10 bg-white/[0.03] p-6 text-center'>
                <p className='font-medium text-zinc-100'>
                  {t('Video task submitted')}
                </p>
                <p className='mt-1 font-mono text-xs text-zinc-500'>
                  {props.video.taskId}
                </p>
                <p className='mt-2 text-sm text-pretty text-zinc-500'>
                  {t(
                    'Track progress in task history. The result link appears when processing finishes.'
                  )}
                </p>
              </div>
            )}
            {props.modality === 'audio' && props.audioUrl && (
              <div className='mx-auto w-full max-w-md space-y-3 rounded-2xl border border-white/10 bg-white/[0.03] p-5'>
                <audio controls className='w-full' src={props.audioUrl}>
                  {t('Your browser does not support audio playback.')}
                </audio>
                <Button
                  render={
                    <a
                      href={props.audioUrl}
                      download={`speech.${props.settings.audioFormat}`}
                    />
                  }
                  variant='outline'
                  size='sm'
                  className='border-white/15 bg-white/5 text-zinc-200'
                >
                  <Download className='size-4' />
                  {t('Download audio')}
                </Button>
              </div>
            )}
            {isPending && (
              <div className='flex items-center justify-center gap-2 py-16 text-sm text-zinc-400'>
                <Loader2 className='size-4 animate-spin text-cyan-400' />
                {t('Generating…')}
              </div>
            )}
            {error && (
              <div className='py-12 text-center' role='alert'>
                <p className='text-sm text-pretty text-red-400'>
                  {error.message || t('Generation failed.')}
                </p>
                <Button
                  className='mt-3 border-white/15 bg-white/5 text-zinc-200'
                  size='sm'
                  variant='outline'
                  onClick={submit}
                >
                  {t('Try again')}
                </Button>
              </div>
            )}
          </section>
        </div>
      </div>

      <GenerationDock
        modality={props.modality}
        model={props.model}
        pricingModel={props.pricingModel}
        group={props.group}
        groups={props.groups}
        onGroupChange={props.onGroupChange}
        settings={props.settings}
        onSettingsChange={props.onSettingsChange}
        prompt={prompt}
        onPromptChange={setPrompt}
        onSubmit={submit}
        isPending={isPending}
        reference={reference}
        onReferenceChange={setReference}
      />
    </div>
  )
}

function parseBoundedNumber(
  value: string,
  min: number,
  max: number,
  fallback: number
): number {
  const parsed = Number(value)
  if (!Number.isFinite(parsed)) return fallback
  return Math.min(max, Math.max(min, parsed))
}

function normalizeSettings(settings: StudioSettings): StudioSettings {
  return {
    ...settings,
    imageCount: parseBoundedNumber(String(settings.imageCount), 1, 10, 1),
    videoDuration: parseBoundedNumber(String(settings.videoDuration), 1, 60, 5),
    speed: parseBoundedNumber(String(settings.speed), 0.25, 4, 1),
  }
}
