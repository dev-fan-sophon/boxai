import { useTranslation } from 'react-i18next'

import { Layers, Rows3, Sparkles } from '@/components/icons'
import { Button } from '@/components/ui/button'
import { ComposerShell } from '@/features/playground/components/composer/composer'
import { TogglePill } from '@/features/playground/components/composer/param-chip'
import { MAX_STUDIO_BATCH_JOBS } from '@/features/playground/lib/studio/batch-plan'
import type { VideoReferenceMode } from '@/features/playground/lib/studio/video-capabilities'
import type { PricingModel } from '@/features/pricing/types'
import { cn } from '@/lib/utils'
import { usePlaygroundStore } from '@/stores/playground-store'

import type { GenerationController } from '../../hooks/use-generation-controller'
import { seedanceReferenceVideoIssue } from '../../lib/reference-media-limits'
import { referenceRoleLabeler } from '../../lib/reference-roles'
import { AudioInputDropzone } from '../references/audio-input-dropzone'
import { ImageMaskButton } from '../references/image-mask-button'
import { MediaReferenceSlot } from '../references/media-reference-slot'
import { GenerationParamChips } from './generation-param-chips'
import { PriceHintBadge } from './price-hint'
import { PromptListEditor } from './prompt-list-editor'

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
  const canMultiPrompt = modality === 'image' || modality === 'video'

  const tools = (
    <div className='flex min-w-0 [scrollbar-width:none] items-center gap-1 overflow-x-auto py-0.5 [&::-webkit-scrollbar]:hidden'>
      {canMultiPrompt && (
        <TogglePill
          icon={<Rows3 />}
          label={t('Multiple prompts')}
          title={t('Write several prompts and generate them in one run')}
          active={draft.batchMode}
          onToggle={() => controller.setMultiPrompt(!draft.batchMode)}
        />
      )}
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
      {draft.maxReferenceVideos > 0 && (
        <MediaReferenceSlot
          label={t('Reference videos')}
          value={controller.referenceVideos}
          onChange={controller.setReferenceVideos}
          onUploadingChange={controller.setUploading}
          kind='video'
          validateFile={
            draft.videoCapabilities?.family.startsWith('seedance')
              ? seedanceReferenceVideoIssue
              : undefined
          }
          accept='video/*'
          maxFiles={draft.maxReferenceVideos}
        />
      )}
      {draft.maxReferenceAudios > 0 && (
        <MediaReferenceSlot
          label={t('Reference audio')}
          value={controller.referenceAudios}
          onChange={controller.setReferenceAudios}
          onUploadingChange={controller.setUploading}
          kind='audio'
          accept='audio/*'
          maxFiles={draft.maxReferenceAudios}
        />
      )}
      {draft.usesAudioInput && (
        <AudioInputDropzone
          compact
          value={controller.references}
          onChange={controller.setReferences}
        />
      )}
      <ImageMaskButton controller={controller} />
      {draft.canSwitchReferenceMode ? (
        <div
          className='bg-foreground/5 text-3xs flex shrink-0 rounded-full p-0.5 font-medium'
          role='radiogroup'
          aria-label={t('Reference mode')}
        >
          {(['frames', 'references'] as VideoReferenceMode[]).map((mode) => (
            <button
              key={mode}
              type='button'
              role='radio'
              aria-checked={draft.settings.videoReferenceMode === mode}
              className={cn(
                'rounded-full px-2 py-0.5 transition-colors',
                draft.settings.videoReferenceMode === mode
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
          ))}
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
        hasImage={draft.capabilityMode !== 'text'}
      />
      {draft.videoIssue || draft.audioIssue || draft.imageIssue ? (
        <span className='text-warning shrink-0 text-xs' aria-live='polite'>
          {draft.videoIssue ?? draft.audioIssue ?? draft.imageIssue}
        </span>
      ) : null}
    </div>
  )

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
      {draft.batchMode && canMultiPrompt ? (
        <div className='bg-card ring-border shadow-panel space-y-2.5 rounded-2xl p-2.5 ring-1'>
          <PromptListEditor
            compact
            rows={controller.promptRows}
            onChange={controller.setPromptRows}
            outputsPerPrompt={draft.outputsPerPrompt}
            unit={modality === 'video' ? 'video' : 'image'}
            onSubmit={controller.submit}
          />
          {tools}
          <div className='flex items-center gap-2'>
            <PriceHintBadge
              model={props.pricingModel}
              group={draft.group}
              groupRatio={draft.groupRatio}
              jobCount={draft.jobCount}
              estimateParams={draft.estimateParams}
            />
            <Button
              className='ms-auto'
              disabled={!draft.canSubmit}
              onClick={controller.submit}
            >
              <Sparkles aria-hidden='true' />
              {draft.submitLabel}
            </Button>
          </div>
        </div>
      ) : (
        <ComposerShell
          text={controller.text}
          onTextChange={controller.setText}
          onSubmit={controller.submit}
          placeholder={draft.placeholder}
          canSubmit={draft.canSubmit}
          submitLabel={draft.submitLabel}
          newlineOnEnter={draft.batchMode}
          tools={tools}
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
      )}
    </div>
  )
}
