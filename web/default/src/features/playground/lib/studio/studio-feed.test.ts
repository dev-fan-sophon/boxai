import { describe, expect, it } from 'vitest'

import { DEFAULT_STUDIO_SETTINGS } from '../storage/store-migration'
import {
  buildStudioFeed,
  createLocalRunId,
  groupRunsIntoBatches,
  type PendingStudioRun,
} from './studio-feed'

function pendingJob(
  clientId: string,
  batchId: string,
  prompt: string,
  queuedAt: number
): PendingStudioRun {
  return {
    clientId,
    input: {
      modality: 'image',
      sessionId: 's1',
      batchId,
      prompt,
      model: 'gpt-image-2',
      group: 'default',
      references: [],
    },
    settings: DEFAULT_STUDIO_SETTINGS,
    queuedAt,
    status: 'queued',
  }
}

describe('groupRunsIntoBatches', () => {
  it('groups same-prompt runs created together into one batch', () => {
    const t = 1_700_000_000_000
    const batches = groupRunsIntoBatches([
      { id: 1, prompt: 'a cat', createdAt: t },
      { id: 2, prompt: 'a cat', createdAt: t + 1000 },
      { id: 3, prompt: 'a dog', createdAt: t + 2000 },
    ])
    expect(batches).toHaveLength(2)
    expect(batches[0].runs.map((run) => run.id)).toEqual([1, 2])
    expect(batches[1].runs.map((run) => run.id)).toEqual([3])
  })

  it('splits same-prompt runs that are far apart in time', () => {
    const t = 1_700_000_000_000
    const batches = groupRunsIntoBatches([
      { id: 1, prompt: 'a cat', createdAt: t },
      { id: 2, prompt: 'a cat', createdAt: t + 600_000 },
    ])
    expect(batches).toHaveLength(2)
  })

  it('keeps legacy runs without timestamps grouped by prompt only', () => {
    const batches = groupRunsIntoBatches([
      { id: 1, prompt: 'a cat' },
      { id: 2, prompt: 'a cat' },
      { id: 3, prompt: 'a dog' },
    ])
    expect(batches).toHaveLength(2)
    expect(batches[0].runs).toHaveLength(2)
  })

  it('groups runs by batch id even when prompts differ or runs interleave', () => {
    const t = 1_700_000_000_000
    const batches = groupRunsIntoBatches([
      { id: 1, prompt: 'a cat', batchId: 'x', createdAt: t },
      { id: 2, prompt: 'a dog', batchId: 'y', createdAt: t + 10 },
      { id: 3, prompt: 'a cat, blue', batchId: 'x', createdAt: t + 900_000 },
    ])
    expect(batches.map((batch) => batch.runs.map((run) => run.id))).toEqual([
      [1, 3],
      [2],
    ])
    expect(batches[0].prompts).toEqual(['a cat', 'a cat, blue'])
  })

  it('returns empty for missing input', () => {
    expect(groupRunsIntoBatches(undefined)).toEqual([])
    expect(groupRunsIntoBatches([])).toEqual([])
  })
})

describe('buildStudioFeed', () => {
  it('keeps finished runs and in-flight jobs of one batch on one card', () => {
    const t = 1_700_000_000_000
    const feed = buildStudioFeed(
      [{ id: 1, prompt: 'a cat', batchId: 'x', createdAt: t + 5000 }],
      [pendingJob('j2', 'x', 'a cat', t), pendingJob('j3', 'x', 'a cat', t)]
    )
    expect(feed).toHaveLength(1)
    expect(feed[0].key).toBe('batch:x')
    expect(feed[0].runs).toHaveLength(1)
    expect(feed[0].pending.map((job) => job.clientId)).toEqual(['j2', 'j3'])
    expect(feed[0].createdAt).toBe(t)
  })

  it('orders cards by when their batch started', () => {
    const t = 1_700_000_000_000
    const feed = buildStudioFeed(
      [{ id: 1, prompt: 'late', batchId: 'late', createdAt: t + 60_000 }],
      [pendingJob('j1', 'early', 'early', t)]
    )
    expect(feed.map((batch) => batch.batchId)).toEqual(['early', 'late'])
  })
})

describe('createLocalRunId', () => {
  it('returns unique negative ids', () => {
    const a = createLocalRunId()
    const b = createLocalRunId()
    expect(a).toBeLessThan(0)
    expect(b).toBeLessThan(0)
    expect(a).not.toBe(b)
  })
})
