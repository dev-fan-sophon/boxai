import { describe, expect, it } from 'vitest'

import { describeTaskCharge } from './task-charge'

// quota is the pre-charge until billing_settled, then the final charge; a
// failure refund settles quota to 0. Older rows have no pre_consumed_quota.
describe('describeTaskCharge', () => {
  it.each([
    [
      'running task holds its pre-charge',
      { quota: 1108071, pre_consumed_quota: 1108071, billing_settled: false },
      { kind: 'pending', preCharged: 1108071 },
    ],
    [
      'settled task reports the refunded remainder',
      { quota: 370118, pre_consumed_quota: 1108071, billing_settled: true },
      {
        kind: 'settled',
        charged: 370118,
        preCharged: 1108071,
        refunded: 737953,
      },
    ],
    [
      'failed task refunds the whole pre-charge',
      { quota: 0, pre_consumed_quota: 500, billing_settled: true },
      { kind: 'settled', charged: 0, preCharged: 500, refunded: 500 },
    ],
    [
      'under-estimate charges extra without a refund',
      { quota: 900, pre_consumed_quota: 800, billing_settled: true },
      { kind: 'settled', charged: 900, preCharged: 800, refunded: 0 },
    ],
    [
      'legacy row without pre-charge shows only the charge',
      { quota: 300, pre_consumed_quota: 0, billing_settled: true },
      { kind: 'settled', charged: 300, preCharged: undefined, refunded: 0 },
    ],
    [
      'free task has no charge',
      { quota: 0, pre_consumed_quota: 0, billing_settled: false },
      { kind: 'none' },
    ],
  ])('%s', (_name, task, expected) => {
    expect(describeTaskCharge(task)).toEqual(expected)
  })
})
