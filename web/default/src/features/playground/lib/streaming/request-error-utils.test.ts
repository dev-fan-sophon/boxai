import { describe, expect, it } from 'vitest'

import { parseRequestErrorDetails } from './request-error-utils'

describe('parseRequestErrorDetails', () => {
  it('reads TaskError.message from video pre-consume 403s', () => {
    const details = parseRequestErrorDetails({
      message: 'Request failed with status code 403',
      response: {
        data: {
          code: 'insufficient_user_quota',
          message:
            '预扣费失败：用户额度不足。需要 ₫4,816,087.50，剩余 ₫315,335.98',
        },
      },
    })
    expect(details.errorCode).toBe('insufficient_user_quota')
    expect(details.errorMessage).toContain('预扣费失败')
    expect(details.errorMessage).not.toBe('Request failed with status code 403')
  })
})
