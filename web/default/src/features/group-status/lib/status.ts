import type { GroupModelStatus, GroupStatusGroup } from '../types'

export type StatusTone = 'healthy' | 'slow' | 'down' | 'observing'

export function normalizeStatus(status: GroupModelStatus): StatusTone {
  if (status === 'healthy' || status === 'slow' || status === 'down') {
    return status
  }
  return 'observing'
}

export function statusLabelKey(status: StatusTone): string {
  switch (status) {
    case 'healthy':
      return 'Healthy'
    case 'slow':
      return 'Slow'
    case 'down':
      return 'Down'
    default:
      return 'Observing'
  }
}

/** Heat cell: healthy / slow / down / empty */
export function seriesCellTone(
  successRate: number | null | undefined,
  requestCount: number
): StatusTone | 'empty' {
  if (!requestCount || successRate == null || !Number.isFinite(successRate)) {
    return 'empty'
  }
  if (successRate >= 90) return 'healthy'
  if (successRate >= 50) return 'slow'
  return 'down'
}

export function summarizeGroups(groups: GroupStatusGroup[]) {
  let healthy = 0
  let slow = 0
  let down = 0
  let observing = 0
  let totalModels = 0
  for (const g of groups) {
    for (const m of g.models) {
      totalModels++
      const tone = normalizeStatus(m.status)
      if (tone === 'healthy') healthy++
      else if (tone === 'slow') slow++
      else if (tone === 'down') down++
      else observing++
    }
  }
  return {
    groupCount: groups.length,
    healthy,
    slow,
    down,
    observing,
    totalModels,
  }
}

export function formatBucketRange(
  ts: number,
  bucketSeconds: number,
  locale?: string
): string {
  const start = new Date(ts * 1000)
  const end = new Date((ts + bucketSeconds) * 1000)
  const fmt = new Intl.DateTimeFormat(locale, {
    hour: '2-digit',
    minute: '2-digit',
    hour12: false,
  })
  return `${fmt.format(start)} – ${fmt.format(end)}`
}
