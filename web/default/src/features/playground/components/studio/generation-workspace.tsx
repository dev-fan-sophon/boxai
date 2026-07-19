/*
Copyright (C) 2023-2026 QuantumNous

This program is free software: you can redistribute it and/or modify
it under the terms of the GNU Affero General Public License as
published by the Free Software Foundation, either version 3 of the
License, or (at your option) any later version.
*/
import type { UseMutationResult } from '@tanstack/react-query'
import { Download, Loader2, Send } from 'lucide-react'
import { useState } from 'react'
import { useTranslation } from 'react-i18next'

import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { NativeSelect, NativeSelectOption } from '@/components/ui/native-select'
import { Textarea } from '@/components/ui/textarea'

import type {
  GeneratedImage,
  GroupOption,
  StudioModality,
  StudioSettings,
  VideoSubmission,
} from '../../types'

type GenerationWorkspaceProps = {
  modality: Exclude<StudioModality, 'chat'>
  model: string
  group: string
  groups: GroupOption[]
  onGroupChange: (group: string) => void
  settings: StudioSettings
  onSettingsChange: (settings: StudioSettings) => void
  images: GeneratedImage[]
  video: VideoSubmission | null
  audioUrl: string
  imageMutation: UseMutationResult<
    GeneratedImage[],
    Error,
    { model: string; group: string; prompt: string; settings: StudioSettings }
  >
  videoMutation: UseMutationResult<
    VideoSubmission,
    Error,
    { model: string; group: string; prompt: string; settings: StudioSettings }
  >
  audioMutation: UseMutationResult<
    Blob,
    Error,
    { model: string; group: string; text: string; settings: StudioSettings }
  >
}

