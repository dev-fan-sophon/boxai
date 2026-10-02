/**
 * Batch production planning shared by the playground studio and the canvas.
 *
 * One submit expands into a list of jobs, each producing exactly one output
 * (one image, one video task, one clip):
 *
 *   prompts  = explicit prompt list (multi-prompt editor), else
 *              batch mode ? one prompt per non-empty line : the whole text
 *   variants = every `{a|b|c}` group multiplies its prompt (cartesian)
 *   jobs     = variants × `count` takes, capped at MAX_STUDIO_BATCH_JOBS
 *
 * The cap is a UX guard against an accidental 100-job submit; billing limits
 * are enforced server-side per request.
 */

export const MAX_STUDIO_BATCH_JOBS = 20

/** Takes per prompt offered by the count pickers. */
export const BATCH_COUNTS = [1, 2, 3, 4, 6, 8, 10] as const

export const MAX_BATCH_COUNT = BATCH_COUNTS.at(-1) ?? 1

/** Only braces holding a `|` are variant groups, so `{name}` stays literal. */
const VARIANT_GROUP = /\{([^{}|]*(?:\|[^{}|]*)+)\}/

export function clampBatchCount(value: unknown): number {
  const parsed = Math.round(Number(value))
  if (!Number.isFinite(parsed)) return 1
  return Math.min(MAX_BATCH_COUNT, Math.max(1, parsed))
}

/** Splits a batch prompt box into prompts: one per line, blank lines ignored. */
export function splitBatchPrompts(text: string): string[] {
  return text
    .split(/\r?\n/)
    .map((line) => line.trim())
    .filter(Boolean)
}

/** Number of prompts `{a|b}` groups expand to, without materializing them. */
export function countPromptVariants(prompt: string): number {
  let total = 1
  let rest = prompt
  let match = VARIANT_GROUP.exec(rest)
  while (match) {
    total *= match[1].split('|').length
    rest = rest.slice(match.index + match[0].length)
    match = VARIANT_GROUP.exec(rest)
  }
  return total
}

/**
 * Expands `{a|b|c}` groups into concrete prompts, in reading order, stopping
 * at `limit` results. Doubled spaces left by an empty option are collapsed.
 */
export function expandPromptVariants(prompt: string, limit: number): string[] {
  let expanded = [prompt]
  while (expanded.some((item) => VARIANT_GROUP.test(item))) {
    const next: string[] = []
    for (const item of expanded) {
      const match = VARIANT_GROUP.exec(item)
      if (!match) {
        next.push(item)
      } else {
        const head = item.slice(0, match.index)
        const tail = item.slice(match.index + match[0].length)
        for (const option of match[1].split('|')) {
          next.push(head + option + tail)
          if (next.length >= limit) break
        }
      }
      if (next.length >= limit) break
    }
    expanded = next
  }
  return expanded
    .slice(0, limit)
    .map((item) => item.replaceAll(/[ \t]{2,}/g, ' ').trim())
    .filter(Boolean)
}

export type GenerationJobPlan = {
  /** One prompt per job, in generation order. */
  prompts: string[]
  /** Jobs dropped because the plan exceeded MAX_STUDIO_BATCH_JOBS. */
  truncated: number
}

export function planGenerationJobs(input: {
  text: string
  batchMode: boolean
  count: number
  /** Prompts edited one per row; takes precedence over `text`. */
  prompts?: string[]
}): GenerationJobPlan {
  let basePrompts = [input.text.trim()].filter(Boolean)
  if (input.prompts) {
    basePrompts = input.prompts.map((prompt) => prompt.trim()).filter(Boolean)
  } else if (input.batchMode) {
    basePrompts = splitBatchPrompts(input.text)
  }
  const count = clampBatchCount(input.count)
  const prompts: string[] = []
  let total = 0
  for (const base of basePrompts) {
    total += countPromptVariants(base) * count
    const room = MAX_STUDIO_BATCH_JOBS - prompts.length
    if (room <= 0) continue
    for (const variant of expandPromptVariants(base, room)) {
      for (
        let take = 0;
        take < count && prompts.length < MAX_STUDIO_BATCH_JOBS;
        take++
      ) {
        prompts.push(variant)
      }
    }
  }
  return { prompts, truncated: Math.max(0, total - prompts.length) }
}
