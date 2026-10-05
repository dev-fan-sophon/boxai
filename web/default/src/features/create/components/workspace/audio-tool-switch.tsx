import { useTranslation } from 'react-i18next'

import {
  AudioLines,
  AudioWaveform,
  Captions,
  Music,
  Speech,
  TextCursorInput,
  Wand2,
  type IconComponent,
} from '@/components/icons'
import type { AudioKind } from '@/features/playground/lib/studio/model-modality'
import { cn } from '@/lib/utils'

import { AUDIO_TOOL_LABEL_KEYS } from '../../hooks/use-audio-tool'

const PRIMARY_TOOLS: Array<{ value: AudioKind; Icon: IconComponent }> = [
  { value: 'speech', Icon: Speech },
  { value: 'sfx', Icon: Wand2 },
  { value: 'music', Icon: Music },
  { value: 'transcribe', Icon: Captions },
  { value: 'voice-changer', Icon: AudioLines },
  { value: 'isolate', Icon: AudioWaveform },
]

/**
 * Audio sub-tool picker of /studio/audio: a radio grid of the six everyday
 * tools plus forced alignment as an advanced extra. Tools without a model
 * the user can call are disabled rather than hidden, so the layout is stable.
 */
export function AudioToolSwitch(props: {
  value: AudioKind
  availableKinds: ReadonlySet<AudioKind>
  onValueChange: (tool: AudioKind) => void
}) {
  const { t } = useTranslation()
  const showAlign = props.availableKinds.has('align') || props.value === 'align'

  return (
    <div className='space-y-1.5'>
      <div
        role='radiogroup'
        aria-label={t('Audio tool')}
        className='grid grid-cols-3 gap-1'
      >
        {PRIMARY_TOOLS.map((tool) => {
          const checked = props.value === tool.value
          const available = props.availableKinds.has(tool.value)
          return (
            <button
              key={tool.value}
              type='button'
              role='radio'
              aria-checked={checked}
              disabled={!available && !checked}
              title={available ? undefined : t('No model available')}
              onClick={() => props.onValueChange(tool.value)}
              className={cn(
                'border-border/70 text-muted-foreground transition-ui duration-control focus-visible:ring-ring flex h-14 flex-col items-center justify-center gap-1 rounded-lg border px-1 text-center outline-none focus-visible:ring-2 disabled:cursor-not-allowed disabled:opacity-45',
                checked
                  ? 'border-primary/50 bg-primary/10 text-foreground'
                  : 'hover:bg-muted/60 hover:text-foreground'
              )}
            >
              <tool.Icon
                className={cn('size-4', checked && 'text-primary')}
                aria-hidden='true'
              />
              <span className='text-2xs leading-tight font-medium'>
                {t(AUDIO_TOOL_LABEL_KEYS[tool.value])}
              </span>
            </button>
          )
        })}
      </div>
      {showAlign && (
        <button
          type='button'
          aria-pressed={props.value === 'align'}
          onClick={() =>
            props.onValueChange(props.value === 'align' ? 'speech' : 'align')
          }
          className={cn(
            'text-2xs transition-ui duration-control focus-visible:ring-ring inline-flex items-center gap-1 rounded-md px-1.5 py-0.5 outline-none focus-visible:ring-2',
            props.value === 'align'
              ? 'text-primary font-semibold'
              : 'text-muted-foreground hover:text-foreground'
          )}
        >
          <TextCursorInput className='size-3' aria-hidden='true' />
          {t('Advanced: align a script to audio')}
        </button>
      )}
    </div>
  )
}
