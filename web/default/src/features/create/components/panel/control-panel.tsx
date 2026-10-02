import { Link } from '@tanstack/react-router'
import { AlertTriangle, ChevronDown, Layers, Sparkles } from 'lucide-react'
import { useTranslation } from 'react-i18next'

import { Button } from '@/components/ui/button'
import {
  Collapsible,
  CollapsibleContent,
  CollapsibleTrigger,
} from '@/components/ui/collapsible'
import { Label } from '@/components/ui/label'
import { NativeSelect, NativeSelectOption } from '@/components/ui/native-select'
import { SegmentedControl } from '@/components/ui/segmented-control'
import { Switch } from '@/components/ui/switch'
import { Textarea } from '@/components/ui/textarea'
import { MAX_STUDIO_BATCH_JOBS } from '@/features/playground/lib/studio/batch-plan'
import type { VideoReferenceMode } from '@/features/playground/lib/studio/video-capabilities'
import type { PricingModel } from '@/features/pricing/types'
import { cn } from '@/lib/utils'
import { usePlaygroundStore } from '@/stores/playground-store'

import {
  useBalanceShortfall,
  useCostEstimate,
} from '../../hooks/use-cost-estimate'
import type { GenerationController } from '../../hooks/use-generation-controller'
import { seedanceReferenceVideoIssue } from '../../lib/reference-media-limits'
import { referenceRoleLabeler } from '../../lib/reference-roles'
import { PriceHintBadge } from '../composer/price-hint'
import { AudioInputDropzone } from '../references/audio-input-dropzone'
import { ImageMaskButton } from '../references/image-mask-button'
import { MediaReferenceSlot } from '../references/media-reference-slot'
import { GenerationSettingsSection } from '../settings/generation-settings-section'
import { PanelSection } from './panel-section'

/**
 * Desktop control column of a creation tool. Reads top to bottom in the
 * order a run is built — prompt, references, parameters — and keeps the
 * cost and the Generate action pinned at the bottom so they are always in
 * view while the prompt grows.
 */
export function ControlPanel(props: {
  controller: GenerationController
  pricingModel?: PricingModel
  modelPicker: React.ReactNode
  modeSwitch?: React.ReactNode
  /** Called after Generate queued work, e.g. to close the mobile sheet. */
  onGenerated?: () => void
  /**
   * Storyboard mode swaps the prompt and references for the script panel and
   * turns Generate into "generate the selected scenes".
   */
  storyboard?: {
    panel: React.ReactNode
    sceneCount: number
    onGenerate: () => void
  }
}) {
  const { t } = useTranslation()
  const controller = props.controller
  const draft = controller.draft
  const modality = controller.modality

  return (
    <div className='flex h-full min-h-0 flex-col'>
      <div className='min-h-0 flex-1 space-y-5 overflow-y-auto overscroll-contain px-4 pt-4 pb-6'>
        <PanelSection title={t('Model')}>
          {props.modelPicker}
          {props.modeSwitch}
        </PanelSection>

        {props.storyboard ? (
          props.storyboard.panel
        ) : (
          <PromptAndReferences controller={controller} />
        )}

        <Collapsible defaultOpen>
          <CollapsibleTrigger className='text-muted-foreground hover:text-foreground group text-2xs flex w-full items-center justify-between py-1 font-semibold tracking-wide uppercase'>
            {t('Parameters')}
            <ChevronDown
              className='duration-control size-3.5 transition-transform group-data-[panel-open]:rotate-180'
              aria-hidden='true'
            />
          </CollapsibleTrigger>
          <CollapsibleContent className='space-y-4 pt-2'>
            <GenerationSettingsSection
              modality={modality}
              videoMode={draft.capabilityMode}
            />
            <ChannelSelect />
          </CollapsibleContent>
        </Collapsible>
      </div>

      {props.storyboard ? (
        <GenerateFooter
          controller={controller}
          pricingModel={props.pricingModel}
          label={t('Generate {{count}} scenes', {
            count: props.storyboard.sceneCount,
          })}
          disabled={props.storyboard.sceneCount === 0}
          onGenerate={() => {
            props.storyboard?.onGenerate()
            props.onGenerated?.()
          }}
          estimateOverride={{ n: Math.max(1, props.storyboard.sceneCount) }}
        />
      ) : (
        <GenerateFooter
          controller={controller}
          pricingModel={props.pricingModel}
          label={draft.submitLabel}
          disabled={!draft.canSubmit}
          issue={draft.videoIssue ?? draft.audioIssue ?? draft.imageIssue}
          onGenerate={() => {
            controller.submit()
            props.onGenerated?.()
          }}
        />
      )}
    </div>
  )
}

