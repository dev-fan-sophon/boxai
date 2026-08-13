/**
 * All configuration comes from the environment; in production the systemd
 * unit loads /opt/boxai/chat.env. Required values are read lazily so test
 * files can import modules without a full environment; assertConfig() runs
 * at service startup and refuses to boot without the internal secret,
 * because every capability (billing, session resolution, sandbox builds)
 * flows through the gateway with it.
 */

function required(name: string): string {
  const value = process.env[name]
  if (!value) {
    throw new Error(`${name} is required`)
  }
  return value
}

export const config = {
  get port() {
    return Number(process.env.CHAT_SERVICE_PORT ?? 3100)
  },
  get host() {
    return process.env.CHAT_SERVICE_HOST ?? '127.0.0.1'
  },
  get gatewayBaseUrl() {
    return process.env.GATEWAY_BASE_URL ?? 'http://127.0.0.1:3000'
  },
  get internalSecret() {
    return required('INTERNAL_SERVICE_SECRET')
  },
  get databaseUrl() {
    return required('DATABASE_URL')
  },
  get tavilyApiKey() {
    return required('TAVILY_API_KEY')
  },
}

export function assertConfig(): void {
  void config.internalSecret
  void config.databaseUrl
  void config.tavilyApiKey
}
