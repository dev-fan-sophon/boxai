import { describe, expect, it } from 'vitest'

import {
  getVideoCapabilityMode,
  videoCapabilitiesQueryKey,
} from './use-video-capabilities'

describe('video capability context', () => {
  it('keys responses by both group and model so late responses cannot cross contexts', () => {
    expect(videoCapabilitiesQueryKey('group-a', 'model')).not.toEqual(
      videoCapabilitiesQueryKey('group-b', 'model')
    )
    expect(videoCapabilitiesQueryKey('group-a', 'old')).not.toEqual(
      videoCapabilitiesQueryKey('group-a', 'new')
    )
  })

  it('selects text without media and honors the explicit media mode', () => {
    expect(getVideoCapabilityMode(false, 'references')).toBe('text')
    expect(getVideoCapabilityMode(true, 'frames')).toBe('frames')
    expect(getVideoCapabilityMode(true, 'references')).toBe('references')
  })
})