/** Prompt box and reference images of a single or batch run. */
function PromptAndReferences(props: { controller: GenerationController }) {
  const { t } = useTranslation()
  const controller = props.controller
  const draft = controller.draft
  const setStudioSettings = usePlaygroundStore(
    (state) => state.setStudioSettings
  )
  // What the attached images do in the current video mode.
  let mediaHint: string | undefined
  if (draft.referencesModeSelected) {
    mediaHint = t('Up to {{count}} images for characters, products or style.', {
      count: draft.maxFiles,
    })
  } else if (
    draft.capabilityQuery.data?.frames?.supportsLastFrame &&
    !draft.settings.videoDisableLastFrame
  ) {
    mediaHint = t('The first image opens the clip; a second one ends it.')
  } else if (controller.modality === 'video') {
    mediaHint = t('The image becomes the opening frame of the clip.')
  }

  let promptTitle = t('Prompt')
  if (draft.audio.tool === 'sfx' && controller.modality === 'audio') {
    promptTitle = t('Sound description')
  } else if (draft.audio.tool === 'music' && controller.modality === 'audio') {
    promptTitle = t('Music prompt')
  } else if (controller.modality === 'audio') {
    promptTitle = t('Script')
  }
  const overLimit =
    draft.charLimit !== null && draft.charCount > draft.charLimit

  return (
    <>
      {draft.usesAudioInput && (
        <PanelSection title={t('Input audio')}>
          <AudioInputDropzone
            value={controller.references}
            onChange={controller.setReferences}
          />
        </PanelSection>
      )}
      {draft.usesPromptText && (
        <PanelSection
          title={promptTitle}
          hint={
            draft.batchMode
              ? t('One prompt per line · use {a|b} for variants')
              : undefined
          }
        >
          <Textarea
            value={controller.text}
            onChange={(event) => controller.setText(event.target.value)}
            onKeyDown={(event) => {
              if (event.key === 'Enter' && (event.metaKey || event.ctrlKey)) {
                event.preventDefault()
                controller.submit()
              }
            }}
            placeholder={draft.placeholder}
            aria-label={draft.placeholder}
            className='bg-background min-h-36 resize-y rounded-xl text-sm leading-relaxed'
          />
          <div className='text-muted-foreground text-2xs flex items-center justify-between gap-2'>
            <span className='inline-flex items-center gap-1' aria-live='polite'>
              {draft.planSummary ? (
                <>
                  <Layers className='size-3' aria-hidden='true' />
                  {draft.planSummary}
                </>
              ) : (
                t('Ctrl/⌘ + Enter to generate')
              )}
            </span>
            <span
              className={cn('tabular-nums', overLimit && 'text-destructive')}
            >
              {draft.charLimit === null
                ? controller.text.length
                : `${draft.charCount.toLocaleString()} / ${draft.charLimit.toLocaleString()}`}
            </span>
          </div>
          {draft.plan.truncated > 0 && (
            <p className='text-warning text-2xs'>
              {t('{{count}} more skipped (max {{max}} per run)', {
                count: draft.plan.truncated,
                max: MAX_STUDIO_BATCH_JOBS,
              })}
            </p>
          )}
        </PanelSection>
      )}

      {draft.showMediaSlot && (
        <PanelSection title={draft.mediaLabel} hint={mediaHint}>
          {draft.canSwitchReferenceMode && (
            <SegmentedControl<VideoReferenceMode>
              fullWidth
              size='sm'
              aria-label={t('Reference mode')}
              value={draft.settings.videoReferenceMode}
              options={[
                { value: 'frames', label: t('Frames') },
                { value: 'references', label: t('References') },
              ]}
              onValueChange={(mode) =>
                setStudioSettings((prev) => ({
                  ...prev,
                  videoReferenceMode: mode,
                }))
              }
            />
          )}
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
          <ImageMaskButton controller={controller} />
          {draft.canToggleLastFrame && (
            <label className='text-muted-foreground flex items-center justify-between gap-2 text-xs'>
              {t('Use the second image as the last frame')}
              <Switch
                checked={!draft.settings.videoDisableLastFrame}
                onCheckedChange={(checked) =>
                  setStudioSettings((prev) => ({
                    ...prev,
                    videoDisableLastFrame: !checked,
                  }))
                }
              />
            </label>
          )}
        </PanelSection>
      )}

      {draft.maxReferenceVideos > 0 && (
        <PanelSection
          title={t('Reference videos')}
          hint={t('Up to {{count}} clips for motion, camera or style.', {
            count: draft.maxReferenceVideos,
          })}
        >
          <MediaReferenceSlot
            label={t('Add video')}
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
            roleForIndex={(index) => `${index + 1}`}
          />
        </PanelSection>
      )}

      {draft.maxReferenceAudios > 0 && (
        <PanelSection
          title={t('Reference audio')}
          hint={
            draft.audioReferenceRequiresVisual
              ? t(
                  'Up to {{count}} tracks for voice, music or rhythm. Needs a reference image or video.',
                  { count: draft.maxReferenceAudios }
                )
              : t('Up to {{count}} tracks for voice, music or rhythm.', {
                  count: draft.maxReferenceAudios,
                })
          }
        >
          <MediaReferenceSlot
            label={t('Add audio')}
            value={controller.referenceAudios}
            onChange={controller.setReferenceAudios}
            onUploadingChange={controller.setUploading}
            kind='audio'
            accept='audio/*'
            maxFiles={draft.maxReferenceAudios}
            roleForIndex={(index) => `${index + 1}`}
          />
        </PanelSection>
      )}
    </>
  )
}

