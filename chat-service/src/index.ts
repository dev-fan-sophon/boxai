import { sql } from 'drizzle-orm'
import { Hono } from 'hono'

import { assertConfig, config } from './config'
import { db } from './db'
import { agentsRoute } from './routes/agents'
import { canvasRoute } from './routes/canvas'
import { canvasShareRoute } from './routes/canvas-share'
import { chatRoute } from './routes/chat'
import { conversationsRoute } from './routes/conversations'
import { memoriesRoute } from './routes/memories'
import { personasRoute } from './routes/personas'

assertConfig()

const app = new Hono()

app.get('/healthz', (c) => c.json({ status: 'ok' }))
app.get('/readyz', async (c) => {
  try {
    await db.execute(sql`select 1`)
    return c.json({ status: 'ok' })
  } catch {
    return c.json({ status: 'unavailable' }, 503)
  }
})
app.route('/v1/chat', chatRoute)
app.route('/api/playground/conversations', conversationsRoute)
app.route('/api/playground/memories', memoriesRoute)
app.route('/api/playground/personas', personasRoute)
app.route('/api/playground/agents', agentsRoute)
app.route('/api/playground/canvas/projects', canvasRoute)
app.route('/api/share/canvas', canvasShareRoute)

export default {
  port: config.port,
  hostname: config.host,
  // Tool calls can legitimately stay quiet for several minutes. Nginx owns
  // the external stream timeout; disabling Bun's shorter per-request timeout
  // prevents a successful long-running tool from being truncated.
  idleTimeout: 0,
  fetch: app.fetch,
}

console.log(`boxai-chat listening on ${config.host}:${config.port}`)
