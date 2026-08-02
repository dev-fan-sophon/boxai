import { expect, test } from 'bun:test'

import {
  videoGenerationRequest,
  waitForVideoPoll,
} from './generate-video'

test('video generation uses the gateway-supported defaults', () => {
  expect(videoGenerationRequest('video-model', 'default', 'blue square')).toEqual(
    {
      model: 'video-model',
      group: 'default',
      prompt: 'blue square',
      duration: 5,
      size: '1280x720',
    }
  )
})

test('video polling stops immediately when the turn is aborted', async () => {
  const controller = new AbortController()
  const waiting = waitForVideoPoll(controller.signal)
  controller.abort(new Error('cancelled'))
  await expect(waiting).rejects.toThrow('cancelled')
})
