import { describe, expect, it } from 'vitest'

import { cn } from './utils'

describe('cn', () => {
  it.each(['text-4xs', 'text-3xs', 'text-2xs', 'text-ui', 'text-md'])(
    'keeps the %s type-scale size next to a text color',
    (size) => {
      expect(cn(size, 'text-muted-foreground')).toBe(
        `${size} text-muted-foreground`
      )
    }
  )

  it('lets a later type-scale size override an earlier one', () => {
    expect(cn('text-xs', 'text-2xs')).toBe('text-2xs')
  })

  it('lets a later transition utility override transition-ui', () => {
    expect(cn('transition-ui', 'transition-none')).toBe('transition-none')
  })
})
