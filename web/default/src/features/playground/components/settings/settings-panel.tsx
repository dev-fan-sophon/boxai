import { useTranslation } from 'react-i18next'

import { ChevronDown, X } from '@/components/icons'
import { Button } from '@/components/ui/button'
import {
  Collapsible,
  CollapsibleContent,
  CollapsibleTrigger,
} from '@/components/ui/collapsible'
import { Label } from '@/components/ui/label'
import { NativeSelect, NativeSelectOption } from '@/components/ui/native-select'
import { useXlUp } from '@/hooks'
import { cn } from '@/lib/utils'
import { usePlaygroundStore } from '@/stores/playground-store'

import { ChatParametersSection } from './chat-parameters-section'
import { ChatToolsSection } from './chat-tools-section'

/**
 * Chat settings: tools up front, channel and sampling parameters folded
 * away. Shared by the desktop column and the mobile bottom sheet.
 */
export function SettingsSections(props: { duoActive: boolean }) {
  const { t } = useTranslation()

  return (
    <div className='space-y-5'>
      <Section title={t('Chat tools')}>
        <ChatToolsSection />
      </Section>
      <AdvancedSection>
        <GroupSection />
        <ChatParametersSection showReasoning={!props.duoActive} />
      </AdvancedSection>
    </div>
  )
}

/**
 * Sampling parameters and channel selection are power-user knobs; fold them
 * away so the default settings surface stays approachable.
 */
function AdvancedSection(props: { children: React.ReactNode }) {
  const { t } = useTranslation()

  return (
    <Collapsible>
      <CollapsibleTrigger className='text-muted-foreground hover:text-foreground hover:bg-accent focus-visible:ring-ring group transition-ui -mx-2 flex w-[calc(100%+1rem)] items-center justify-between gap-2 rounded-lg px-2 py-1.5 text-xs font-medium outline-none focus-visible:ring-2'>
        <span className='min-w-0 truncate'>{t('Advanced')}</span>
        <ChevronDown
          className='duration-control size-3.5 shrink-0 transition-transform group-data-[panel-open]:rotate-180'
          aria-hidden='true'
        />
      </CollapsibleTrigger>
      <CollapsibleContent className='space-y-3 pt-2'>
        {props.children}
      </CollapsibleContent>
    </Collapsible>
  )
}

/**
 * Desktop settings column. At ≥1280px it renders inline (280px); between
 * 1024–1279px it floats over the workspace as an overlay so the center
 * column keeps a usable width. Open state is controlled by the caller
 * (persisted at ≥1280px, ephemeral below).
 */
export function SettingsPanel(props: {
  duoActive: boolean
  open: boolean
  onClose: () => void
}) {
  const { t } = useTranslation()
  const isWide = useXlUp()

  if (!props.open) return null

  return (
    <aside
      className={cn(
        'border-border bg-background flex w-[min(19rem,40vw)] shrink-0 flex-col border-l',
        !isWide && 'shadow-lifted absolute inset-y-0 right-0 z-20'
      )}
      aria-label={t('Settings')}
    >
      <div className='border-border flex h-12 shrink-0 items-center justify-between gap-2 border-b pr-2 pl-4 sm:h-14'>
        <h2 className='text-foreground min-w-0 truncate text-sm font-semibold'>
          {t('Settings')}
        </h2>
        <Button
          size='icon'
          variant='ghost'
          className='text-muted-foreground size-8'
          aria-label={t('Close settings')}
          onClick={props.onClose}
        >
          <X className='size-4' />
        </Button>
      </div>
      <div className='min-h-0 flex-1 overflow-y-auto px-4 py-4'>
        <SettingsSections duoActive={props.duoActive} />
      </div>
    </aside>
  )
}

function GroupSection() {
  const { t } = useTranslation()
  const group = usePlaygroundStore((state) => state.config.group)
  const groups = usePlaygroundStore((state) => state.groups)
  const updateConfig = usePlaygroundStore((state) => state.updateConfig)

  return (
    <div className='space-y-1.5'>
      <Label htmlFor='settings-group' className='text-xs font-medium'>
        {t('Channel')}
      </Label>
      <NativeSelect
        id='settings-group'
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

function Section(props: { title: string; children: React.ReactNode }) {
  return (
    <section className='space-y-2'>
      <h3 className='text-muted-foreground text-xs font-medium'>
        {props.title}
      </h3>
      {props.children}
    </section>
  )
}
