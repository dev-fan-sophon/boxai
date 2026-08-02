import { describe, expect, test } from 'bun:test'

import { chatRequestSchema } from './chat-request'

const baseRequest = {
  model: 'test-model',
  requestKey: '123e4567-e89b-42d3-a456-426614174000',
}

describe('chat request reasoning', () => {
  test.each([
    'provider-default',
    'none',
    'minimal',
    'low',
    'medium',
    'high',
    'xhigh',
  ] as const)('accepts %s', (reasoning) => {
    const result = chatRequestSchema.safeParse({ ...baseRequest, reasoning })

    expect(result.success).toBe(true)
    if (result.success) expect(result.data.reasoning).toBe(reasoning)
  })

  test.each(['', 'default', 'extra-high', 1, null])(
    'rejects unsupported value %p',
    (reasoning) => {
      expect(
        chatRequestSchema.safeParse({ ...baseRequest, reasoning }).success
      ).toBe(false)
    }
  )

  test('allows reasoning to be omitted', () => {
    const result = chatRequestSchema.safeParse(baseRequest)

    expect(result.success).toBe(true)
    if (result.success) expect(result.data.reasoning).toBeUndefined()
  })
})
