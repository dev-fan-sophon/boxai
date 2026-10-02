import { Link2, LayoutPanelTop, Plus, Square } from 'lucide-react'
import { AnimatePresence, motion } from 'motion/react'
import { useTranslation } from 'react-i18next'

import { Button } from '@/components/ui/button'
import { Checkbox } from '@/components/ui/checkbox'
import { Switch } from '@/components/ui/switch'
import { MOTION_VARIANTS, MOTION_TRANSITION } from '@/lib/motion'

import { MAX_STORYBOARD_SCENES } from '../../constants'
import type { Storyboard } from '../../hooks/use-storyboard'
import type { UseStudioResult } from '../../hooks/use-studio'
import { SceneCard } from './scene-card'

/** Scene grid of the storyboard mode, with selection across scenes. */
export function StoryboardBoard(props: {
  storyboard: Storyboard
  studio: UseStudioResult
}) {
  const { t } = useTranslation()
  const storyboard = props.storyboard
  const scenes = storyboard.draft.scenes
  const allSelected =
    scenes.length > 0 && scenes.every((scene) => scene.selected)
  const failed = scenes.filter((scene) =>
    storyboard.progress
      .get(scene.id)
      ?.pending.some((job) => job.status === 'error')
  ).length

  if (scenes.length === 0) {
    return (
      <div className='flex min-h-[60vh] flex-col items-center justify-center gap-4 px-6 text-center'>
        <span className='bg-primary/10 text-primary flex size-14 items-center justify-center rounded-2xl'>
          <LayoutPanelTop className='size-6' aria-hidden='true' />
        </span>
        <div className='max-w-md space-y-1.5'>
          <h2 className='text-foreground text-lg font-semibold'>
            {t('Build a storyboard')}
          </h2>
          <p className='text-muted-foreground text-sm text-pretty'>
            {t(
              'Write a script on the left and split it into scenes, or add scenes yourself. Each scene becomes one video clip with its own first frame and prompt.'
            )}
          </p>
        </div>
        <Button
          variant='outline'
          className='gap-1.5'
          onClick={storyboard.addScene}
        >
          <Plus className='size-4' aria-hidden='true' />
          {t('Add a scene')}
        </Button>
      </div>
    )
  }

  return (
    <div className='mx-auto w-full max-w-7xl space-y-4 px-3 pt-4 pb-10 sm:px-5'>
      <div className='flex flex-wrap items-center gap-x-4 gap-y-2'>
        <label className='text-foreground flex items-center gap-2 text-sm font-medium'>
          <Checkbox
            checked={allSelected}
            onCheckedChange={(checked) => storyboard.setAllSelected(checked)}
          />
          {t('Select all')}
        </label>
        <span className='text-muted-foreground text-sm'>
          {t('{{selected}} of {{total}} scenes selected', {
            selected: storyboard.selected.length,
            total: scenes.length,
          })}
        </span>
        <span className='ml-auto' />
        {storyboard.chain ? (
          <span
            className='text-muted-foreground flex items-center gap-2 text-sm'
            aria-live='polite'
          >
            <Link2 className='size-3.5' aria-hidden='true' />
            {t('Chaining scenes: {{done}} of {{total}} started', {
              done: storyboard.chain.done,
              total: storyboard.chain.total,
            })}
            <Button
              variant='ghost'
              size='sm'
              className='h-7 gap-1 px-2'
              onClick={storyboard.stopChain}
            >
              <Square className='size-3' aria-hidden='true' />
              {t('Stop')}
            </Button>
          </span>
        ) : null}
        {storyboard.canChain && !storyboard.chain ? (
          <label
            className='text-foreground flex items-center gap-2 text-sm'
            title={t(
              'Each scene waits for the previous one and starts from its last frame. Scenes with their own first frame keep it.'
            )}
          >
            <Switch
              size='sm'
              checked={storyboard.draft.chainScenes === true}
              onCheckedChange={storyboard.setChainScenes}
            />
            {t('Chain scenes')}
          </label>
        ) : null}
        <Button
          variant='outline'
          size='sm'
          className='gap-1.5'
          disabled={!storyboard.canAddScene}
          onClick={storyboard.addScene}
          title={
            storyboard.canAddScene
              ? undefined
              : t('Up to {{count}} scenes', { count: MAX_STORYBOARD_SCENES })
          }
        >
          <Plus className='size-3.5' aria-hidden='true' />
          {t('Add a scene')}
        </Button>
      </div>

      <AnimatePresence initial={false}>
        {failed > 0 && (
          <motion.div
            key='failed'
            {...MOTION_VARIANTS.slideUp}
            transition={MOTION_TRANSITION.default}
            role='alert'
            className='border-destructive/30 bg-destructive/5 text-destructive rounded-xl border px-3 py-2 text-sm'
          >
            {t('{{count}} scenes failed. Retry them from their cards.', {
              count: failed,
            })}
          </motion.div>
        )}
      </AnimatePresence>

      <div className='grid grid-cols-[repeat(auto-fill,minmax(17rem,1fr))] gap-3'>
        <AnimatePresence initial={false}>
          {scenes.map((scene, index) => (
            <SceneCard
              key={scene.id}
              scene={scene}
              index={index}
              total={scenes.length}
              progress={storyboard.progress.get(scene.id)}
              onChange={(value) => storyboard.updateScene(scene.id, value)}
              onRemove={() => storyboard.removeScene(scene.id)}
              onMove={(delta) => storyboard.moveScene(scene.id, delta)}
              onGenerate={() => void storyboard.generate([scene])}
              onRetry={props.studio.retryRuns}
              onCancel={props.studio.cancelQueued}
              onDismiss={props.studio.dismissRuns}
            />
          ))}
        </AnimatePresence>
      </div>
    </div>
  )
}
