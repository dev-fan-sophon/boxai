/*
Copyright (C) 2023-2026 QuantumNous

This program is free software: you can redistribute it and/or modify
it under the terms of the GNU Affero General Public License as
published by the Free Software Foundation, either version 3 of the
License, or (at your option) any later version.
*/
import { ChevronDown } from 'lucide-react'
import { useTranslation } from 'react-i18next'

import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from '@/components/ui/dropdown-menu'
import { cn } from '@/lib/utils'

import type { GroupOption, StudioModality, StudioSettings } from '../../types'

type ParameterChipsProps = {
  modality: Exclude<StudioModality, 'chat'>
  group: string
  groups: GroupOption[]
  onGroupChange: (group: string) => void
  settings: StudioSettings
  onSettingsChange: (settings: StudioSettings) => void
  className?: string
}

const IMAGE_SIZES = ['1024x1024', '1536x1024', '1024x1536'] as const
const IMAGE_QUALITIES = ['standard', 'hd'] as const
const IMAGE_COUNTS = [1, 2, 3, 4, 5, 6, 7, 8, 9, 10] as const
const VIDEO_SIZES = ['1280x720', '720x1280', '1920x1080'] as const
const VIDEO_DURATIONS = [1, 2, 3, 5, 8, 10, 15, 20, 30, 45, 60] as const
const VOICES = ['alloy', 'echo', 'fable', 'onyx', 'nova', 'shimmer'] as const
const SPEEDS = [0.75, 1, 1.25, 1.5] as const
const AUDIO_FORMATS = ['mp3', 'opus', 'aac', 'flac', 'wav'] as const

const WORKBENCH_MENU_CLASS =
  'max-h-64 overflow-y-auto border-border bg-popover text-popover-foreground'

export function ParameterChips(props: ParameterChipsProps) {
  const { t } = useTranslation()
  const update = <K extends keyof StudioSettings>(
    key: K,
    value: StudioSettings[K]
  ) => props.onSettingsChange({ ...props.settings, [key]: value })

  const activeGroup =
    props.groups.find((g) => g.value === props.group)?.label ?? props.group

  return (
    <div
      className={cn(
        'flex min-w-0 flex-wrap items-center gap-1.5',
        props.className
      )}
      role='group'
      aria-label={t('Generation parameters')}
    >
      <ChipMenu
        label={activeGroup || t('Channel')}
        ariaLabel={t('Channel')}
      >
        {props.groups.map((group) => (
          <DropdownMenuItem
            key={group.value}
            onClick={() => props.onGroupChange(group.value)}
          >
            <span className='font-medium'>{group.label}</span>
            {group.desc && (
              <span className='ml-2 text-xs text-muted-foreground'>{group.desc}</span>
            )}
          </DropdownMenuItem>
        ))}
        {props.groups.length === 0 && (
          <DropdownMenuItem disabled>{t('No groups')}</DropdownMenuItem>
        )}
      </ChipMenu>

      {props.modality === 'image' && (
        <>
          <ChipMenu
            label={`${props.settings.imageCount} ${t('count')}`}
            ariaLabel={t('Count')}
          >
            {IMAGE_COUNTS.map((n) => (
              <DropdownMenuItem
                key={n}
                onClick={() => update('imageCount', n)}
              >
                {n}
              </DropdownMenuItem>
            ))}
          </ChipMenu>
          <ChipMenu label={props.settings.imageSize} ariaLabel={t('Size')}>
            {IMAGE_SIZES.map((size) => (
              <DropdownMenuItem
                key={size}
                onClick={() => update('imageSize', size)}
              >
                {size}
              </DropdownMenuItem>
            ))}
          </ChipMenu>
          <ChipMenu
            label={t(
              props.settings.imageQuality === 'hd' ? 'HD' : 'Standard'
            )}
            ariaLabel={t('Quality')}
          >
            {IMAGE_QUALITIES.map((quality) => (
              <DropdownMenuItem
                key={quality}
                onClick={() => update('imageQuality', quality)}
              >
                {t(quality === 'hd' ? 'HD' : 'Standard')}
              </DropdownMenuItem>
            ))}
          </ChipMenu>
        </>
      )}

      {props.modality === 'video' && (
        <>
          <ChipMenu
            label={`${props.settings.videoDuration}s`}
            ariaLabel={t('Duration (seconds)')}
          >
            {VIDEO_DURATIONS.map((d) => (
              <DropdownMenuItem
                key={d}
                onClick={() => update('videoDuration', d)}
              >
                {d}s
              </DropdownMenuItem>
            ))}
          </ChipMenu>
          <ChipMenu
            label={videoSizeLabel(props.settings.videoSize)}
            ariaLabel={t('Size')}
          >
            {VIDEO_SIZES.map((size) => (
              <DropdownMenuItem
                key={size}
                onClick={() => update('videoSize', size)}
              >
                {videoSizeLabel(size)}
              </DropdownMenuItem>
            ))}
          </ChipMenu>
        </>
      )}

      {props.modality === 'audio' && (
        <>
          <ChipMenu label={props.settings.voice} ariaLabel={t('Voice')}>
            {VOICES.map((voice) => (
              <DropdownMenuItem
                key={voice}
                onClick={() => update('voice', voice)}
              >
                {voice}
              </DropdownMenuItem>
            ))}
          </ChipMenu>
          <ChipMenu
            label={`${props.settings.speed}×`}
            ariaLabel={t('Speed')}
          >
            {SPEEDS.map((speed) => (
              <DropdownMenuItem
                key={speed}
                onClick={() => update('speed', speed)}
              >
                {speed}×
              </DropdownMenuItem>
            ))}
          </ChipMenu>
          <ChipMenu
            label={props.settings.audioFormat}
            ariaLabel={t('Format')}
          >
            {AUDIO_FORMATS.map((format) => (
              <DropdownMenuItem
                key={format}
                onClick={() => update('audioFormat', format)}
              >
                {format}
              </DropdownMenuItem>
            ))}
          </ChipMenu>
        </>
      )}
    </div>
  )
}

function ChipMenu(props: {
  label: string
  ariaLabel: string
  children: React.ReactNode
}) {
  return (
    <DropdownMenu>
      <DropdownMenuTrigger
        render={
          <button
            type='button'
            aria-label={props.ariaLabel}
            className={cn(
              'inline-flex h-7 max-w-[9rem] items-center gap-1 truncate rounded-lg border border-border bg-muted/40 px-2 text-[11px] font-medium text-foreground/80',
              'outline-none hover:bg-muted hover:text-foreground focus-visible:ring-2 focus-visible:ring-ring'
            )}
          />
        }
      >
        <span className='truncate'>{props.label}</span>
        <ChevronDown className='size-3 shrink-0 opacity-60' aria-hidden='true' />
      </DropdownMenuTrigger>
      <DropdownMenuContent align='start' className={WORKBENCH_MENU_CLASS}>
        {props.children}
      </DropdownMenuContent>
    </DropdownMenu>
  )
}

function aspectFromSize(size: string): string {
  const [w, h] = size.split('x').map(Number)
  if (!w || !h) return size
  if (w === h) return '1:1'
  if (w > h) return '16:9'
  return '9:16'
}

function resolutionLabel(size: string): string {
  if (size.includes('1920') || size.includes('1080')) return '1080p'
  if (size.includes('1280') || size === '720x1280' || size.includes('720')) {
    return '720p'
  }
  return size
}

/** Combined aspect + resolution so landscape/portrait 720p stay distinct. */
function videoSizeLabel(size: string): string {
  return `${resolutionLabel(size)} · ${aspectFromSize(size)}`
}
