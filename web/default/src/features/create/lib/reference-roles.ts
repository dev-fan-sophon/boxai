import type { GenerationDraft } from '../hooks/use-generation-draft'

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
