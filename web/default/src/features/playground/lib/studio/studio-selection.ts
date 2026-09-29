import type { StudioRunSummary } from '../session/session-types'
import type { StudioFeedBatch } from './studio-feed'

/**
 * Multi-select over finished studio results. Selection is keyed by run id and
 * always read back through the feed's current runs, so results that leave the
 * feed (session switch, history trim) drop out of the selection on their own.
 */
export type StudioSelection = {
  ids: ReadonlySet<number>
  /** Last plainly clicked run; shift-click extends from here. */
  anchor: number | null
}

export const EMPTY_STUDIO_SELECTION: StudioSelection = {
  ids: new Set(),
  anchor: null,
}

/** Finished image runs in feed order: the tiles a selection can include. */
export function selectableStudioImages(
  batches: StudioFeedBatch[]
): StudioRunSummary[] {
  return batches.flatMap((batch) =>
    batch.runs.filter((run) => Boolean(run.resultUrl))
  )
}

/**
 * Click on a result in select mode. A plain click toggles one result and
 * moves the anchor; a range click gives every result between the anchor and
 * the target the state the target is switching to, so shift-click can both
 * select and clear a run of tiles.
 */
export function clickStudioSelection(
  selection: StudioSelection,
  order: number[],
  id: number,
  range: boolean
): StudioSelection {
  const ids = new Set(selection.ids)
  const nextState = !ids.has(id)
  const from = selection.anchor == null ? -1 : order.indexOf(selection.anchor)
  const to = order.indexOf(id)
  if (range && from >= 0 && to >= 0) {
    const [start, end] = from <= to ? [from, to] : [to, from]
    for (const rangeId of order.slice(start, end + 1)) {
      if (nextState) ids.add(rangeId)
      else ids.delete(rangeId)
    }
    return { ids, anchor: id }
  }
  if (nextState) ids.add(id)
  else ids.delete(id)
  return { ids, anchor: id }
}

/** Batch header toggle: selects the whole batch unless it already is. */
export function toggleStudioSelectionGroup(
  selection: StudioSelection,
  groupIds: number[]
): StudioSelection {
  if (groupIds.length === 0) return selection
  const ids = new Set(selection.ids)
  const allSelected = groupIds.every((id) => ids.has(id))
  for (const id of groupIds) {
    if (allSelected) ids.delete(id)
    else ids.add(id)
  }
  return { ids, anchor: selection.anchor }
}

const PERSISTED_ASSET_URL = /^\/api\/playground\/assets\/\d+\/content(?:[?#]|$)/

/**
 * URL a result can be stored under outside this tab (a canvas document):
 * the archived asset route or a remote http(s) URL. In-tab `data:`/`blob:`
 * URLs fall back to the archived asset when there is one; otherwise the
 * result cannot leave the studio and this returns null.
 */
export function persistedStudioResultUrl(run: StudioRunSummary): string | null {
  const url = run.resultUrl?.trim() ?? ''
  if (/^https?:\/\//i.test(url) || PERSISTED_ASSET_URL.test(url)) return url
  if (run.assetId && run.assetId > 0) {
    return `/api/playground/assets/${run.assetId}/content`
  }
  return null
}
