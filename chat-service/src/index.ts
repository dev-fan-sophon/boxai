import { Hono } from 'hono'

import { assertConfig, config } from './config'
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
  idleTimeout: 240,
  fetch: app.fetch,
}

console.log(`boxai-chat listening on ${config.host}:${config.port}`)
