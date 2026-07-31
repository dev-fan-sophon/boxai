import type { GroupOption, ModelOption } from '../../types'

type InputControlStateOptions = {
  disabled?: boolean
  groups: GroupOption[]
  hasAttachments?: boolean
  hasStopHandler: boolean
  isAddingAttachments?: boolean
  isGenerating?: boolean
  isModelLoading?: boolean
  models: ModelOption[]
  text: string
}

type InputControlState = {
  canSubmit: boolean
  isSelectorDisabled: boolean
  shouldShowStop: boolean
}

type SubmittableInputMessage = {
  text?: string | null
}

export function getSubmittableInputText(
  message: SubmittableInputMessage,
  disabled?: boolean
): string | null {
  if (disabled || !message.text?.trim()) {
    return null
  }

  return message.text
}

export function getInputControlState({
  disabled,
  groups,
  hasAttachments,
  hasStopHandler,
  isAddingAttachments,
  isGenerating,
  isModelLoading,
  models,
  text,
}: InputControlStateOptions): InputControlState {
  const hasModels = models.length > 0

  return {
    canSubmit:
      !disabled &&
      !isAddingAttachments &&
      hasModels &&
      (text.trim().length > 0 || Boolean(hasAttachments)),
    isSelectorDisabled: disabled || isModelLoading || groups.length === 0,
    shouldShowStop: Boolean(isGenerating && hasStopHandler),
  }
}
