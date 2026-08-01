import { Hono } from 'hono'

import { assertConfig, config } from './config'
import { chatRoute } from './routes/chat'

assertConfig()

const app = new Hono()

app.get('/healthz', (c) => c.json({ status: 'ok' }))
app.route('/v1/chat', chatRoute)

export default {
  port: config.port,
  hostname: config.host,
  idleTimeout: 240,
  fetch: app.fetch,
}

console.log(`boxai-chat listening on ${config.host}:${config.port}`)
