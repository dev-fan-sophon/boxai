/*
Copyright (C) 2023-2026 QuantumNous

This program is free software: you can redistribute it and/or modify
it under the terms of the GNU Affero General Public License as
published by the Free Software Foundation, either version 3 of the
License, or (at your option) any later version.
*/
import { Download, Loader2 } from 'lucide-react'
import { useState } from 'react'
import { useTranslation } from 'react-i18next'

import { Button } from '@/components/ui/button'
import type { PricingModel } from '@/features/pricing/types'
import { usePlaygroundStore } from '@/stores/playground-store'

import type { UseStudioResult } from '../../hooks/use-studio'
import { useVideoTaskResult } from '../../hooks/use-video-task-result'
import type { StudioModality } from '../../types'
import type { MediaReference } from '../composer/attachments/media-reference-slot'
import { GenerationComposer } from '../composer/generation-composer'
import { ModelHero } from './model-hero'

type GenerationWorkspaceProps = {
  modality: Exclude<StudioModality, 'chat'>
  pricingModel?: PricingModel
  canSubmit: () => boolean
  studio: UseStudioResult
}

/**
 * Generation workspace: result gallery in normal flow with the generation
 * composer docked at the bottom of the column (no floating overlay).
 * Model, group and settings come from the shared store; mutations and
 * transient results come from `useStudio` via the `studio` bundle.
 */
