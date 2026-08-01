const AGENT_CHAT_FLAG_KEY = 'boxai:agent-chat'

/**
 * The server-owned agent transport is the production default. Setting the
 * local flag to "0" keeps a per-browser emergency rollback to the legacy
 * managed-tool + /pg/chat/completions path.
 */
export function isAgentChatEnabled(): boolean {
  if (typeof window === 'undefined') return true
  try {
    return window.localStorage.getItem(AGENT_CHAT_FLAG_KEY) !== '0'
  } catch {
    return true
  }
}
