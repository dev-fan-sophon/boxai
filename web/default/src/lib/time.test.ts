import { describe, expect, it } from 'vitest'

import { formatChartTime, formatDate, formatDateTimeObject } from './time'

describe('localized time formatting', () => {
  const date = new Date(2026, 6, 22, 13, 5, 9)
  const timestamp = Math.floor(date.getTime() / 1000)

  it('uses Vietnamese date ordering when vi-VN is requested', () => {
    expect(formatDate(timestamp, 'vi-VN')).toBe('22 thg 7, 2026')
    expect(formatDateTimeObject(date, 'vi-VN')).toContain('22 thg 7, 2026')
  })

  it('keeps chart labels compact while respecting Vietnamese ordering', () => {
    expect(formatChartTime(timestamp, 'day', 'vi-VN')).toBe('22-07')
    expect(formatChartTime(timestamp, 'hour', 'vi-VN')).toBe('22-07 13:05 GMT')
  })
})