export function GenerationWorkspace(props: GenerationWorkspaceProps) {
  const { t } = useTranslation()
  const { studio } = props
  const [reference, setReference] = useState<MediaReference | null>(null)
  const [referenceKey, setReferenceKey] = useState('')

  const model = usePlaygroundStore((state) => state.config.model)
  const group = usePlaygroundStore((state) => state.config.group)
  const addRecentPrompt = usePlaygroundStore((state) => state.addRecentPrompt)
  const addMyWork = usePlaygroundStore((state) => state.addMyWork)

  // Reset the media reference when the modality or model changes.
  const currentKey = `${props.modality}:${model}`
  if (referenceKey !== currentKey) {
    setReferenceKey(currentKey)
    setReference(null)
  }

  const videoTask = useVideoTaskResult(
    studio.video?.taskId,
    props.modality === 'video' && Boolean(studio.video)
  )

  let isPending = studio.audioMutation.isPending
  let error = studio.audioMutation.error
  if (props.modality === 'image') {
    isPending = studio.imageMutation.isPending
    error = studio.imageMutation.error
  } else if (props.modality === 'video') {
    isPending = studio.videoMutation.isPending
    error = studio.videoMutation.error
  }

  const hasOutput =
    (props.modality === 'image' && studio.images.length > 0) ||
    (props.modality === 'video' && Boolean(studio.video)) ||
    (props.modality === 'audio' && Boolean(studio.audioUrl))

  const [lastPrompt, setLastPrompt] = useState('')

  const submit = (prompt: string) => {
    if (!prompt || !model) return
    if (!props.canSubmit()) return
    setLastPrompt(prompt)
    const settings = usePlaygroundStore.getState().studioSettings
    addRecentPrompt({ prompt, modality: props.modality, model })
    const refUrl = reference?.dataUrl || null
    const common = { model, group, settings }
    const workTitle = prompt.slice(0, 48) || t('Untitled work')
    if (props.modality === 'image') {
      studio.imageMutation.mutate(
        {
          ...common,
          prompt,
          referenceImage: refUrl,
          editMode: Boolean(refUrl),
        },
        {
          onSuccess: (images) => {
            addMyWork({
              title: workTitle,
              prompt,
              modality: 'image',
              model,
              previewUrl: images[0]?.url,
            })
          },
        }
      )
    } else if (props.modality === 'video') {
      studio.videoMutation.mutate(
        {
          ...common,
          prompt,
          firstFrame: refUrl,
          inputReference: refUrl,
        },
        {
          onSuccess: () => {
            addMyWork({ title: workTitle, prompt, modality: 'video', model })
          },
        }
      )
    } else {
      studio.audioMutation.mutate(
        { ...common, text: prompt },
        {
          onSuccess: () => {
            addMyWork({ title: workTitle, prompt, modality: 'audio', model })
          },
        }
      )
    }
  }

  return (
    <div className='relative flex min-h-0 flex-1 flex-col overflow-hidden'>
      <div className='min-h-0 flex-1 overflow-y-auto'>
        {!hasOutput && !isPending && !error && (
          <ModelHero model={props.pricingModel} modelName={model} />
        )}

        <div className='mx-auto w-full max-w-5xl px-4 pb-6 md:px-6'>
          <section
            className='flex min-h-[12rem] flex-col'
            aria-busy={isPending}
            aria-live='polite'
          >
            {props.modality === 'image' && studio.images.length > 0 && (
              <div className='grid w-full grid-cols-1 gap-3 sm:grid-cols-2'>
                {studio.images.map((image) => (
                  <figure
                    key={image.url}
                    className='border-border bg-muted/60 overflow-hidden rounded-xl border'
                  >
                    <img
                      src={image.url}
                      alt={image.revisedPrompt || t('Generated image')}
                      className='aspect-square w-full object-cover'
                    />
                    {image.revisedPrompt && (
                      <figcaption className='text-muted-foreground p-2 text-xs text-pretty'>
                        {image.revisedPrompt}
                      </figcaption>
                    )}
                  </figure>
                ))}
              </div>
            )}
            {props.modality === 'video' && studio.video && videoTask.ready && (
              <div className='mx-auto w-full max-w-3xl space-y-3'>
                <video
                  controls
                  className='border-border w-full rounded-2xl border bg-black'
                  src={videoTask.resultUrl}
                >
                  {t('Your browser does not support video playback.')}
                </video>
                <Button
                  render={
                    <a
                      href={videoTask.resultUrl}
                      download={`video-${studio.video.taskId}.mp4`}
                    />
                  }
                  variant='outline'
                  size='sm'
                  className='border-border bg-muted/50 text-foreground'
                >
                  <Download className='size-4' />
                  {t('Download video')}
                </Button>
              </div>
            )}
            {props.modality === 'video' &&
              studio.video &&
              !videoTask.ready &&
              !videoTask.failed && (
                <div className='border-border bg-muted/40 rounded-2xl border p-6 text-center'>
                  <p className='text-foreground font-medium'>
                    {t('Video task submitted')}
                  </p>
                  <p className='text-muted-foreground mt-1 font-mono text-xs'>
                    {studio.video.taskId}
                  </p>
                  <p className='text-muted-foreground mt-2 text-sm text-pretty'>
                    {t(
                      'Rendering your video. It will play here automatically when ready.'
                    )}
                  </p>
                  {videoTask.percent !== null && videoTask.percent > 0 && (
                    <div className='bg-muted mx-auto mt-4 h-1.5 w-full max-w-sm overflow-hidden rounded-full'>
                      <div
                        className='bg-primary h-full rounded-full transition-all'
                        style={{ width: `${videoTask.percent}%` }}
                      />
                    </div>
                  )}
                </div>
              )}
            {props.modality === 'video' && studio.video && videoTask.failed && (
              <div className='border-destructive/40 bg-destructive/5 rounded-2xl border p-6 text-center'>
                <p className='text-foreground font-medium'>
                  {t('Video generation failed.')}
                </p>
                {videoTask.failReason && (
                  <p className='text-destructive mt-2 text-xs text-pretty'>
                    {videoTask.failReason}
                  </p>
                )}
              </div>
            )}
            {props.modality === 'audio' && studio.audioUrl && (
              <div className='border-border bg-muted/40 mx-auto w-full max-w-md space-y-3 rounded-2xl border p-5'>
                <audio controls className='w-full' src={studio.audioUrl}>
                  {t('Your browser does not support audio playback.')}
                </audio>
                <Button
                  render={
                    <a
                      href={studio.audioUrl}
                      download={`speech.${studio.settings.audioFormat}`}
                    />
                  }
                  variant='outline'
                  size='sm'
                  className='border-border bg-muted/50 text-foreground'
                >
                  <Download className='size-4' />
                  {t('Download audio')}
                </Button>
              </div>
            )}
            {isPending && (
              <div className='text-muted-foreground flex items-center justify-center gap-2 py-16 text-sm'>
                <Loader2 className='text-primary size-4 animate-spin' />
                {t('Generating…')}
              </div>
            )}
            {error && (
              <div className='py-12 text-center' role='alert'>
                <p className='text-sm text-pretty text-red-400'>
                  {error.message || t('Generation failed.')}
                </p>
                <Button
                  className='border-border bg-muted/50 text-foreground mt-3'
                  size='sm'
                  variant='outline'
                  onClick={() => submit(lastPrompt)}
                  disabled={!lastPrompt}
                >
                  {t('Try again')}
                </Button>
              </div>
            )}
          </section>
        </div>
      </div>

      <GenerationComposer
        modality={props.modality}
        pricingModel={props.pricingModel}
        isPending={isPending}
        reference={reference}
        onReferenceChange={setReference}
        onSubmit={submit}
      />
    </div>
  )
}
