export function healthErrors(heartbeat, now) {
  if (!heartbeat || !Number.isFinite(heartbeat.timestamp) || now - heartbeat.timestamp > 300) {
    return ['Host heartbeat missing or older than five minutes']
  }
  return Array.isArray(heartbeat.errors) ? heartbeat.errors : ['Invalid host heartbeat']
}

export async function check(env) {
  const now = Math.floor(Date.now() / 1000)
  const errors = []
  for (const [path, key, expected] of [['/api/status', 'success', true], ['/chat-api/readyz', 'status', 'ok']]) {
    try {
      const response = await fetch('https://you-box.com' + path, { signal: AbortSignal.timeout(15000), cache: 'no-store' })
      if (!response.ok || (await response.json())[key] !== expected) errors.push(path + ' unhealthy')
    } catch {
      errors.push(path + ' unreachable')
    }
  }
  const heartbeat = await env.BACKUPS.get('ovh/monitor/heartbeat.json')
  errors.push(...healthErrors(heartbeat ? await heartbeat.json() : null, now))
  const previous = await env.BACKUPS.get('ovh/monitor/state.json')
  const state = previous ? await previous.json() : { failures: 0, alerted: false, notified: 0 }
  state.failures = errors.length ? state.failures + 1 : 0
  const alert = state.failures >= 2 && (!state.alerted || now - state.notified >= 3600)
  const recovery = !errors.length && state.alerted
  if (alert || recovery) {
    await env.EMAIL.send({
      from: env.ALERT_FROM,
      to: env.ALERT_TO,
      subject: alert ? '[BoxAI] Production health alert' : '[BoxAI] Production recovered',
      text: alert ? errors.join('\n') : 'Public API, Chat, host heartbeat and backup checks are healthy.',
    })
    state.alerted = alert
    state.notified = now
  }
  await env.BACKUPS.put('ovh/monitor/state.json', JSON.stringify(state))
  return { healthy: errors.length === 0, errors, notified: alert || recovery }
}

export default {
  async scheduled(_event, env) {
    console.log(JSON.stringify(await check(env)))
  },
  async fetch(request, env) {
    if (request.method !== 'POST' || request.headers.get('Authorization') !== `Bearer ${env.CHECK_TOKEN}`) {
      return new Response('Not found', { status: 404 })
    }
    try {
      return Response.json(await check(env))
    } catch (error) {
      return Response.json({ error: error.message }, { status: 500 })
    }
  },
}
