import {
  createContext,
  useContext,
  type ComponentProps,
  type ReactNode,
  type RefObject,
} from 'react'
import { createPortal } from 'react-dom'
import { useTranslation } from 'react-i18next'

import { RotateCcw, Save } from '@/components/icons'
import { Button } from '@/components/ui/button'

type SettingsPageContextValue = {
  actionsContainer: HTMLDivElement | null
  titleStatusContainer: HTMLSpanElement | null
  suppressSectionHeader: boolean
  pageTitle: string | null
}

const SettingsPageContext = createContext<SettingsPageContextValue>({
  actionsContainer: null,
  titleStatusContainer: null,
  suppressSectionHeader: false,
  pageTitle: null,
})

type SettingsPageProviderProps = {
  actionsContainer: HTMLDivElement | null
  titleStatusContainer?: HTMLSpanElement | null
  children: ReactNode
  suppressSectionHeader?: boolean
  /** Section cards whose title repeats the page title hide their header. */
  pageTitle?: string
}

export function SettingsPageProvider(props: SettingsPageProviderProps) {
  return (
    <SettingsPageContext.Provider
      value={{
        actionsContainer: props.actionsContainer,
        titleStatusContainer: props.titleStatusContainer ?? null,
        suppressSectionHeader: props.suppressSectionHeader ?? true,
        pageTitle: props.pageTitle ?? null,
      }}
    >
      {props.children}
    </SettingsPageContext.Provider>
  )
}

/**
 * Whether a section header should be hidden. Headers are suppressed by
 * default on settings pages, except when the section title differs from the
 * page title (a second concern on the page needs its own heading).
 */
export function useSuppressSettingsSectionHeader(title?: string) {
  const context = useContext(SettingsPageContext)
  if (!context.suppressSectionHeader) return false
  return context.pageTitle === null || title === context.pageTitle
}

type SettingsPageTitleStatusPortalProps = {
  children: ReactNode
}

export function SettingsPageTitleStatusPortal(
  props: SettingsPageTitleStatusPortalProps
) {
  const { titleStatusContainer } = useContext(SettingsPageContext)

  if (!titleStatusContainer) return null

  return createPortal(props.children, titleStatusContainer)
}

type SettingsPageActionsPortalProps = {
  children: ReactNode
}

export function SettingsPageActionsPortal(
  props: SettingsPageActionsPortalProps
) {
  const { actionsContainer } = useContext(SettingsPageContext)

  if (!actionsContainer) return null

  return createPortal(
    <div className='flex flex-wrap items-center justify-end gap-2 max-sm:justify-start'>
      {props.children}
    </div>,
    actionsContainer
  )
}

type SettingsPageFormActionsProps = {
  onSave: () => void
  onReset?: () => void
  isSaving?: boolean
  isSaveDisabled?: boolean
  isResetDisabled?: boolean
  saveLabel?: string
  savingLabel?: string
  resetLabel?: string
  resetVariant?: ComponentProps<typeof Button>['variant']
  saveButtonRef?: RefObject<HTMLButtonElement | null>
}

export function SettingsPageFormActions(props: SettingsPageFormActionsProps) {
  const { t } = useTranslation()
  const saveLabel = props.isSaving
    ? (props.savingLabel ?? 'Saving...')
    : (props.saveLabel ?? 'Save Changes')

  return (
    <SettingsPageActionsPortal>
      {props.onReset && (
        <Button
          type='button'
          size='sm'
          variant={props.resetVariant ?? 'outline'}
          onClick={props.onReset}
          disabled={props.isResetDisabled || props.isSaving}
        >
          <RotateCcw data-icon='inline-start' />
          <span>{t(props.resetLabel ?? 'Reset')}</span>
        </Button>
      )}
      <Button
        ref={props.saveButtonRef}
        type='button'
        size='sm'
        onClick={props.onSave}
        disabled={props.isSaving || props.isSaveDisabled}
      >
        <Save data-icon='inline-start' />
        <span>{t(saveLabel)}</span>
      </Button>
    </SettingsPageActionsPortal>
  )
}