/**
 * Pinned footer: what the run will cost, whether the balance covers it,
 * and the Generate action. A run the balance cannot cover is blocked here
 * instead of failing job by job after it was queued.
 */
export function GenerateFooter(props: {
  controller: GenerationController
  pricingModel?: PricingModel
  label: string
  disabled: boolean
  issue?: string | null
  onGenerate: () => void
  estimateOverride?: { n: number }
}) {
  const { t } = useTranslation()
  const draft = props.controller.draft
  const estimateParams = props.estimateOverride
    ? { ...draft.estimateParams, n: props.estimateOverride.n }
    : draft.estimateParams
  const estimate = useCostEstimate({
    modelName: props.pricingModel?.model_name,
    group: draft.group,
    params: estimateParams,
  })
  const shortfall = useBalanceShortfall(estimate.data?.quota)
  const activeJobs = props.controller.activeJobs

  return (
    <div className='border-border/60 bg-background/90 supports-backdrop-filter:bg-background/75 shrink-0 space-y-2.5 border-t px-4 pt-3 pb-[max(0.75rem,env(safe-area-inset-bottom,0px))] backdrop-blur-xl'>
      {shortfall !== null && (
        <div
          role='alert'
          className='border-destructive/30 bg-destructive/5 text-destructive flex items-start gap-2 rounded-lg border px-2.5 py-2 text-xs'
        >
          <AlertTriangle
            className='mt-px size-3.5 shrink-0'
            aria-hidden='true'
          />
          <span className='min-w-0 flex-1'>
            {t('Your balance does not cover this run.')}{' '}
            <Link to='/billing' className='font-semibold underline'>
              {t('Top up')}
            </Link>
          </span>
        </div>
      )}
      {props.issue && (
        <p className='text-warning text-xs' aria-live='polite'>
          {props.issue}
        </p>
      )}
      <div className='flex items-center justify-between gap-2'>
        <PriceHintBadge
          model={props.pricingModel}
          group={draft.group}
          groupRatio={draft.groupRatio}
          jobCount={estimateParams.n}
          estimateParams={estimateParams}
        />
        {activeJobs > 0 && (
          <span className='text-muted-foreground text-2xs' aria-live='polite'>
            {t('{{count}} in progress', { count: activeJobs })}
          </span>
        )}
      </div>
      <Button
        size='lg'
        className='h-11 w-full gap-2 rounded-xl text-sm font-semibold'
        disabled={props.disabled || shortfall !== null}
        onClick={props.onGenerate}
      >
        <Sparkles className='size-4' aria-hidden='true' />
        {props.label}
      </Button>
    </div>
  )
}

function ChannelSelect() {
  const { t } = useTranslation()
  const group = usePlaygroundStore((state) => state.config.group)
  const groups = usePlaygroundStore((state) => state.groups)
  const updateConfig = usePlaygroundStore((state) => state.updateConfig)

  return (
    <div className='space-y-1.5'>
      <Label htmlFor='create-group' className='text-xs'>
        {t('Channel')}
      </Label>
      <NativeSelect
        id='create-group'
        size='sm'
        className='w-full'
        value={group}
        onChange={(event) => updateConfig({ group: event.target.value })}
      >
        {groups.length === 0 && (
          <NativeSelectOption value={group}>{group}</NativeSelectOption>
        )}
        {groups.map((option) => (
          <NativeSelectOption key={option.value} value={option.value}>
            {option.desc ? `${option.label} — ${option.desc}` : option.label}
          </NativeSelectOption>
        ))}
      </NativeSelect>
    </div>
  )
}