export function GenerationWorkspace(props: GenerationWorkspaceProps) {
  const { t } = useTranslation()
  const [prompt, setPrompt] = useState('')
  let isPending = props.audioMutation.isPending
  let error = props.audioMutation.error
  let title = 'Create speech'
  let action = 'Generate speech'
  if (props.modality === 'image') {
    isPending = props.imageMutation.isPending
    error = props.imageMutation.error
    title = 'Create images'
    action = 'Generate images'
  } else if (props.modality === 'video') {
    isPending = props.videoMutation.isPending
    error = props.videoMutation.error
    title = 'Create a video'
    action = 'Submit video'
  }
  const submit = () => {
    if (!prompt.trim() || !props.model) return
    const common = {
      model: props.model,
      group: props.group,
      settings: props.settings,
    }
    if (props.modality === 'image') {
      props.imageMutation.mutate({ ...common, prompt: prompt.trim() })
    } else if (props.modality === 'video') {
      props.videoMutation.mutate({ ...common, prompt: prompt.trim() })
    } else {
      props.audioMutation.mutate({ ...common, text: prompt.trim() })
    }
  }

  return (
    <div className='flex min-h-0 flex-1 flex-col overflow-y-auto'>
      <div className='mx-auto flex w-full max-w-5xl flex-1 flex-col gap-6 p-4 md:p-8'>
        <div>
          <p className='text-primary text-xs font-medium'>
            {t('Multimodal workspace')}
          </p>
          <h1 className='text-2xl font-semibold text-balance'>{t(title)}</h1>
          <p className='text-muted-foreground mt-1 text-sm text-pretty'>
            {t(
              'Describe the result, tune the run, and review output in one place.'
            )}
          </p>
        </div>
        <div className='grid flex-1 gap-6 lg:grid-cols-[minmax(0,1fr)_260px]'>
          <section className='bg-muted/10 flex min-h-72 flex-col rounded-xl border p-4'>
            <h2 className='text-sm font-medium text-balance'>{t('Output')}</h2>
            <div className='grid flex-1 place-items-center py-6'>
              {props.modality === 'image' && props.images.length > 0 && (
                <div className='grid w-full grid-cols-1 gap-3 sm:grid-cols-2'>
                  {props.images.map((image) => (
                    <figure
                      key={image.url}
                      className='bg-background overflow-hidden rounded-lg border'
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
              {props.modality === 'video' && props.video && (
                <div className='text-center'>
                  <p className='font-medium'>{t('Video task submitted')}</p>
                  <p className='text-muted-foreground mt-1 font-mono text-xs'>
                    {props.video.taskId}
                  </p>
                  <p className='text-muted-foreground mt-2 text-sm text-pretty'>
                    {t(
                      'Track progress in task history. The result link appears when processing finishes.'
                    )}
                  </p>
                </div>
              )}
              {props.modality === 'audio' && props.audioUrl && (
                <div className='w-full max-w-md space-y-3'>
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
                  >
                    <Download className='size-4' />
                    {t('Download audio')}
                  </Button>
                </div>
              )}
              {!isPending &&
                !error &&
                ((props.modality === 'image' && !props.images.length) ||
                  (props.modality === 'video' && !props.video) ||
                  (props.modality === 'audio' && !props.audioUrl)) && (
                  <p className='text-muted-foreground text-center text-sm text-pretty'>
                    {t('Your generated result will appear here.')}
                  </p>
                )}
              {isPending && (
                <div className='text-muted-foreground flex items-center gap-2 text-sm'>
                  <Loader2 className='size-4 animate-spin' />
                  {t('Generating…')}
                </div>
              )}
              {error && (
                <div className='text-center'>
                  <p className='text-destructive text-sm text-pretty'>
                    {error.message || t('Generation failed.')}
                  </p>
                  <Button
                    className='mt-3'
                    size='sm'
                    variant='outline'
                    onClick={submit}
                  >
                    {t('Try again')}
                  </Button>
                </div>
              )}
            </div>
          </section>
          <Settings
            modality={props.modality}
            group={props.group}
            groups={props.groups}
            onGroupChange={props.onGroupChange}
            settings={props.settings}
            onChange={props.onSettingsChange}
          />
        </div>
        <section className='bg-background rounded-xl border p-3'>
          <Label htmlFor='studio-prompt'>
            {props.modality === 'audio' ? t('Speech text') : t('Prompt')}
          </Label>
          <Textarea
            id='studio-prompt'
            value={prompt}
            onChange={(event) => setPrompt(event.target.value)}
            className='mt-2 min-h-24 resize-none border-0 px-0 shadow-none focus-visible:ring-0'
            placeholder={t(
              props.modality === 'audio'
                ? 'Enter the text to speak…'
                : 'Describe what you want to create…'
            )}
          />
          <div className='flex justify-end border-t pt-3'>
            <Button
              onClick={submit}
              disabled={!prompt.trim() || !props.model || isPending}
            >
              {isPending ? (
                <Loader2 className='size-4 animate-spin' />
              ) : (
                <Send className='size-4' />
              )}
              {t(action)}
            </Button>
          </div>
        </section>
      </div>
    </div>
  )
}

function Settings(props: {
  modality: Exclude<StudioModality, 'chat'>
  group: string
  groups: GroupOption[]
  onGroupChange: (group: string) => void
  settings: StudioSettings
  onChange: (settings: StudioSettings) => void
}) {
  const { t } = useTranslation()
  const update = <K extends keyof StudioSettings>(
    key: K,
    value: StudioSettings[K]
  ) => props.onChange({ ...props.settings, [key]: value })
  return (
    <aside className='bg-background space-y-4 rounded-xl border p-4'>
      <h2 className='text-sm font-medium text-balance'>{t('Run settings')}</h2>
      <Field label={t('Group')}>
        <NativeSelect
          className='w-full'
          value={props.group}
          onChange={(event) => props.onGroupChange(event.target.value)}
        >
          {props.groups.map((group) => (
            <NativeSelectOption key={group.value} value={group.value}>
              {group.label}
            </NativeSelectOption>
          ))}
        </NativeSelect>
      </Field>
      {props.modality === 'image' && (
        <>
          <Field label={t('Count')}>
            <Input
              type='number'
              min={1}
              max={10}
              value={props.settings.imageCount}
              onChange={(event) =>
                update('imageCount', Number(event.target.value))
              }
            />
          </Field>
          <SelectField
            label={t('Size')}
            value={props.settings.imageSize}
            values={['1024x1024', '1536x1024', '1024x1536']}
            onChange={(value) => update('imageSize', value)}
          />
          <SelectField
            label={t('Quality')}
            value={props.settings.imageQuality}
            values={['standard', 'hd']}
            onChange={(value) => update('imageQuality', value)}
          />
        </>
      )}
      {props.modality === 'video' && (
        <>
          <Field label={t('Duration (seconds)')}>
            <Input
              type='number'
              min={1}
              max={60}
              value={props.settings.videoDuration}
              onChange={(event) =>
                update('videoDuration', Number(event.target.value))
              }
            />
          </Field>
          <SelectField
            label={t('Size')}
            value={props.settings.videoSize}
            values={['1280x720', '720x1280', '1920x1080']}
            onChange={(value) => update('videoSize', value)}
          />
        </>
      )}
      {props.modality === 'audio' && (
        <>
          <SelectField
            label={t('Voice')}
            value={props.settings.voice}
            values={['alloy', 'echo', 'fable', 'onyx', 'nova', 'shimmer']}
            onChange={(value) => update('voice', value)}
          />
          <Field label={t('Speed')}>
            <Input
              type='number'
              min={0.25}
              max={4}
              step={0.05}
              value={props.settings.speed}
              onChange={(event) => update('speed', Number(event.target.value))}
            />
          </Field>
          <SelectField
            label={t('Format')}
            value={props.settings.audioFormat}
            values={['mp3', 'opus', 'aac', 'flac', 'wav']}
            onChange={(value) => update('audioFormat', value)}
          />
        </>
      )}
    </aside>
  )
}

function Field(props: { label: string; children: React.ReactNode }) {
  return (
    <div className='space-y-1.5'>
      <Label>{props.label}</Label>
      {props.children}
    </div>
  )
}
function SelectField(props: {
  label: string
  value: string
  values: string[]
  onChange: (value: string) => void
}) {
  return (
    <Field label={props.label}>
      <NativeSelect
        className='w-full'
        value={props.value}
        onChange={(event) => props.onChange(event.target.value)}
      >
        {props.values.map((value) => (
          <NativeSelectOption key={value} value={value}>
            {value}
          </NativeSelectOption>
        ))}
      </NativeSelect>
    </Field>
  )
}
