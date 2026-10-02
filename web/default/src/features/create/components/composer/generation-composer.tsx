import { Layers } from 'lucide-react'
import { useTranslation } from 'react-i18next'

import type { PricingModel } from '@/features/pricing/types'
import { ComposerShell } from '@/features/playground/components/composer/composer'
import { MAX_STUDIO_BATCH_JOBS } from '@/features/playground/lib/studio/batch-plan'
import type { VideoReferenceMode } from '@/features/playground/lib/studio/video-capabilities'
import { cn } from '@/lib/utils'
import { usePlaygroundStore } from '@/stores/playground-store'

import type { GenerationController } from '../../hooks/use-generation-controller'
import type { GenerationDraft } from '../../hooks/use-generation-draft'
import { MediaReferenceSlot } from '../references/media-reference-slot'
import { GenerationParamChips } from './generation-param-chips'
import { PriceHintBadge } from './price-hint'

type GenerationComposerProps = {
  controller: GenerationController
  pricingModel?: PricingModel
}

/**
 * Compact composer for image/video/audio generation, docked under the feed
 * on small screens. The prompt box expands into a batch plan (lines ×
 * `{a|b}` variants × count) that is previewed live, so the send button and
 * the price hint always describe the whole batch. The prompt stays in the
 * box after sending so it can be tweaked and re-run.
 */
export function GenerationComposer(props: GenerationComposerProps) {
  const { t } = useTranslation()
  const controller = props.controller
  const draft = controller.draft
  const modality = controller.modality
  const setStudioSettings = usePlaygroundStore(
    (state) => state.setStudioSettings
  )
  const planSummary = draft.planSummary
  const plan = draft.plan

  return (
    <div className='playground-composer-dock mx-auto w-full max-w-4xl shrink-0 px-2 pt-2 pb-[max(0.5rem,env(safe-area-inset-bottom,0px))] sm:px-3 sm:py-3 md:px-3 md:py-3.5'>
      {(controller.activeJobs > 0 || planSummary || plan.truncated > 0) && (
        <div
          className='text-muted-foreground mb-2 flex flex-wrap items-center justify-center gap-x-3 gap-y-1 px-1 text-center text-xs'
          aria-live='polite'
        >
          {planSummary ? (
            <span className='text-foreground/80 inline-flex items-center gap-1 font-medium'>
              <Layers className='size-3.5' aria-hidden='true' />
              {planSummary}
            </span>
          ) : null}
          {plan.truncated > 0 ? (
            <span className='text-warning'>
              {t('{{count}} more skipped (max {{max}} per run)', {
                count: plan.truncated,
                max: MAX_STUDIO_BATCH_JOBS,
              })}
            </span>
          ) : null}
          {controller.activeJobs > 0 ? (
            <span>
              {t('{{count}} in progress — you can keep queuing', {
                count: controller.activeJobs,
              })}
            </span>
          ) : null}
        </div>
      )}
      <ComposerShell
        text={controller.text}
        onTextChange={controller.setText}
        onSubmit={controller.submit}
        placeholder={draft.placeholder}
        canSubmit={draft.canSubmit}
        submitLabel={draft.submitLabel}
        newlineOnEnter={draft.batchMode}
        tools={
          <div className='flex min-w-0 [scrollbar-width:none] items-center gap-1 overflow-x-auto py-0.5 [&::-webkit-scrollbar]:hidden'>
            {draft.showMediaSlot && (
              <MediaReferenceSlot
                label={draft.mediaLabel}
                value={controller.references}
                onChange={controller.setReferences}
                onUploadingChange={controller.setUploading}
                attachable
                kind='image'
                maxFiles={draft.maxFiles}
                roleForIndex={referenceRoleLabeler(draft, t)}
              />
            )}
            {draft.canSwitchReferenceMode ? (
              <div
                className='bg-foreground/5 text-3xs flex shrink-0 rounded-full p-0.5 font-medium'
                role='radiogroup'
                aria-label={t('Reference mode')}
              >
                {(['frames', 'references'] as VideoReferenceMode[]).map(
                  (mode) => (
                    <button
                      key={mode}
                      type='button'
                      role='radio'
                      aria-checked={draft.videoOptions?.referenceMode === mode}
                      className={cn(
                        'rounded-full px-2 py-0.5 transition-colors',
                        draft.videoOptions?.referenceMode === mode
                          ? 'bg-background text-foreground shadow-sm'
                          : 'text-muted-foreground hover:text-foreground'
                      )}
                      onClick={() =>
                        setStudioSettings((prev) => ({
                          ...prev,
                          videoReferenceMode: mode,
                        }))
                      }
                    >
                      {mode === 'frames' ? t('Frames') : t('References')}
                    </button>
                  )
                )}
              </div>
            ) : null}
            {draft.canToggleLastFrame ? (
              <label className='text-muted-foreground text-3xs flex shrink-0 items-center gap-1'>
                <input
                  type='checkbox'
                  className='size-3'
                  checked={!draft.settings.videoDisableLastFrame}
                  onChange={(event) =>
                    setStudioSettings((prev) => ({
                      ...prev,
                      videoDisableLastFrame: !event.target.checked,
                    }))
                  }
                />
                {t('Last frame')}
              </label>
            ) : null}
            <GenerationParamChips
              modality={modality}
              hasImage={controller.references.length > 0}
            />
            {draft.videoIssue ? (
              <span
                className='text-warning shrink-0 text-xs'
                aria-live='polite'
              >
                {draft.videoIssue}
              </span>
            ) : null}
          </div>
        }
        trailing={
          <PriceHintBadge
            model={props.pricingModel}
            group={draft.group}
            groupRatio={draft.groupRatio}
            jobCount={draft.jobCount}
            estimateParams={draft.estimateParams}
          />
        }
        className='px-0'
      />
    </div>
  )
}

/** Badge drawn on each reference thumbnail: frame role or reference index. */
export function referenceRoleLabeler(
  draft: GenerationDraft,
  t: (key: string) => string
): ((index: number) => string) | undefined {
  if (draft.estimateParams.modality !== 'video') return undefined
  return (index) => {
    if (draft.videoOptions?.referenceMode === 'references') {
      return `${index + 1}`
    }
    if (index === 0) return t('First')
    if (index === 1 && draft.usesLastFrame) return t('Last')
    return '—'
  }
}
