import { describe, expect, it } from 'vitest'

import {
  MAX_STUDIO_BATCH_JOBS,
  clampBatchCount,
  countPromptVariants,
  expandPromptVariants,
  planGenerationJobs,
  splitBatchPrompts,
} from './batch-plan'

describe('splitBatchPrompts', () => {
  it('ignores blank and whitespace-only lines and trims the rest', () => {
    expect(splitBatchPrompts('  a sunrise \n\n   \r\nb\tsunset\n')).toEqual([
      'a sunrise',
      'b\tsunset',
    ])
  })
})

describe('expandPromptVariants', () => {
  it('expands every {a|b} group in reading order', () => {
    expect(expandPromptVariants('a {red|blue} car, {day|night}', 20)).toEqual([
      'a red car, day',
      'a red car, night',
      'a blue car, day',
      'a blue car, night',
    ])
  })

  it('keeps braces without a pipe literal and collapses empty options', () => {
    expect(expandPromptVariants('{name} is {|very} tall', 20)).toEqual([
      '{name} is tall',
      '{name} is very tall',
    ])
  })

  it('stops at the limit without materializing the full product', () => {
    const prompt = Array.from({ length: 12 }, () => '{a|b}').join(' ')
    expect(countPromptVariants(prompt)).toBe(4096)
    expect(expandPromptVariants(prompt, 3)).toHaveLength(3)
  })
})

describe('planGenerationJobs', () => {
  it('repeats the single prompt by count when batch mode is off', () => {
    expect(
      planGenerationJobs({ text: '  one  ', batchMode: false, count: 3 })
    ).toEqual({ prompts: ['one', 'one', 'one'], truncated: 0 })
  })

  it('runs one job per line times count in batch mode', () => {
    expect(
      planGenerationJobs({ text: 'a\n\nb', batchMode: true, count: 2 })
    ).toEqual({ prompts: ['a', 'a', 'b', 'b'], truncated: 0 })
  })

  it('multiplies variants by count', () => {
    expect(
      planGenerationJobs({ text: 'cat {1|2}', batchMode: false, count: 2 })
        .prompts
    ).toEqual(['cat 1', 'cat 1', 'cat 2', 'cat 2'])
  })

  it('caps the total and reports how many jobs were dropped', () => {
    const plan = planGenerationJobs({
      text: Array.from({ length: 6 }, (_, i) => `p${i + 1}`).join('\n'),
      batchMode: true,
      count: 4,
    })
    expect(plan.prompts).toHaveLength(MAX_STUDIO_BATCH_JOBS)
    expect(plan.prompts.at(-1)).toBe('p5')
    expect(plan.truncated).toBe(24 - MAX_STUDIO_BATCH_JOBS)
  })

  it('runs an explicit prompt list as given, keeping multi-line rows whole', () => {
    expect(
      planGenerationJobs({
        text: 'ignored',
        batchMode: true,
        count: 2,
        prompts: ['wide shot\nslow pan', '  ', 'close-up {day|night}'],
      }).prompts
    ).toEqual([
      'wide shot\nslow pan',
      'wide shot\nslow pan',
      'close-up day',
      'close-up day',
      'close-up night',
      'close-up night',
    ])
  })

  it('returns no jobs for an empty prompt', () => {
    expect(
      planGenerationJobs({ text: '  \n ', batchMode: true, count: 4 })
    ).toEqual({ prompts: [], truncated: 0 })
  })
})

describe('clampBatchCount', () => {
  it.each([
    [0, 1],
    [3.4, 3],
    [99, 10],
    ['6', 6],
    [Number.NaN, 1],
  ])('clamps %s to %s', (input, expected) => {
    expect(clampBatchCount(input)).toBe(expected)
  })
})
