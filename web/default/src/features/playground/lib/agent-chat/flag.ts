const AGENT_CHAT_FLAG_KEY = 'boxai:agent-chat'

/**
 * Opt-in switch for the server-owned agent chat transport. While it is off the
 * playground keeps the legacy managed-tool + /pg/chat/completions path, so the
 * flag is read on every decision point instead of being cached at module load.
 */
export function isAgentChatEnabled(): boolean {
  if (typeof window === 'undefined') return false
  try {
    return window.localStorage.getItem(AGENT_CHAT_FLAG_KEY) === '1'
  } catch {
    // Storage can be blocked (private mode, embedded webview); stay on legacy.
    return false
  }
}
