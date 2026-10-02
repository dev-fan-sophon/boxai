import { useEffect } from 'react'
import { useTranslation } from 'react-i18next'

import { Wand2 } from '@/components/icons'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { NativeSelect, NativeSelectOption } from '@/components/ui/native-select'
import { Textarea } from '@/components/ui/textarea'
import { useCreateStore } from '@/stores/create-store'

import { MAX_STORYBOARD_SCENES } from '../../constants'
import type { Storyboard } from '../../hooks/use-storyboard'
import { PanelSection } from '../panel/panel-section'

const SHOT_COUNTS = [2, 3, 4, 5, 6, 8, 10, 12].filter(
  (count) => count <= MAX_STORYBOARD_SCENES
)

/**
 * Left column in storyboard mode: the script and how to split it. A chat
 * model writes one prompt per scene; the scenes stay editable afterwards.
 */
export function StoryboardScriptPanel(props: {
  storyboard: Storyboard
  chatModels: string[]
}) {
  const { t } = useTranslation()
  const storyboard = props.storyboard
  const draft = storyboard.draft
  const storyboardModel = useCreateStore((state) => state.storyboardModel)
  const setStoryboardModel = useCreateStore((state) => state.setStoryboardModel)
  const firstChatModel = props.chatModels[0]

  // Default to the first chat model, and recover when the saved one is gone.
  useEffect(() => {
    if (!firstChatModel) return
    if (!storyboardModel || !props.chatModels.includes(storyboardModel)) {
      setStoryboardModel(firstChatModel)
    }
  }, [firstChatModel, props.chatModels, setStoryboardModel, storyboardModel])

  return (
    <>
      <PanelSection title={t('Script')}>
        <Textarea
          value={draft.script}
          onChange={(event) => storyboard.setScript(event.target.value)}
          placeholder={t(
            'Describe the story: characters, setting, what happens and the mood. Timestamps like 0–3s are welcome.'
          )}
          aria-label={t('Script')}
          className='bg-background min-h-44 resize-y rounded-xl text-sm leading-relaxed'
        />
      </PanelSection>

      <PanelSection title={t('Split into scenes')}>
        <div className='grid grid-cols-2 gap-2'>
          <div className='space-y-1.5'>
            <Label htmlFor='storyboard-shots' className='text-xs'>
              {t('Scenes')}
            </Label>
            <NativeSelect
              id='storyboard-shots'
              size='sm'
              className='w-full'
              value={String(draft.shotCount)}
              onChange={(event) =>
                storyboard.setShotCount(Number(event.target.value))
              }
            >
              {SHOT_COUNTS.map((count) => (
                <NativeSelectOption key={count} value={String(count)}>
                  {count}
                </NativeSelectOption>
              ))}
            </NativeSelect>
          </div>
          <div className='space-y-1.5'>
            <Label htmlFor='storyboard-model' className='text-xs'>
              {t('Writer model')}
            </Label>
            <NativeSelect
              id='storyboard-model'
              size='sm'
              className='w-full'
              value={storyboardModel}
              onChange={(event) => setStoryboardModel(event.target.value)}
            >
              {props.chatModels.length === 0 && (
                <NativeSelectOption value=''>
                  {t('No chat models')}
                </NativeSelectOption>
              )}
              {props.chatModels.map((model) => (
                <NativeSelectOption key={model} value={model}>
                  {model}
                </NativeSelectOption>
              ))}
            </NativeSelect>
          </div>
        </div>
        <div className='space-y-1.5'>
          <Label htmlFor='storyboard-style' className='text-xs'>
            {t('Visual style')}
          </Label>
          <Input
            id='storyboard-style'
            value={draft.style}
            onChange={(event) => storyboard.setStyle(event.target.value)}
            placeholder={t('e.g. cinematic, warm film grain, handheld')}
            className='h-8 text-sm'
          />
        </div>
        <Button
          variant='secondary'
          className='w-full gap-1.5'
          disabled={
            !draft.script.trim() ||
            !storyboardModel ||
            storyboard.split.isPending
          }
          onClick={() => storyboard.split.mutate()}
        >
          <Wand2
            className={
              storyboard.split.isPending ? 'size-4 animate-pulse' : 'size-4'
            }
            aria-hidden='true'
          />
          {storyboard.split.isPending
            ? t('Writing scenes…')
            : t('Split into {{count}} scenes', { count: draft.shotCount })}
        </Button>
        {draft.scenes.length > 0 && (
          <p className='text-muted-foreground text-2xs'>
            {t('Splitting again replaces the current scenes.')}
          </p>
        )}
      </PanelSection>
    </>
  )
}
