import { describe, expect, it } from 'vitest'

import {
  COMMON_TIMEZONES,
  buildRequestRuleExpr,
  createEmptyTimeCondition,
  normalizeCondition,
} from './billing-expr'

describe('billing expression timezones', () => {
  it('uses Ho Chi Minh City for new and missing time-rule timezones', () => {
    expect(COMMON_TIMEZONES.map((timezone) => timezone.value)).toContain(
      'Asia/Ho_Chi_Minh'
    )
    expect(createEmptyTimeCondition().timezone).toBe('Asia/Ho_Chi_Minh')
    expect(normalizeCondition({ source: 'time' })).toMatchObject({
      source: 'time',
      timezone: 'Asia/Ho_Chi_Minh',
    })
    expect(createEmptyTimeCondition('Asia/Tokyo').timezone).toBe('Asia/Tokyo')
  })

  it('preserves an explicitly saved Shanghai timezone', () => {
    expect(
      normalizeCondition({ source: 'time', timezone: 'Asia/Shanghai' })
    ).toMatchObject({
      source: 'time',
      timezone: 'Asia/Shanghai',
    })
  })

  it('uses the configured fallback only when a rule has no timezone', () => {
    expect(
      buildRequestRuleExpr(
        [
          {
            conditions: [
              {
                ...createEmptyTimeCondition(),
                timezone: '',
                value: '9',
              },
            ],
            multiplier: '0.8',
          },
        ],
        'Asia/Tokyo'
      )
    ).toContain('hour("Asia/Tokyo")')

    expect(
      buildRequestRuleExpr(
        [
          {
            conditions: [
              {
                ...createEmptyTimeCondition('Asia/Shanghai'),
                value: '9',
              },
            ],
            multiplier: '0.8',
          },
        ],
        'Asia/Tokyo'
      )
    ).toContain('hour("Asia/Shanghai")')
  })
})
