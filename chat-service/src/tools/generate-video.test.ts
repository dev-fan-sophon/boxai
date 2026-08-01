import { expect, test } from 'bun:test'

import { waitForVideoPoll } from './generate-video'

test('video polling stops immediately when the turn is aborted', async () => {
  const controller = new AbortController()
  const waiting = waitForVideoPoll(controller.signal)
  controller.abort(new Error('cancelled'))
  await expect(waiting).rejects.toThrow('cancelled')
})
