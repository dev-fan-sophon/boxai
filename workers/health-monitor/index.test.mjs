import { test } from 'node:test'
import assert from 'node:assert/strict'
import { check, healthErrors } from './index.mjs'

test('stale heartbeat boundary and reported host failures', () => {
  assert.deepEqual(healthErrors({ timestamp: 700, errors: [] }, 1000), [])
  assert.equal(healthErrors({ timestamp: 699, errors: [] }, 1000).length, 1)
  assert.equal(healthErrors(null, 1000).length, 1)
  assert.deepEqual(healthErrors({ timestamp: 999, errors: ['backup failed'] }, 1000), ['backup failed'])
})

test('two failures alert once, followed by a recovery notification', async () => {
  const original = globalThis.fetch
  globalThis.fetch = async (url) => Response.json(url.endsWith('/api/status') ? { success: true } : { status: 'ok' })
  const objects = new Map()
  const messages = []
  const env = {
    BACKUPS: { get: async (key) => objects.has(key) ? { json: async () => JSON.parse(objects.get(key)) } : null, put: async (key, value) => { objects.set(key, value) } },
    EMAIL: { send: async (message) => { messages.push(message) } },
  }
  try {
    assert.equal((await check(env)).notified, false)
    assert.equal((await check(env)).notified, true)
    assert.equal((await check(env)).notified, false)
    objects.set('ovh/monitor/heartbeat.json', JSON.stringify({ timestamp: Math.floor(Date.now() / 1000), errors: [] }))
    assert.equal((await check(env)).healthy, true)
    assert.equal(messages.length, 2)
    assert.match(messages[0].subject, /alert/)
    assert.match(messages[1].subject, /recovered/)
  } finally { globalThis.fetch = original }
})
