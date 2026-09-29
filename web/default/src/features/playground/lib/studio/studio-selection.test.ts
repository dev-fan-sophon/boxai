import { describe, expect, it } from 'vitest'

import { buildStudioFeed } from './studio-feed'
import {
  EMPTY_STUDIO_SELECTION,
  clickStudioSelection,
  persistedStudioResultUrl,
  selectableStudioImages,
  toggleStudioSelectionGroup,
  type StudioSelection,
} from './studio-selection'

const ORDER = [1, 2, 3, 4, 5, 6]

const selection = (ids: number[], anchor: number | null): StudioSelection => ({
  ids: new Set(ids),
  anchor,
})

const sorted = (value: StudioSelection) => [...value.ids].sort((a, b) => a - b)

describe('clickStudioSelection', () => {
  it('toggles a single result and moves the anchor on a plain click', () => {
    const selected = clickStudioSelection(
      EMPTY_STUDIO_SELECTION,
      ORDER,
      3,
      false
    )
    expect(sorted(selected)).toEqual([3])
    expect(selected.anchor).toBe(3)

    const cleared = clickStudioSelection(selected, ORDER, 3, false)
    expect(sorted(cleared)).toEqual([])
    expect(cleared.anchor).toBe(3)
  })

  it('selects every result between the anchor and the target on a range click', () => {
    const forward = clickStudioSelection(selection([2], 2), ORDER, 5, true)
    expect(sorted(forward)).toEqual([2, 3, 4, 5])
    expect(forward.anchor).toBe(5)

    const backward = clickStudioSelection(selection([5], 5), ORDER, 2, true)
    expect(sorted(backward)).toEqual([2, 3, 4, 5])
  })

  it('keeps selections outside the range when extending', () => {
    const next = clickStudioSelection(selection([1, 3], 3), ORDER, 5, true)
    expect(sorted(next)).toEqual([1, 3, 4, 5])
  })

  it('clears the range when the target was already selected', () => {
    const next = clickStudioSelection(
      selection([1, 2, 3, 4, 5], 1),
      ORDER,
      4,
      true
    )
    expect(sorted(next)).toEqual([5])
  })

  it('falls back to a single toggle without a usable anchor', () => {
    expect(
      sorted(clickStudioSelection(selection([], null), ORDER, 4, true))
    ).toEqual([4])
    // Anchor left the feed (e.g. its batch was trimmed from history).
    expect(
      sorted(clickStudioSelection(selection([], 99), ORDER, 4, true))
    ).toEqual([4])
  })
})

describe('toggleStudioSelectionGroup', () => {
  it('selects the whole batch unless all of it is already selected', () => {
    const partial = toggleStudioSelectionGroup(selection([1, 4], 4), [1, 2, 3])
    expect(sorted(partial)).toEqual([1, 2, 3, 4])
    expect(partial.anchor).toBe(4)

    const cleared = toggleStudioSelectionGroup(partial, [1, 2, 3])
    expect(sorted(cleared)).toEqual([4])
  })
})

describe('selectableStudioImages', () => {
  it('lists finished results in feed order and skips runs without a result', () => {
    const feed = buildStudioFeed(
      [
        {
          id: 1,
          prompt: 'cat',
          resultUrl: '/a',
          batchId: 'b1',
          createdAt: 1000,
        },
        { id: 2, prompt: 'cat', batchId: 'b1', createdAt: 1001 },
        {
          id: 3,
          prompt: 'dog',
          resultUrl: '/c',
          batchId: 'b2',
          createdAt: 5000,
        },
      ],
      []
    )
    expect(selectableStudioImages(feed).map((run) => run.id)).toEqual([1, 3])
  })
})

describe('persistedStudioResultUrl', () => {
  it('keeps archived asset routes and remote URLs', () => {
    expect(
      persistedStudioResultUrl({
        id: 1,
        resultUrl: '/api/playground/assets/12/content',
      })
    ).toBe('/api/playground/assets/12/content')
    expect(
      persistedStudioResultUrl({
        id: 1,
        resultUrl: 'https://cdn.example/a.png',
      })
    ).toBe('https://cdn.example/a.png')
  })

  it('prefers the archived asset over an expiring provider URL', () => {
    expect(
      persistedStudioResultUrl({
        id: 1,
        resultUrl: 'https://provider.example/signed.png?exp=1',
        assetId: 9,
      })
    ).toBe('/api/playground/assets/9/content')
  })

  it('swaps in-tab URLs for the archived asset when one exists', () => {
    expect(
      persistedStudioResultUrl({
        id: 1,
        resultUrl: 'data:image/png;base64,AAAA',
        assetId: 9,
      })
    ).toBe('/api/playground/assets/9/content')
  })

  it('rejects results that only exist in this tab', () => {
    expect(
      persistedStudioResultUrl({
        id: 1,
        resultUrl: 'data:image/png;base64,AAAA',
      })
    ).toBeNull()
    expect(
      persistedStudioResultUrl({
        id: 1,
        resultUrl: 'blob:https://you-box.com/1',
      })
    ).toBeNull()
    expect(
      persistedStudioResultUrl({ id: 1, resultUrl: '/api/other/1' })
    ).toBeNull()
  })
})
